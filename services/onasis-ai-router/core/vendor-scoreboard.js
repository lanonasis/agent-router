'use strict';

/**
 * Per-vendor circuit breaker and outcome statistics.
 *
 * Extracted verbatim from core/ai-service-router.js (2026-08-27). Behaviour is
 * unchanged in this commit; outcome typing and latency-aware ordering arrive in
 * later tasks of the same plan.
 *
 * The clock is injectable so cooldown behaviour is unit-testable without sleeps.
 */
const { VendorContractError } = require('../vendors/_shared/response-contract');

// Matched against the adapter's error message, which embeds the upstream body.
// Patterns come from failures observed live on this host, 2026-08-26.
const BILLING_PATTERNS = [
  /no credits remaining/i,
  /insufficient[_ ]quota/i,
  /credit balance is too low/i,
  /credit_balance_exhausted/i,
  /usage limit reached/i,
  /returned 402\b/,
];
const AUTH_PATTERNS = [/returned 40[13]\b/, /unauthorized/i, /invalid api key/i];

// A success decays the failure count rather than resetting it, so a vendor that
// fails most of the time cannot buy its way back into rotation with occasional
// wins.
const SUCCESS_DECAY = 2;

/**
 * Weight for a failure that follows a success BY THE SAME VENDOR IN THE SAME
 * REQUEST — in practice the synthesis pass, where deciding to call a tool
 * succeeds and reading the result back then fails.
 *
 * Such a request must not leave the vendor looking healthier than it started.
 * At weight 1 it would: the first pass decays the count by SUCCESS_DECAY and the
 * failure adds one, netting -1 per request, so a vendor failing 100% of its
 * synthesis passes never reaches the circuit threshold. Measured live
 * 2026-09-04 — openclaw did exactly that, first pass fast and every synthesis
 * pass hung to the timeout, and stayed at the head of the chain throughout.
 *
 * Derived from SUCCESS_DECAY rather than written as a literal so the two cannot
 * drift apart.
 */
const SAME_REQUEST_FAILURE_WEIGHT = SUCCESS_DECAY + 1;

/**
 * Classify a vendor failure so the breaker can pick a proportionate cooldown.
 * A billing outage lasts days; a 503 lasts seconds. Treating them alike is why
 * dead vendors were retried every 30s indefinitely.
 */
function classifyFailure(err) {
  if (err instanceof VendorContractError) return 'contract';
  const message = String(err?.message || '');
  // Billing is checked before auth: a 402 or a credit message is unambiguous,
  // whereas some providers return 401-shaped bodies for exhausted accounts.
  if (BILLING_PATTERNS.some((p) => p.test(message))) return 'billing';
  if (AUTH_PATTERNS.some((p) => p.test(message))) return 'auth';
  return 'transient';
}

class VendorScoreboard {
  constructor({ now = Date.now } = {}) {
    this._now = now;
    // vendorId -> { failCount, lastFailedAt, cls }
    this._state = new Map();
    // vendorId -> number[] rolling window of observed latencies (successes
    //            plus transient failures, which are real user-visible waits)
    this._latency = new Map();
  }

  // Threshold and base cooldown per failure class. Billing and auth open on the
  // first failure because a second attempt cannot succeed — the account state
  // has to change externally.
  _policy(cls) {
    const int = (name, dflt) => parseInt(process.env[name] || String(dflt), 10);
    switch (cls) {
      case 'billing':
        return { threshold: 1, baseMs: int('VENDOR_BILLING_COOLDOWN_MS', 3600000), capMs: 12 * 3600000 };
      case 'auth':
        return { threshold: 1, baseMs: int('VENDOR_AUTH_COOLDOWN_MS', 3600000), capMs: 12 * 3600000 };
      case 'contract':
        return { threshold: 2, baseMs: int('VENDOR_CONTRACT_COOLDOWN_MS', 300000), capMs: 3600000 };
      default:
        // capMs must exceed baseMs, otherwise Math.min() in isOpen() pins every
        // repeat to the base interval and a permanently-timing-out vendor is
        // re-probed forever at a fixed cadence — the same unbounded-retry shape
        // this scoreboard exists to prevent, just at a different failure class.
        // Observed live on `memory-analysis` (2026-08-27): ~every 30s one
        // request paid a full 30s timeout to re-probe a dead vendor.
        return {
          threshold: int('VENDOR_CIRCUIT_THRESHOLD', 3),
          baseMs:    int('VENDOR_CIRCUIT_COOLDOWN_MS', 30000),
          capMs:     int('VENDOR_CIRCUIT_COOLDOWN_CAP_MS', 300000),
        };
    }
  }

  isOpen(vendorId) {
    const state = this._state.get(vendorId);
    if (!state) return false;
    const { threshold, baseMs, capMs } = this._policy(state.cls);
    if (state.failCount < threshold) return false;
    // Exponential backoff on repeats beyond the threshold, capped.
    const overshoot = state.failCount - threshold;
    const cooldownMs = Math.min(baseMs * Math.pow(2, overshoot), capMs);
    return (this._now() - state.lastFailedAt) < cooldownMs;
  }

