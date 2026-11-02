'use strict';

/**
 * Short-lived conversation turn retention — INTERNAL ONLY.
 *
 * Chat surfaces such as the Slack concierge send ONE message per request. The
 * router answered each in isolation, so a follow-up ("please run that search",
 * "summarise those") reached the model with no idea what "that" was —
 * observed on the Slack concierge 2026-11-02, where the agent asked the user
 * to repeat context it had produced one message earlier.
 *
 * Contract:
 *  - OPT-IN per request. A caller sends `session_id` (body) or
 *    `X-Onasis-Session` (header). There is deliberately no implicit session:
 *    one API key often fronts many end users (a website backend, a shared
 *    bot), and keying on the credential alone would hand one person's
 *    conversation to the next.
 *  - SCOPED TO THE RESOLVED IDENTITY. The storage key is
 *    (auth_id, organization_id, session_id). A guessed or leaked session id
 *    from another credential addresses a different, empty bucket.
 *  - BOUNDED. TTL (SESSION_TTL_SECONDS, default 1800, refreshed on every
 *    write), a turn cap (SESSION_MAX_TURNS, default 12 messages) and a char
 *    cap (SESSION_MAX_CHARS, default 6000) so restored history cannot crowd
 *    out the request's own budget.
 *  - TEXT ONLY. Stores the user's message and the FINAL assistant answer that
 *    was sent to the client (already sanitised). Never tool payloads, system
 *    prompts, memory briefs or vendor identity.
 *  - NEVER FAILS A REQUEST. Redis when configured (shared across replicas);
 *    any Redis failure degrades to the in-process store for that call and is
 *    logged once a minute — the ranked-transports rule: degrade and record,
 *    never stop.
 */

const DEFAULT_TTL_SECONDS = 1800;
const DEFAULT_MAX_TURNS = 12;
const DEFAULT_MAX_CHARS = 6000;
const MAX_TURN_CHARS = 2000;
const MAX_MEMORY_SESSIONS = 5000;
const SESSION_ID_RE = /^[A-Za-z0-9._:\-]{8,128}$/;

function intEnv(name, dflt) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

class SessionStore {
  /**
   * @param {object}   [opts]
   * @param {object}   [opts.logger]
   * @param {object}   [opts.redis]  ioredis-compatible client (injectable for tests)
   * @param {function} [opts.now]
   */
  constructor({ logger, redis, now = Date.now } = {}) {
    this.logger = logger;
    this._now = now;
    this._redis = redis === undefined ? null : redis;
    this._redisResolved = redis !== undefined;
    this._mem = new Map(); // key -> { expiresAt, turns }
    this._lastWarnAt = 0;
    this.enabled = (process.env.SESSION_MEMORY_ENABLED || 'true') === 'true';
  }

  get ttlSeconds() { return intEnv('SESSION_TTL_SECONDS', DEFAULT_TTL_SECONDS); }
  get maxTurns() { return intEnv('SESSION_MAX_TURNS', DEFAULT_MAX_TURNS); }
  get maxChars() { return intEnv('SESSION_MAX_CHARS', DEFAULT_MAX_CHARS); }

  /** Session id from body or header, validated; null when absent or malformed. */
  static sessionIdFrom(req) {
    const body = req?.body || {};
    const raw = body.session_id ?? body.sessionId ?? req?.headers?.['x-onasis-session'];
    if (typeof raw !== 'string') return null;
    const id = raw.trim();
    return SESSION_ID_RE.test(id) ? id : null;
  }

  /** Storage key, or null when the caller cannot be identified. */
  static keyFor(req, sessionId) {
    const authId = req?.uai?.authId;
    if (!authId || !sessionId) return null;
    const org = req?.uai?.organizationId || '-';
    return `onasis:router:session:${authId}:${org}:${sessionId}`;
  }

