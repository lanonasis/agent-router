'use strict';

/**
 * Vendor chain execution.
 *
 * Extracted verbatim from core/ai-service-router.js (2026-08-27), including the
 * fallback-timeout-ratio logic and its rationale for NOT racing vendors in
 * parallel. No behaviour change in this commit; scoreboard-driven ordering and
 * per-attempt outcome reporting arrive in Task 12.
 */

const { resolveVendorChainForUseCase, VENDOR_REGISTRY } = require('../vendors');

/**
 * Raised when no vendor could serve the request.
 *
 * Typed rather than a bare Error so the caller can answer 503 (a real outage,
 * retryable) instead of the catch-all 500 it used to collapse into. The
 * distinction matters to a client: 500 reads as "this request is broken", 503
 * as "the service is down, try again", and only one of those is true here.
 *
 * `cause` carries the underlying vendor error for the LOG. It must never reach
 * the client — those messages name vendors and their billing URLs, which the
 * router does not disclose.
 */
class VendorsExhaustedError extends Error {
  constructor(message, { cause, useCase, attempted } = {}) {
    super(message);
    this.name = 'VendorsExhaustedError';
    this.code = 'ALL_VENDORS_UNAVAILABLE';
    this.status = 503;
    this.cause = cause;
    this.useCase = useCase;
    this.attempted = attempted;
  }
}

// Failure classes that cannot resolve themselves inside a single request. A
// vendor out of credits, or holding a key the upstream rejects, will fail again
// however many times it is asked — so the last-resort pass skips it rather than
// spending the caller's remaining time on a certainty.
const PERMANENT_FAILURE_CLASSES = new Set(['billing', 'auth']);

// Below this there is no point starting another vendor attempt: it cannot
// plausibly complete, and the time is better spent returning a real error than
// having the caller cut the connection mid-flight.
const MIN_ATTEMPT_MS = parseInt(process.env.MIN_VENDOR_ATTEMPT_MS || '2000', 10);

class ChainExecutor {
  /**
   * @param {object}   deps
   * @param {object}   deps.scoreboard
   * @param {object}   deps.logger
   * @param {function} [deps.resolveChain] vendor chain for a use case. Injectable
   *   so resilience behaviour — escalation, deadlines, exhaustion — can be tested
   *   against fake adapters. The module-level import is destructured at load, so
   *   without this seam a test cannot substitute one.
   */
  constructor({ scoreboard, logger, resolveChain }) {
    this._scoreboard = scoreboard;
    this._logger = logger;
    this._resolveChain = resolveChain || resolveVendorChainForUseCase;
  }

  /**
   * @returns {{ adapterResponse: object, selectedVendor: object }}
   * @throws the last vendor error when every vendor in the chain fails
   */
  /**
   * Milliseconds left before the caller stops waiting, or Infinity when no
   * deadline was supplied.
   */
  _remainingMs(deadlineAt) {
    return Number.isFinite(deadlineAt) ? deadlineAt - Date.now() : Infinity;
  }

  /**
   * One vendor attempt. Extracted so the preferred chain and the last-resort
   * chain below run through identical logic — a second hand-written loop is how
   * the two drift apart.
   *
   * Returns the adapter response, or throws. Recording the outcome on the
   * scoreboard is part of the attempt: a path that tries a vendor without
   * reporting what happened is how a vendor failing every request stays at the
   * head of the chain (see the synthesis pass, 2026-09-04).
   */
  async _attempt(vendor, { messages, promptBundle, temperature, maxTokens, tools, useCase, requestId, emitEvent }, { tighten, deadlineAt }) {
    let startedAt = Date.now();
    const internalRequest = {
      messages,
      systemPrompt: promptBundle.systemPromptForVendor(vendor._vendorId),
      temperature,
      maxTokens,
      tools,
      // Adapters that route per use case need this. vendors/openclaw's
      // pickAgent() reads internalRequest.useCase to choose which OpenClaw
      // agent handles the request; it was never passed, so USE_CASE_AGENT
      // silently never applied and every request fell through to
      // DEFAULT_AGENT ('fixer') regardless of use case. Fixed 2026-08-19.
      useCase,
      errorSentinels: VENDOR_REGISTRY[vendor._vendorId]?.errorSentinels,
    };

    // The primary vendor gets its full configured timeout. Everything after it
    // is already a degraded fallback path — give it a tighter budget (a ratio of
    // its own configured timeout) rather than paying that vendor's full timeout
    // again on top of the primary's. Deliberately NOT racing vendors in
    // parallel: that would bill every raced paid vendor per fallback request for
    // zero-value duplicate work.
    const envKey = `${vendor._vendorId.toUpperCase().replace(/-/g, '_')}_TIMEOUT_MS`;
    const configuredMs = parseInt(process.env[envKey] || '30000', 10);
    let budgetMs = tighten
      ? Math.round(configuredMs * parseFloat(process.env.VENDOR_FALLBACK_TIMEOUT_RATIO || '0.65'))
      : configuredMs;

    // Never spend past the caller's deadline. Vendor timeouts are per-CALL, so
    // without this a sequence of individually-reasonable waits still overran the
    // caller — measured 2026-09-04 as 504s on requests where every single stage
    // had in fact returned something usable.
    const remainingMs = this._remainingMs(deadlineAt);
    if (Number.isFinite(remainingMs)) budgetMs = Math.min(budgetMs, remainingMs);
    if (budgetMs !== configuredMs) internalRequest.timeoutOverrideMs = budgetMs;

    try {
      startedAt = Date.now();
      const adapterResponse = await vendor._adapter.chat(internalRequest, vendor._model);
      this._scoreboard.recordSuccess(vendor._vendorId, Date.now() - startedAt);
      return adapterResponse;
    } catch (err) {
      if (emitEvent) {
        void emitEvent({
          kind: 'vendor_failure',
          requestId,
          vendor: vendor._vendorId,
          model: vendor._model,
          durationMs: Date.now() - startedAt,
          success: false,
          error: String(err.message || 'vendor failure').slice(0, 512),
          occurredAt: new Date().toISOString(),
        });
      }
      // Elapsed time is passed so a timeout registers as a latency sample.
      this._scoreboard.recordFailure(vendor._vendorId, err, Date.now() - startedAt);
      throw err;
    }
  }

