'use strict';

/**
 * Vendor health that reflects the ability to SERVE, not the ability to be pinged.
 *
 * Measured live 2026-09-04: /health reported `"healthy", vendors 5/5` while every
 * vendor in the chain was failing real requests —
 *
 *   openai     429  "You have no credits remaining"
 *   anthropic  400  "Your credit balance is too low"
 *   openclaw   upstream 401, auth rotation stalling into our timeout
 *   minimax    timing out at 30s
 *   ollama     OLLAMA_MODEL naming a model not installed on the host
 *
 * Every probe except MiniMax's asked a question that stays true through exactly
 * that outage: ollama hit /api/tags (the daemon is up — says nothing about the
 * configured model), openai and anthropic hit /models (200 with a zero balance),
 * and openclaw's went further and counted a 401 as healthy. MiniMax's adapter
 * already had the right idea, and said so in a comment: *"this router already
 * learned the hard way (openclaw, 2026-08-19) that a reachability-only health
 * check reports healthy through an entire credential outage — the exact failure
 * it exists to catch."* That lesson was never applied to the other four.
 *
 * So the probe here is a real, minimal completion through `adapter.chat()` —
 * the same entry point real traffic uses. A probe that exercises a different
 * endpoint to the one being reported on can only ever be a proxy for the truth,
 * and this outage is what that costs.
 *
 * Two things keep that affordable:
 *
 *  1. Results are cached for a TTL and served stale while refreshing. A health
 *     endpoint that blocks on a slow vendor becomes its own outage — the thing
 *     monitoring reaches for when it suspects trouble must not be the thing that
 *     hangs.
 *  2. The cache is warmed at boot, so the first real probe never pays for a cold
 *     start.
 *
 * Observed traffic outranks the probe. A vendor whose circuit is open has been
 * failing actual requests; a synthetic ping that happens to succeed does not
 * overturn that, and reporting it healthy would hide the outage all over again.
 */

const PING_MESSAGES = [{ role: 'user', content: 'Reply with the single word: ok' }];

/**
 * Token ceiling for the probe.
 *
 * A probe that fails on a WORKING vendor is as harmful as one that passes on a
 * broken one — it just breaks trust in the other direction — and a ceiling set
 * too low does exactly that. Stopping a model before it can finish its turn
 * produces an unusable completion, which several vendors correctly report as a
 * failure.
 *
 * Measured against MiniMax on 2026-09-04, asking it to reply with one word:
 *
 *   16 tokens  -> incomplete_turn (rejected)
 *   64 tokens  -> "ok"
 *   256 tokens -> "ok"
 *
 * Reasoning-style models spend the early budget before emitting anything, so
 * the floor is set by the model's preamble rather than by the length of the
 * answer. 64 clears it with room to spare and stays negligible at one probe per
 * vendor per TTL. Configurable because the next model to join the chain may
 * think for longer still.
 */
const PROBE_MAX_TOKENS = parseInt(process.env.VENDOR_HEALTH_PROBE_MAX_TOKENS || '64', 10);

class VendorHealthMonitor {
  /**
   * @param {object}   deps
   * @param {object}   deps.registry   VENDOR_REGISTRY
   * @param {object}   deps.scoreboard live circuit state from real requests
   * @param {object}   deps.logger
   * @param {function} deps.now        injectable clock, for tests
   */
  constructor({ registry, scoreboard, logger, now } = {}) {
    this._registry = registry || {};
    this._scoreboard = scoreboard;
    this._logger = logger || { warn() {}, info() {}, error() {} };
    this._now = now || (() => Date.now());

    this._cache = new Map();   // vendorId -> { status, response_time, reason, checkedAt }
    this._inFlight = null;     // dedupes concurrent refreshes
  }

  _ttlMs() {
    return parseInt(process.env.VENDOR_HEALTH_TTL_MS || '60000', 10);
  }

  /**
   * How long a probe may take before it counts as a failure.
   *
   * Generous on purpose. Probes run in the background behind a stale cache, so a
   * slow one costs no caller anything — whereas one set too tight invents an
   * outage. At 10s this reported the local CPU-bound Ollama model unhealthy for
   * being slow: measured 2026-09-04, it answers a short prompt in ~10.5s, which
   * is fine for a last-resort vendor and not a fault.
   */
  _probeTimeoutMs() {
    return parseInt(process.env.VENDOR_HEALTH_PROBE_TIMEOUT_MS || '20000', 10);
  }