  recordFailure(vendorId, err, latencyMs, { weight = 1 } = {}) {
    const cls = err ? classifyFailure(err) : 'transient';
    // Only transient failures contribute a latency sample. A timeout is real
    // wait a caller actually paid, so tail demotion should see it; a 50ms auth
    // 401 says nothing about speed and would make a dead vendor look like the
    // fastest option in the chain. Without this, a vendor that *only* ever
    // times out never accumulates a sample and can never be demoted.
    if (cls === 'transient') this._recordLatency(vendorId, latencyMs);
    const prev = this._state.get(vendorId);
    // A change of class restarts the count — a billing outage after a transient
    // blip is a different problem, not a continuation of the old one.
    const state = prev && prev.cls === cls ? prev : { failCount: 0, lastFailedAt: 0, cls };
    state.failCount += Math.max(1, Math.trunc(weight));
    state.lastFailedAt = this._now();
    state.cls = cls;
    this._state.set(vendorId, state);
  }

  recordSuccess(vendorId, latencyMs) {
    this._recordLatency(vendorId, latencyMs);
    // Decay failure count on success instead of immediate reset.
    // This prevents flaky vendors (90% failure rate) from staying in rotation.
    const state = this._state.get(vendorId);
    if (!state) return;
    state.failCount = Math.max(0, state.failCount - SUCCESS_DECAY);
    if (state.failCount === 0) {
      this._state.delete(vendorId);
    } else {
      this._state.set(vendorId, state);
    }
  }

  /** Rolling window of recent observed latencies, newest last. */
  _recordLatency(vendorId, latencyMs) {
    if (!Number.isFinite(latencyMs)) return;
    const WINDOW = parseInt(process.env.VENDOR_LATENCY_WINDOW || '20', 10);
    const samples = this._latency.get(vendorId) || [];
    samples.push(latencyMs);
    if (samples.length > WINDOW) samples.shift();
    this._latency.set(vendorId, samples);
  }

  /** p95 of the rolling window, or null below the minimum sample count. */
  p95(vendorId) {
    const samples = this._latency.get(vendorId) || [];
    const MIN = parseInt(process.env.VENDOR_LATENCY_MIN_SAMPLES || '5', 10);
    if (samples.length < MIN) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  }

  /**
   * Filter and order a declared vendor chain by observed behaviour.
   *
   * Declared order is preference. It is overridden only when a vendor's p95
   * exceeds the tail budget AND a measured-faster alternative exists — the case
   * this service actually has, where medians overlap but tails diverge sharply
   * (openclaw p50 ~3.4s / max 41.5s vs minimax p50 ~2.2s / max 4.5s).
   */
  /**
   * The class of this vendor's most recent failure, or null when it has none
   * outstanding.
   *
   * Exposed so callers can tell a vendor that might work on the next attempt
   * from one that definitely will not: a 503 is worth retrying inside a request,
   * an empty account is not.
   */
  failureClass(vendorId) {
    const state = this._state.get(vendorId);
    return state ? state.cls : null;
  }

  orderChain(chain) {
    const open = chain.filter((v) => !this.isOpen(v._vendorId));

    // Fail open, not closed. A breaker exists to steer traffic AWAY from a bad
    // vendor while a better one exists; when every circuit is open there is
    // nothing to steer towards, and returning none of them converts "every
    // vendor is degraded" into a guaranteed failure. Cooldowns are heuristics
    // and upstreams recover between them, so one attempt in declared preference
    // order strictly beats not trying.
    //
    // Observed live 2026-09-04 with openclaw (upstream 401 + stalled auth
    // rotation), minimax (timeout), openai (no credits), anthropic (no credits)
    // and ollama all failing at once: the chain emptied and callers got 500s
    // where a degraded-but-useful answer had been reaching them before.
    if (open.length === 0) return chain.slice();

    if (open.length < 2) return open;

    const TAIL_MS = parseInt(process.env.VENDOR_TAIL_DEMOTE_MS || '15000', 10);
    const isSlow = (v) => { const p = this.p95(v._vendorId); return p !== null && p > TAIL_MS; };
    const isKnownFast = (v) => { const p = this.p95(v._vendorId); return p !== null && p <= TAIL_MS; };

    // Only demote when a measured-fast alternative exists. Unmeasured vendors
    // keep their declared position — absence of data is not evidence of speed.
    if (!open.some(isKnownFast)) return open;

    const fast = open.filter((v) => !isSlow(v));
    const slow = open.filter(isSlow);
    return [...fast, ...slow];
  }
}

module.exports = { VendorScoreboard, classifyFailure, SAME_REQUEST_FAILURE_WEIGHT };