  /**
   * @returns {{ adapterResponse: object, selectedVendor: object }}
   * @throws the last vendor error when every vendor in the chain fails
   */
  async run({ useCase, messages, promptBundle, temperature, maxTokens, tools, exclude, deadlineAt, requestId, emitEvent }) {
    const declaredChain = this._resolveChain(useCase);

    // `exclude` exists for the synthesis pass, which retries on a vendor OTHER
    // than the one that just failed to summarise its own tool results. Without
    // it the retry would re-select the same vendor at the head of the chain and
    // pay its timeout a second time — which, for a vendor that is hung rather
    // than merely slow, is the whole cost and none of the benefit.
    const eligible = Array.isArray(exclude) && exclude.length > 0
      ? declaredChain.filter((v) => !exclude.includes(v._vendorId))
      : declaredChain;

    // Declared order is preference; the scoreboard filters open circuits and
    // demotes slow-tail vendors based on what they have actually been doing.
    const preferred = this._scoreboard.orderChain(eligible);

    if (declaredChain.length === 0 || preferred.length === 0) {
      // An exclusion emptying the chain is an ordinary "nothing else to try",
      // not a misconfiguration — the caller falls back to raw tool results. Log
      // it at that weight so it does not read as an outage in the error stream.
      if (declaredChain.length > 0 && Array.isArray(exclude) && exclude.length > 0) {
        this._logger.warn('No alternative vendor available', { useCase, exclude });
        throw new Error(`No alternative AI vendor available for ${useCase}.`);
      }
      this._logger.error('No active vendor available for use case', { useCase });
      throw new VendorsExhaustedError('No active AI vendor available. Check vendor configuration.',
        { useCase, attempted: 0 });
    }

    // Vendors the breaker ejected. They are the last resort below rather than
    // simply discarded: with the preferred chain exhausted there is nothing left
    // to protect, and an open circuit is a heuristic about the recent past, not
    // proof about this request. Measured 2026-09-04 — one eligible vendor
    // failing produced a 500 while four ejected vendors were never asked.
    const ejected = eligible.filter((v) => !preferred.includes(v));

    const context = { messages, promptBundle, temperature, maxTokens, tools, useCase, requestId, emitEvent };
    let lastError;
    let attempted = 0;

    const walk = async (chain, { lastResort }) => {
      for (const vendor of chain) {
        // Below this, an attempt cannot plausibly finish and only burns what is
        // left of the caller's patience. Stopping early leaves time to return a
        // real error instead of having the connection cut mid-flight.
        const remainingMs = this._remainingMs(deadlineAt);
        if (remainingMs < MIN_ATTEMPT_MS) {
          this._logger.warn('Out of time before trying remaining vendors', {
            useCase, remainingMs, skipped: chain.length - attempted,
          });
          return null;
        }

        attempted += 1;
        try {
          const adapterResponse = await this._attempt(vendor, context, {
            tighten: attempted > 1,
            deadlineAt,
          });
          if (lastResort) {
            this._logger.info('Recovered on an ejected vendor after the preferred chain failed', {
              useCase, vendorId: vendor._vendorId,
            });
          }
          return { adapterResponse, selectedVendor: vendor };
        } catch (err) {
          if (emitEvent && attempted < chain.length) {
            void emitEvent({
              kind: 'fallback',
              requestId,
              vendor: vendor._vendorId,
              model: vendor._model,
              durationMs: 0,
              success: false,
              error: String(err.message || 'vendor failure').slice(0, 512),
              occurredAt: new Date().toISOString(),
            });
          }
          this._logger.warn('Vendor failed, trying next fallback', {
            vendorId: vendor._vendorId,
            error:    err.message,
            lastResort,
          });
          lastError = err;
        }
      }
      return null;
    };

    const fromPreferred = await walk(preferred, { lastResort: false });
    if (fromPreferred) return fromPreferred;

    // A vendor that is out of credits or holding a rejected key cannot start
    // working again inside this request, so retrying it spends the caller's
    // remaining time on a certainty. Transient and timeout failures are exactly
    // the ones worth another attempt.
    const worthRetrying = ejected.filter(
      (v) => !PERMANENT_FAILURE_CLASSES.has(this._scoreboard.failureClass(v._vendorId)),
    );

    if (worthRetrying.length > 0) {
      this._logger.warn('Preferred chain exhausted — escalating to ejected vendors', {
        useCase, candidates: worthRetrying.map((v) => v._vendorId),
      });
      const fromLastResort = await walk(worthRetrying, { lastResort: true });
      if (fromLastResort) return fromLastResort;
    }

    this._logger.error('All vendors in chain failed', {
      useCase,
      chainLength: preferred.length,
      escalated: worthRetrying.length,
    });
    throw new VendorsExhaustedError('All AI vendors exhausted — no response available', {
      cause: lastError, useCase, attempted,
    });
  }
}

module.exports = { ChainExecutor, VendorsExhaustedError };
