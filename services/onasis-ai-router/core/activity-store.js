'use strict';

/**
 * Durable storage for the operator activity trail.
 *
 * The in-memory trail (core/activity-log.js) resets on every restart and is
 * per-process — with two PM2 replicas the dashboard would see whichever one
 * answered the poll. This store appends every *settled* entry (completed,
 * recovered or failed) to a daily JSON-lines file in a shared directory, so:
 *
 *  - entries survive router restarts and deploys,
 *  - every replica reads the same history,
 *  - old days are deleted after ROUTER_ACTIVITY_RETENTION_DAYS.
 *
 * Same privacy contract as the in-memory trail: the entries it receives are
 * metadata only (ids, labels, timings, short error reasons) — never prompts,
 * answers or credentials. Nothing here adds fields.
 *
 * Reads are incremental: each file's parsed lines are cached with the byte
 * offset already read, so a dashboard polling every few seconds only parses
 * lines appended since its last poll.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DEFAULT_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 365;
const MAX_READ_LIMIT = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FILE_RE = /^activity-(\d{4}-\d{2}-\d{2})\.jsonl$/;

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

function resolveRetentionDays(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RETENTION_DAYS;
  return Math.min(n, MAX_RETENTION_DAYS);
}

function createActivityStore({
  dir,
  retentionDays,
  enabled = true,
  logger = null,
  now = () => Date.now(),
} = {}) {
  const days = resolveRetentionDays(retentionDays);
  const active = !!enabled && !!dir;
  const state = { written: 0, prunedFiles: 0, lastError: null, lastPrunedAt: null };
  /** file name -> { offset, partial, entries[] } */
  const cache = new Map();
  let writeChain = Promise.resolve();
  let dirReady = null;

  const fail = (op, err) => {
    state.lastError = `${op}: ${err && err.message ? err.message : String(err)}`.slice(0, 200);
    if (logger) logger.warn('Activity store error', { op, error: state.lastError });
  };

  const ensureDir = () => {
    if (!dirReady) {
      dirReady = fsp.mkdir(dir, { recursive: true, mode: 0o750 }).catch((err) => {
        dirReady = null;
        throw err;
      });
    }
    return dirReady;
  };

  const listFiles = async () => {
    try {
      const names = await fsp.readdir(dir);
      return names.filter((n) => FILE_RE.test(n)).sort();
    } catch (err) {
      if (err.code !== 'ENOENT') fail('readdir', err);
      return [];
    }
  };

  const readFile = async (name) => {
    const file = path.join(dir, name);
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      cache.delete(name);
      return [];
    }
    let c = cache.get(name);
    // Shrunk (rotated/truncated by hand) — start over.
    if (!c || st.size < c.offset) c = { offset: 0, partial: '', entries: [] };
    if (st.size > c.offset) {
      const fh = await fsp.open(file, 'r');
      try {
        const len = st.size - c.offset;
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, c.offset);
        c.offset += bytesRead;
        const lines = (c.partial + buf.subarray(0, bytesRead).toString('utf8')).split('\n');
        c.partial = lines.pop(); // a line still being written
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry && entry.requestId) c.entries.push(entry);
          } catch { /* skip a corrupt line, keep the rest */ }
        }
      } finally {
        await fh.close();
      }
    }
    cache.set(name, c);
    return c.entries;
  };

  return {
    enabled: active,
    retentionDays: days,

    /** Append one settled entry. Never throws; failures are reported in info(). */
    append(entry) {
      if (!active || !entry || !entry.requestId) return Promise.resolve();
      const line = `${JSON.stringify(entry)}\n`;
      const file = path.join(dir, `activity-${dayKey(now())}.jsonl`);
      writeChain = writeChain
        .then(async () => {
          await ensureDir();
          await fsp.appendFile(file, line, { mode: 0o640 });
          state.written += 1;
        })
        .catch((err) => fail('append', err));
      return writeChain;
    },

    /** Resolves once queued writes have landed (tests, graceful shutdown). */
    flush() {
      return writeChain;
    },

    /**
     * Newest settled entries first. `filter(entry)` scopes to a tenant;
     * entries outside the retention window are never returned even if their
     * file has not been pruned yet.
     */
    async recent({ limit = 50, filter = null } = {}) {
      if (!active) return [];
      const max = Math.min(Math.max(1, parseInt(limit, 10) || 50), MAX_READ_LIMIT);
      const oldestDay = dayKey(now() - (days - 1) * DAY_MS);
      const files = (await listFiles()).filter((n) => n.match(FILE_RE)[1] >= oldestDay).reverse();
      const out = [];
      const seen = new Set();
      const touched = new Set();
      for (const name of files) {
        touched.add(name);
        let entries;
        try {
          entries = await readFile(name);
        } catch (err) {
          fail('read', err);
          continue;
        }
        for (let i = entries.length - 1; i >= 0 && out.length < max; i -= 1) {
          const e = entries[i];
          if (seen.has(e.requestId)) continue;
          if (filter && !filter(e)) continue;
          seen.add(e.requestId);
          out.push({ ...e, attempts: Array.isArray(e.attempts) ? e.attempts.map((a) => ({ ...a })) : [] });
        }
        if (out.length >= max) break;
      }
      // Only keep parsed files that are still being read.
      for (const key of Array.from(cache.keys())) if (!touched.has(key)) cache.delete(key);
      return out;
    },

    /** Delete day files older than the retention window. Returns files removed. */
    async prune() {
      if (!active) return 0;
      const oldestDay = dayKey(now() - (days - 1) * DAY_MS);
      let removed = 0;
      for (const name of await listFiles()) {
        if (name.match(FILE_RE)[1] >= oldestDay) continue;
        try {
          await fsp.unlink(path.join(dir, name));
          cache.delete(name);
          removed += 1;
        } catch (err) {
          if (err.code !== 'ENOENT') fail('prune', err);
        }
      }
      state.prunedFiles += removed;
      state.lastPrunedAt = new Date(now()).toISOString();
      return removed;
    },

    /** Safe to expose to operators: no paths, no entry contents. */
    async info() {
      if (!active) return { enabled: false, retentionDays: days };
      const files = await listFiles();
      const first = files[0] ? files[0].match(FILE_RE)[1] : null;
      return {
        enabled: true,
        retentionDays: days,
        oldestDay: first,
        days: files.length,
        written: state.written,
        lastPrunedAt: state.lastPrunedAt,
        lastError: state.lastError,
      };
    },
  };
}

module.exports = {
  createActivityStore,
  resolveRetentionDays,
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MAX_READ_LIMIT,
};