  _getRedis() {
    if (this._redisResolved) return this._redis;
    this._redisResolved = true;
    const enabled = !!(process.env.REDIS_URL || process.env.REDIS_HOST || process.env.REDIS_ENABLED === 'true');
    if (!enabled || process.env.SESSION_STORE === 'memory') return (this._redis = null);
    try {
      const IORedis = require('ioredis');
      const Redis = IORedis.Redis || IORedis;
      const opts = { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false };
      this._redis = process.env.REDIS_URL
        ? new Redis(process.env.REDIS_URL, opts)
        : new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD,
          db: Number(process.env.REDIS_DB) || 0,
          ...opts,
        });
      this._redis.on('error', (e) => this._warn('Session store Redis error — using in-process fallback', e));
    } catch (e) {
      this._warn('Session store Redis unavailable — using in-process store', e);
      this._redis = null;
    }
    return this._redis;
  }

  _warn(message, error) {
    const now = this._now();
    if (now - this._lastWarnAt < 60000) return;
    this._lastWarnAt = now;
    this.logger?.warn?.(message, { error: error?.message || String(error || '') });
  }

  _trim(turns) {
    let kept = turns.slice(-this.maxTurns);
    // Drop oldest until under the char cap; always keep the newest pair.
    let total = kept.reduce((n, t) => n + t.content.length, 0);
    while (kept.length > 2 && total > this.maxChars) {
      total -= kept[0].content.length;
      kept = kept.slice(1);
    }
    // Never start restored history with an orphan assistant turn.
    while (kept.length && kept[0].role !== 'user') kept = kept.slice(1);
    return kept;
  }

  _memGet(key) {
    const hit = this._mem.get(key);
    if (!hit) return [];
    if (hit.expiresAt <= this._now()) { this._mem.delete(key); return []; }
    return hit.turns;
  }

  _memSet(key, turns) {
    this._mem.delete(key); // re-insert to keep Map order ≈ LRU
    this._mem.set(key, { expiresAt: this._now() + this.ttlSeconds * 1000, turns });
    while (this._mem.size > MAX_MEMORY_SESSIONS) {
      this._mem.delete(this._mem.keys().next().value);
    }
  }

  /** Earlier turns for this session, oldest first. Never throws. */
  async load(key) {
    if (!this.enabled || !key) return [];
    const redis = this._getRedis();
    if (redis) {
      try {
        const raw = await redis.get(key);
        if (raw) {
          const turns = JSON.parse(raw);
          if (Array.isArray(turns)) return turns;
        }
        return this._memGet(key); // written during a Redis blip
      } catch (e) {
        this._warn('Session store read failed — using in-process fallback', e);
      }
    }
    return this._memGet(key);
  }

  /** Append one exchange. Never throws. */
  async append(key, userText, assistantText) {
    if (!this.enabled || !key) return;
    const u = String(userText || '').trim();
    const a = String(assistantText || '').trim();
    if (!u || !a) return;
    const clip = (s) => (s.length > MAX_TURN_CHARS ? `${s.slice(0, MAX_TURN_CHARS)}…` : s);
    const prev = await this.load(key);
    const turns = this._trim([
      ...prev,
      { role: 'user', content: clip(u) },
      { role: 'assistant', content: clip(a) },
    ]);
    const redis = this._getRedis();
    if (redis) {
      try {
        await redis.set(key, JSON.stringify(turns), 'EX', this.ttlSeconds);
        this._mem.delete(key);
        return;
      } catch (e) {
        this._warn('Session store write failed — using in-process fallback', e);
      }
    }
    this._memSet(key, turns);
  }

  async clear(key) {
    if (!key) return;
    this._mem.delete(key);
    const redis = this._getRedis();
    if (redis) {
      try { await redis.del(key); } catch (e) { this._warn('Session store delete failed', e); }
    }
  }
}

/**
 * Should restored turns be injected? Only when the caller sent a single-turn
 * request. A caller that sends its own history owns its transcript, and
 * merging two transcripts would duplicate or reorder turns.
 */
function callerSentHistory(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.filter((m) => m && (m.role === 'user' || m.role === 'assistant')).length > 1;
}

module.exports = { SessionStore, callerSentHistory, SESSION_ID_RE };
