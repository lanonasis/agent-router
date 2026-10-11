'use strict';

/**
 * Shared transport for all vendor adapters — INTERNAL ONLY
 *
 * Two responsibilities:
 *  1. Install one process-wide keep-alive `undici.Agent` so every outbound
 *     `fetch()` in this process (vendor chat/healthCheck, memory-prefetch,
 *     tool calls, auth-gateway resolve) reuses TCP/TLS connections instead of
 *     paying full handshake cost on Node's default ~4s keep-alive window.
 *  2. `fetchWithRetry()` — the AbortController/timeout/retry logic that used
 *     to be copy-pasted in every adapter's `chat()`/`healthCheck()`.
 */

const { Agent, setGlobalDispatcher } = require('undici');

let dispatcherInstalled = false;

function installGlobalDispatcher() {
  if (dispatcherInstalled) return;
  dispatcherInstalled = true;
  setGlobalDispatcher(new Agent({
    keepAliveTimeout: parseInt(process.env.HTTP_KEEPALIVE_TIMEOUT_MS || '30000', 10),
    keepAliveMaxTimeout: parseInt(process.env.HTTP_KEEPALIVE_MAX_TIMEOUT_MS || '600000', 10),
    connections: parseInt(process.env.HTTP_MAX_CONNECTIONS_PER_ORIGIN || '20', 10),
  }));
}

// Install immediately on first require — every adapter requires this module,
// so the dispatcher is live before any vendor call fires.
installGlobalDispatcher();

const DEFAULT_RETRYABLE_STATUSES = [429, 502, 503, 504];

function isRetryableError(err) {
  // Generic fetch network failures (ECONNREFUSED, DNS failure, etc.) are
  // transient and worth one retry. Our OWN timeout firing (AbortError) is
  // NOT retryable: it means the call was already slow/hung for the full
  // timeoutMs, and retrying just repeats that same wait a second time —
  // found via a real repl-cli smoke test where a hung ollama call that
  // should fail fast instead took 68s (30s timeout, retried once, plus the
  // rest of the fallback chain) because this used to return true for
  // AbortError. A caller that specifically wants abort-retried needs a
  // different mechanism; this shared default must not double timeout cost.
  return err instanceof TypeError;
}

function backoffMs(timeoutMs) {
  const base = Math.min(500, Math.floor(timeoutMs / 4));
  return base + Math.floor(Math.random() * 100);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch() wrapper with a per-call AbortController timeout and a bounded
 * retry (default: exactly one) on transient failures — network error/abort,
 * or a status in `retryableStatuses`. Never retries 4xx auth/validation
 * responses by default (400/401/403 are not in the retryable list) — those
 * aren't transient and retrying just burns the fallback-chain time budget.
 *
 * Resolves to the `Response` object (or throws on final failure) — callers
 * keep doing their own `response.ok`/`response.json()` handling exactly as
 * before, only the transport plumbing moved here.
 *
 * Opt-in options (all off by default, so every existing caller is unchanged):
 *
 *  - `retryOnTimeout`: also retry when OUR OWN timeout aborted the attempt.
 *    Off by default for the reason in isRetryableError(). The auth-gateway
 *    resolve is the exception: its slow path is a cold cache that the first,
 *    aborted attempt has usually finished warming by the time the retry lands.
 *  - `deadlineAt`: absolute epoch-ms instant the WHOLE call (every attempt and
 *    backoff) must finish by. Each attempt's timeout is clamped to what is
 *    left, and a retry is skipped when it could not fit. This is what lets a
 *    caller spend one wall-clock budget across attempts instead of paying
 *    `timeoutMs` per attempt.
 *  - `minRetryWindowMs`: a retry is only started if at least this much of
 *    the deadline would remain after backoff. A retry with less time than the
 *    fastest realistic response is a guaranteed failure that only adds wait.
 *  - `onRetry({ attempt, reason, status })`: observability hook, called
 *    before each retry. `reason` is 'status' | 'timeout' | 'network'.
 */
async function fetchWithRetry(url, options = {}) {
  const {
    timeoutMs = 30000,
    retries = 1,
    retryableStatuses = DEFAULT_RETRYABLE_STATUSES,
    retryOnTimeout = false,
    deadlineAt,
    minRetryWindowMs = 0,
    onRetry,
    ...fetchOptions
  } = options;

  const hasDeadline = Number.isFinite(deadlineAt);
  const remainingMs = () => (hasDeadline ? deadlineAt - Date.now() : Infinity);

  // Would a retry started after `waitMs` of backoff still have a useful window?
  const retryFits = (waitMs) => remainingMs() - waitMs >= Math.max(1, minRetryWindowMs);

  let attempt = 0;
  let lastError;

  while (attempt <= retries) {
    const attemptTimeoutMs = Math.max(1, Math.min(timeoutMs, remainingMs()));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok && retryableStatuses.includes(response.status) && attempt < retries) {
        const waitMs = backoffMs(timeoutMs);
        if (retryFits(waitMs)) {
          attempt += 1;
          // Release the discarded response's connection back to the pool
          // rather than leaving it pinned until GC.
          try { await response.body?.cancel(); } catch { /* already consumed */ }
          if (onRetry) onRetry({ attempt, reason: 'status', status: response.status });
          await sleep(waitMs);
          continue;
        }
      }
      return response;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      // Only an abort WE caused counts as a timeout; an abort signalled by a
      // caller-supplied signal is not ours to retry.
      const timedOut = controller.signal.aborted && err && err.name === 'AbortError';
      const retryable = isRetryableError(err) || (retryOnTimeout && timedOut);
      if (retryable && attempt < retries) {
        const waitMs = backoffMs(timeoutMs);
        if (retryFits(waitMs)) {
          attempt += 1;
          if (onRetry) onRetry({ attempt, reason: timedOut ? 'timeout' : 'network' });
          await sleep(waitMs);
          continue;
        }
      }
      throw err;
    }
  }
  throw lastError;
}

// Health checks were previously a hardcoded `5000` literal duplicated in
// every adapter — now configurable per vendor, default unchanged.
function healthCheckTimeoutMs(vendorPrefix) {
  return parseInt(process.env[`${vendorPrefix}_HEALTHCHECK_TIMEOUT_MS`] || '5000', 10);
}

module.exports = { fetchWithRetry, healthCheckTimeoutMs, installGlobalDispatcher };
