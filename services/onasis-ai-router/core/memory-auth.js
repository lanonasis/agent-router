'use strict';

/**
 * Credentials for memory API calls made ON BEHALF OF a caller.
 *
 * Rule: a memory call carries the caller's own credential and nothing else.
 *
 * Why this file exists — the identity leak, confirmed 2026-11-03:
 *
 * buildAuthHeaders() forwarded the caller's credential, then ADDED the
 * router's own MEMORY_API_KEY / MEMORY_AUTH_BEARER whenever the caller had
 * used the other header type. The Slack/Discord concierges authenticate with
 * the linked user's Bearer token, so every concierge memory call went out as
 *
 *   Authorization: Bearer <linked user>     ← the person actually asking
 *   X-API-Key:     <router service key>     ← the key's owner (admin)
 *
 * and the memory API resolves X-API-Key FIRST (verified live: a valid key plus
 * a garbage Bearer returns the key owner's results). Every concierge user
 * therefore searched the service key owner's memory bank — the "agents answer
 * from my admin memory" report — while req.uai, the prefetch cache key and
 * the logs all named the linked user, so nothing looked wrong.
 *
 * There is no request-scoped use for a service credential: the memory tools
 * and the prefetch only ever act for the person asking. A caller that sent no
 * credential gets no memory access at all, rather than someone else's.
 */

/** Env vars that used to be injected. Kept only to warn that they are ignored. */
const RETIRED_FALLBACK_VARS = ['MEMORY_API_KEY', 'MEMORY_AUTH_BEARER'];

/**
 * @returns {{ headers: object, hasCredential: boolean, credentialType: string|null }}
 */
function callerMemoryHeaders(req) {
  const h = (req && req.headers) || {};
  const headers = {};
  const authorization = typeof h.authorization === 'string' ? h.authorization.trim() : '';
  const apiKey = typeof h['x-api-key'] === 'string' ? h['x-api-key'].trim() : '';

  // Exactly what the caller authenticated with. If a caller sends both, both
  // are theirs; the router never adds one of its own.
  if (authorization) headers.Authorization = authorization;
  if (apiKey) headers['X-API-Key'] = apiKey;

  const uai = req && req.uai;
  if (uai && uai.authId) {
    headers['X-UAI-Auth-Id'] = uai.authId;
    headers['X-UAI-Organization'] = uai.organizationId || '';
    headers['X-UAI-Auth-Method'] = uai.authMethod || '';
    headers['X-UAI-Email'] = uai.email || '';
  }

  const hasCredential = Boolean(authorization || apiKey);
  return {
    headers,
    hasCredential,
    credentialType: apiKey ? 'api_key' : (authorization ? 'bearer' : null),
  };
}

/** One boot-time warning if the retired fallback vars are still configured. */
function warnIfRetiredFallbackConfigured(logger, env = process.env) {
  const set = RETIRED_FALLBACK_VARS.filter((name) => env[name]);
  if (set.length && logger && logger.warn) {
    logger.warn('Ignoring retired memory service credentials — memory calls use the caller\'s own credential only', {
      ignored: set,
    });
  }
  return set;
}

/** Tool payload for a request that carried no caller credential. */
const NO_CALLER_CREDENTIAL_PAYLOAD = JSON.stringify({
  error: 'Memory is not available for this request',
  category: 'not_authenticated',
  message: 'The request carried no user credential, so there is no memory bank to read. Ask the user to connect their account.',
});

module.exports = {
  callerMemoryHeaders,
  warnIfRetiredFallbackConfigured,
  NO_CALLER_CREDENTIAL_PAYLOAD,
  RETIRED_FALLBACK_VARS,
};