  _activeVendors() {
    return Object.entries(this._registry).filter(([, cfg]) => cfg && cfg.status === 'active');
  }

  /**
   * A representative model for the probe.
   *
   * Deliberately the model a real request would get rather than a hardcoded
   * cheap one: naming a model the host does not have is precisely the
   * misconfiguration this is meant to surface, and a probe on a different model
   * would sail through it.
   */
  _probeModel(cfg) {
    const models = cfg.models || {};
    return models.lana || models.speed || models.quality || Object.values(models)[0];
  }

  async _probe(vendorId, cfg) {
    const startedAt = this._now();
    try {
      await cfg.adapter.chat({
        messages: PING_MESSAGES,
        systemPrompt: null,
        temperature: 0,
        maxTokens: PROBE_MAX_TOKENS,
        timeoutOverrideMs: this._probeTimeoutMs(),
      }, this._probeModel(cfg));
      return { status: 'healthy', response_time: this._now() - startedAt };
    } catch (error) {
      // The message carries the actionable part — "no credits remaining",
      // "model not found" — so it is kept, trimmed. Vendor identity stays
      // internal, but an operator reading /health needs to know WHY.
      this._logger.warn('Vendor health probe failed', { vendorId, error: error.message });
      return {
        status: 'unhealthy',
        response_time: this._now() - startedAt,
        reason: String(error.message || 'probe failed').slice(0, 200),
      };
    }
  }

  /** Probe every active vendor in parallel and replace the cache. */
  async refresh() {
    if (this._inFlight) return this._inFlight;

    this._inFlight = (async () => {
      const vendors = this._activeVendors();
      await Promise.all(vendors.map(async ([vendorId, cfg]) => {
        const result = await this._probe(vendorId, cfg);
        this._cache.set(vendorId, { ...result, checkedAt: this._now() });
      }));
      // Vendors removed from the registry must not linger in the cache and be
      // reported as healthy forever.
      for (const key of [...this._cache.keys()]) {
        if (!vendors.some(([id]) => id === key)) this._cache.delete(key);
      }
      return this._snapshotFromCache();
    })().finally(() => { this._inFlight = null; });

    return this._inFlight;
  }

  _isStale() {
    if (this._cache.size === 0) return true;
    const oldest = Math.min(...[...this._cache.values()].map((v) => v.checkedAt));
    return (this._now() - oldest) >= this._ttlMs();
  }

  /**
   * Fold the live circuit state over the cached probe results.
   *
   * A probe is a synthetic minimal request; the circuit reflects what real
   * traffic has actually been getting. When they disagree, real traffic wins.
   */
  _snapshotFromCache() {
    const out = {};
    for (const [vendorId, entry] of this._cache.entries()) {
      const circuitOpen = Boolean(this._scoreboard && this._scoreboard.isOpen(vendorId));
      const stale = (this._now() - entry.checkedAt) >= this._ttlMs();
      out[vendorId] = {
        status: circuitOpen ? 'unhealthy' : entry.status,
        response_time: entry.response_time,
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(circuitOpen ? { circuit: 'open', reason: entry.reason || 'failing live requests' } : {}),
        ...(stale ? { stale: true } : {}),
      };
    }
    return out;
  }

  /**
   * Current health. Serves the cache when fresh, and serves it STALE while a
   * refresh runs in the background rather than making callers wait — except on
   * a cold cache, where there is nothing to serve and one wait is unavoidable.
   */
  async snapshot() {
    if (this._cache.size === 0) {
      try {
        return await this.refresh();
      } catch (error) {
        this._logger.error('Vendor health refresh failed on a cold cache', { error: error.message });
        return {};
      }
    }

    if (this._isStale()) {
      // Fire and forget: a slow vendor delays the next snapshot's freshness,
      // never this caller.
      this.refresh().catch((error) => {
        this._logger.warn('Background vendor health refresh failed', { error: error.message });
      });
    }

    return this._snapshotFromCache();
  }
}

module.exports = { VendorHealthMonitor };
