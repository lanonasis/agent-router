'use strict';

/**
 * Express middleware for the AI router.
 *
 * Extracted verbatim from core/ai-service-router.js (2026-08-27). The class
 * property arrow functions become factories so nothing captures `this`; the
 * router assigns the results to the same property names, so route wiring is
 * untouched.
 */

const crypto = require('crypto');
const { fetchWithRetry } = require('../vendors/_shared/http-client');
const { getAuthCache } = require('./auth-cache');

/**
 * Auth-gateway resolve timing — why these numbers.
 *
 * Measured 2026-09-26 against auth-gateway on this host, uncached -> cached:
 *
 *   JWT            3.2s -> 0.3s
 *   lano_ API key 10.1s -> 1.0s
 *
 * The old 3000ms per-attempt default sat BELOW both cold paths, so every cache
 * miss aborted and came back as a 503 AUTH_SERVICE_UNAVAILABLE (seen live at
 * 8.8s and 23.0s end to end). The caller's own retry then succeeded — only
 * because the aborted attempt had warmed the gateway's cache.
 *
 *  - Per attempt, 12000ms: the slowest measured cold lookup (10.1s) plus ~20%.
 *  - One retry, on timeout / network error / 5xx only. Never on 401/403: those
 *    are a verdict on the credential, and asking twice cannot change it.
 *  - Whole resolve, 20000ms: a first attempt that times out at 12s leaves the
 *    retry ~7.5s after backoff — 7x the measured warm lano_ lookup — while the
 *    default 55s request budget keeps >= 35s for the vendor chain.
 *  - The resolve is also clamped to the REQUEST budget, and the request clock
 *    starts here (req.requestStartedAt), so time spent authenticating is spent
 *    from the same deadline the vendor chain later measures against.
 */
const DEFAULT_AUTH_TIMEOUT_MS = 12000;
const DEFAULT_AUTH_BUDGET_MS = 20000;
// A warm lano_ resolve was measured at 1.0s; a retry with less than that left
// cannot succeed and only adds wait before the 503.
const AUTH_MIN_RETRY_WINDOW_MS = 1000;
// 5xx means the gateway failed to judge the credential. 429 is deliberately
// NOT here: retrying a rate limit immediately just deepens it.
const AUTH_RETRYABLE_STATUSES = [500, 502, 503, 504];

const positiveInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function createAuthMiddleware({
  authGatewayUrl,
  authTimeoutMs,
  authBudgetMs,
  logger,
  // Injectable for tests; production always uses the shared Redis-backed cache.
  authCache: injectedAuthCache,
}) {
  const attemptTimeoutMs = positiveInt(authTimeoutMs, DEFAULT_AUTH_TIMEOUT_MS);
  const resolveBudgetMs = positiveInt(authBudgetMs, DEFAULT_AUTH_BUDGET_MS);

  // Resolve auth via auth-gateway UAI endpoint. Result is cached in Redis
  // (keyed by a hash of the raw credential) for AUTH_CACHE_TTL_SECONDS so
  // repeat requests with the same credential skip the round-trip entirely —
  // shared across both PM2 replicas, unlike a per-process cache. A revoked
  // credential can stay honored here for up to the TTL after the auth-gateway
  // would reject it; kept short (default 20s) to bound that window.
  const authenticateRequest = async (req, res, next) => {
    // The request clock starts HERE, before the credential is resolved, so the
    // handler's deadline (core/ai-service-router.js _deadlineAt) counts auth
    // time rather than starting fresh after it. Never overwritten: a caller
    // earlier in the stack that already started the clock keeps its start.
    if (!Number.isFinite(req.requestStartedAt)) req.requestStartedAt = Date.now();

    const headers = {
      ...(req.headers['authorization'] && { 'Authorization': req.headers['authorization'] }),
      ...(req.headers['x-api-key'] && { 'X-API-Key': req.headers['x-api-key'] }),
      ...(req.headers['cookie'] && { 'Cookie': req.headers['cookie'] }),
      // The router is a surface chat concierges may use; the gateway accepts
      // concierge user tokens only for callers that declare it.
      'X-Lanonasis-Concierge-Audience': 'router',
      'User-Agent': 'Onasis-CORE/1.0'
    };

    // Hashing here is for a compact, collision-safe cache key — not a
    // security boundary. The raw credential is already in process memory.
    const cacheKey = `airouter:authcache:${crypto.createHash('sha256').update(JSON.stringify(headers)).digest('hex')}`;
    const authCache = injectedAuthCache || getAuthCache(logger);

    const cached = await authCache.get(cacheKey);
    if (cached) {
      req.uai = { ...cached, fromCache: true };
      return next();
    }

    const requestBudgetMs = positiveInt(process.env.REQUEST_BUDGET_MS, 55000);
    const deadlineAt = req.requestStartedAt + Math.min(resolveBudgetMs, requestBudgetMs);
    const resolveStartedAt = Date.now();
    let retried = null;

    // The credential was never judged: fail CLOSED, deliberately — an
    // unreachable or failing auth gateway must never be read as "allow". 503
    // rather than 401, because telling a caller their key is bad when we could
    // not check it sends them to rotate a key that was fine.
    const unavailable = (reason, detail) => {
      logger.error('Auth gateway resolution failed', {
        reason,
        ...(detail ? { error: detail } : {}),
        retried: retried ? retried.reason : false,
        elapsed_ms: Date.now() - resolveStartedAt,
      });
      // Same retry contract as the vendor-outage path in ai-service-router.js,
      // so a caller handling one outage handles both the same way.
      const retryAfterSeconds = parseInt(process.env.OUTAGE_RETRY_AFTER_SECONDS || '30', 10);
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(503).json({
        error: {
          message: 'Authentication service unavailable',
          code: 'AUTH_SERVICE_UNAVAILABLE',
          type: 'authentication_error',
          retry_after_seconds: retryAfterSeconds
        }
      });
    };

    let response;
    try {
      response = await fetchWithRetry(`${authGatewayUrl}/v1/auth/resolve`, {
        method: 'GET',
        headers,
        timeoutMs: attemptTimeoutMs,
        retries: 1,
        retryOnTimeout: true,
        retryableStatuses: AUTH_RETRYABLE_STATUSES,
        deadlineAt,
        minRetryWindowMs: AUTH_MIN_RETRY_WINDOW_MS,
        onRetry: (info) => {
          retried = info;
          logger.warn('Auth gateway resolve retrying', {
            reason: info.reason,
            ...(info.status ? { status: info.status } : {}),
            elapsed_ms: Date.now() - resolveStartedAt,
          });
        },
      });
    } catch (error) {
      const timedOut = error && error.name === 'AbortError';
      return unavailable(timedOut ? 'timeout' : 'network', error.message);
    }

    if (response.status >= 500) {
      return unavailable('upstream_status', `status ${response.status}`);
    }

    if (!response.ok) {
      return res.status(401).json({
        error: {
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
          type: 'authentication_error'
        }
      });
    }

    try {
      const data = await response.json();
      req.uai = {
        authId: data.authId || response.headers.get('x-uai-auth-id'),
        organizationId: data.organizationId || response.headers.get('x-uai-organization'),
        authMethod: data.authMethod || response.headers.get('x-uai-auth-method'),
        email: data.email || response.headers.get('x-uai-email'),
        fromCache: data.fromCache || response.headers.get('x-uai-from-cache') === 'true',
        // Profile activation inputs. Both come from the credential via UAI —
        // core/profile-resolver.js never reads them from a request header.
        //
        // Absent stays absent: `applicationEntitlements` is only set when the
        // gateway actually sent an array. A default of [] here would be
        // indistinguishable from "gateway returned nothing", and the resolver
        // deliberately separates those — an old gateway that cannot report
        // entitlements must refuse profiles, not appear to grant none.
        applicationId: data.applicationId
          || response.headers.get('x-uai-application-id')
          || undefined,
        ...(Array.isArray(data.applicationEntitlements)
          ? { applicationEntitlements: data.applicationEntitlements }
          : {}),
      };
    } catch (error) {
      // A 2xx whose body cannot be read (truncated, not JSON, aborted
      // mid-body) is still an unjudged credential.
      return unavailable('bad_response', error.message);
    }

    const ttlSeconds = parseInt(process.env.AUTH_CACHE_TTL_SECONDS || '20', 10);
    await authCache.set(cacheKey, req.uai, ttlSeconds);

    return next();
  };

  // Usage tracking middleware (lightweight)
  return authenticateRequest;
}

function createUsageTracker({ logger }) {
  const trackUsage = (req, res, next) => {
    const requestId = crypto.randomBytes(12).toString('hex');
    req.requestId = requestId;
    const startTime = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      logger.info('AI request completed', {
        request_id: requestId,
        status: res.statusCode,
        duration_ms: durationMs,
        service: req.params?.service,
        auth_id: req.uai?.authId
      });
    });

    next();
  };
  return trackUsage;
}

module.exports = {
  createAuthMiddleware,
  createUsageTracker,
  DEFAULT_AUTH_TIMEOUT_MS,
  DEFAULT_AUTH_BUDGET_MS,
};
