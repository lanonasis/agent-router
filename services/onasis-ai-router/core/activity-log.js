'use strict';

/**
 * In-memory activity trail for the operator dashboard.
 *
 * Records a minimal, metadata-only trace per request so an operator can see
 * "origin → router → vendor 1 (timeout) → failover → vendor 2 → completed"
 * without SSH + journalctl. It is fed by the same ops events the router
 * already emits (vendor_failure / fallback / request_outcome), so it adds no
 * new instrumentation points to the request path.
 *
 * Deliberately NOT recorded: prompts, responses, messages, credentials,
 * emails. Only ids, labels, timings and short error reasons.
 *
 * Scope: one ring buffer per process. If the router runs as several
 * processes, each one only knows the requests it served.
 */

const DEFAULT_CAPACITY = 200;
const MAX_ERROR_CHARS = 200;

function classifyError(message) {
  const m = String(message || '').toLowerCase();
  if (!m) return 'error';
  if (m.includes('not configured') || m.includes('enoent')) return 'not_configured';
  if (m.includes('abort') || m.includes('timeout') || m.includes('timed out') || m.includes('etimedout')) return 'timeout';
  if (/\b429\b/.test(m) || m.includes('rate limit') || m.includes('quota') || m.includes('credit')) return 'rate_limited';
  if (/\b(401|403)\b/.test(m) || m.includes('unauthor') || m.includes('forbidden')) return 'auth';
  if (/\b5\d\d\b/.test(m)) return 'upstream_5xx';
  if (m.includes('econnrefused') || m.includes('enotfound') || m.includes('fetch failed') || m.includes('network')) return 'unreachable';
  return 'error';
}

/** Short, non-identifying label for where a request came from. */
function describeOrigin(req) {
  const headers = (req && req.headers) || {};
  const explicit = headers['x-onasis-client'] || headers['x-client-name'];
  if (explicit) return String(explicit).slice(0, 48);
  if (headers.origin) {
    try { return new URL(headers.origin).hostname; } catch { /* fall through */ }
  }
  const ua = String(headers['user-agent'] || '');
  if (ua) {
    const first = ua.split(/[\s/]/)[0];
    if (first) return first.slice(0, 32).toLowerCase();
  }
  return 'api';
}

function createActivityLog({ capacity = DEFAULT_CAPACITY, now = () => Date.now() } = {}) {
  const cap = Math.max(1, parseInt(capacity, 10) || DEFAULT_CAPACITY);
  /** @type {Map<string, object>} insertion-ordered: oldest first */
  const entries = new Map();

  const trim = () => {
    while (entries.size > cap) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
    }
  };

  const ensure = (requestId) => {
    let entry = entries.get(requestId);
    if (!entry) {
      entry = {
        requestId,
        startedAt: new Date(now()).toISOString(),
        origin: 'api',
        endpoint: null,
        useCase: null,
        organizationId: null,
        streaming: false,
        attempts: [],
        status: 'in_progress',
        finalVendor: null,
        statusCode: null,
        durationMs: null,
        error: null,
      };
      entries.set(requestId, entry);
      trim();
    }
    return entry;
  };

  return {
    /** Mark the start of a request. Safe to call more than once. */
    begin(requestId, meta = {}) {
      if (!requestId) return;
      const entry = ensure(requestId);
      if (meta.origin) entry.origin = meta.origin;
      if (meta.endpoint) entry.endpoint = meta.endpoint;
      if (meta.useCase) entry.useCase = meta.useCase;
      if (meta.organizationId) entry.organizationId = meta.organizationId;
      if (meta.streaming) entry.streaming = true;
    },

    /** Feed one ops event (same shape the ops webhook receives). */
    record(event) {
      if (!event || !event.requestId) return;
      const entry = ensure(event.requestId);
      if (event.organizationId && !entry.organizationId) entry.organizationId = event.organizationId;

      if (event.kind === 'vendor_failure' || event.kind === 'stream_vendor_failure') {
        entry.attempts.push({
          vendor: event.vendor || 'unknown',
          outcome: 'failed',
          reason: classifyError(event.error),
          durationMs: Number.isFinite(event.durationMs) ? event.durationMs : null,
          error: event.error ? String(event.error).slice(0, MAX_ERROR_CHARS) : null,
        });
        return;
      }

      if (event.kind === 'request_outcome') {
        entry.statusCode = event.statusCode ?? null;
        entry.durationMs = Number.isFinite(event.durationMs) ? event.durationMs : null;
        if (event.endpoint && !entry.endpoint) entry.endpoint = event.endpoint;
        if (event.success) {
          entry.status = entry.attempts.some((a) => a.outcome === 'failed') ? 'recovered' : 'completed';
          entry.finalVendor = event.vendor || null;
          if (entry.finalVendor) {
            entry.attempts.push({ vendor: entry.finalVendor, outcome: 'served', reason: null, durationMs: null, error: null });
          }
        } else {
          entry.status = 'failed';
          entry.error = event.error ? String(event.error).slice(0, MAX_ERROR_CHARS) : null;
        }
      }
      // 'fallback' events duplicate vendor_failure for the same attempt — the
      // failover is implied by a failed attempt followed by another one.
    },

    /**
     * Newest first. `organizationId` limits results to one tenant; pass
     * `all: true` only for operator orgs.
     */
    list({ organizationId = null, all = false, limit = 50 } = {}) {
      const max = Math.min(Math.max(1, parseInt(limit, 10) || 50), cap);
      const out = [];
      const values = Array.from(entries.values());
      for (let i = values.length - 1; i >= 0 && out.length < max; i -= 1) {
        const e = values[i];
        if (!all && (!organizationId || e.organizationId !== organizationId)) continue;
        out.push({ ...e, attempts: e.attempts.map((a) => ({ ...a })) });
      }
      return out;
    },

    stats({ organizationId = null, all = false } = {}) {
      const visible = this.list({ organizationId, all, limit: cap });
      const count = (s) => visible.filter((e) => e.status === s).length;
      return {
        buffered: visible.length,
        capacity: cap,
        completed: count('completed'),
        recovered: count('recovered'),
        failed: count('failed'),
        inProgress: count('in_progress'),
      };
    },

    size() { return entries.size; },
  };
}

module.exports = { createActivityLog, classifyError, describeOrigin, DEFAULT_CAPACITY };
