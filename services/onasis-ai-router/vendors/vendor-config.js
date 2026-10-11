'use strict';

/**
 * Vendor policy that can change without a deploy.
 *
 * Which vendor is tried first, and which vendors are in play at all, are
 * operational decisions — they change when a provider runs out of credit, when
 * an upstream token expires, or when one turns out to be slow for a particular
 * lane. Until now every one of those was a literal in `vendors/index.js`, so
 * reacting to any of them meant editing code and redeploying a live router.
 *
 * The concrete case that prompted this: `repl-nlp` led with `ollama`. The local
 * 3B CPU model is fine at deciding to call a tool and poor at reading a long
 * tool result back, so the synthesis pass timed out and every REPL search
 * degraded to a raw record dump. Nothing was broken — the order was simply
 * wrong for that lane, and fixing it should not require a release.
 *
 * Code defaults still exist and are still the source of truth when no override
 * is set. Env only overrides.
 */

/** `repl-nlp` -> `REPL_NLP`, for building the per-use-case env key. */
function envSuffix(useCase) {
  return String(useCase || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function parseList(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Vendors that may never be enabled from the environment, with the reason.
 *
 * `supabase-edge` is deprecated for two reasons that an env toggle must not be
 * able to undo: it points at VortexCore's own AI router — one of THIS router's
 * consuming applications, so enabling it creates a cycle — and it hardcodes a
 * product persona as the first system message, which no caller-side payload can
 * override. See the long note on its registry entry. A config flag is exactly
 * the wrong way to reintroduce either.
 */
const NEVER_ENABLE = new Map([
  ['supabase-edge', 'deprecated 2026-08-19: circular dependency and unfixable persona leak'],
]);

/**
 * The vendor order for a use case, most preferred first.
 *
 * Precedence, narrowest wins:
 *   1. `AI_VENDOR_ORDER_<USE_CASE>`  e.g. AI_VENDOR_ORDER_REPL_NLP
 *   2. `AI_VENDOR_ORDER`             every use case without its own key
 *   3. the code default
 *
 * Unknown vendor ids are dropped rather than failing the request: a typo in an
 * env var must not take the router down, and `resolveVendorChainForUseCase`
 * already skips anything ineligible. They are reported through `onWarn` so the
 * typo is still visible.
 */
function resolveVendorOrder(useCase, declaredOrder, { knownVendorIds, onWarn } = {}) {
  const scoped = process.env[`AI_VENDOR_ORDER_${envSuffix(useCase)}`];
  const global = process.env.AI_VENDOR_ORDER;
  const source = scoped ? `AI_VENDOR_ORDER_${envSuffix(useCase)}` : (global ? 'AI_VENDOR_ORDER' : null);
  const override = parseList(scoped || global);

  if (override.length === 0) {
    return Array.isArray(declaredOrder) ? declaredOrder : [];
  }

  const known = knownVendorIds instanceof Set ? knownVendorIds : null;
  const accepted = [];
  const unknown = [];
  for (const vendorId of override) {
    if (known && !known.has(vendorId)) {
      unknown.push(vendorId);
      continue;
    }
    accepted.push(vendorId);
  }

  if (unknown.length > 0) {
    onWarn?.(`${source} names unknown vendors: ${unknown.join(', ')}`);
  }

  // An override that resolves to nothing is a mistake, not an instruction to
  // serve nothing. Fall back to the code default rather than emptying the chain.
  if (accepted.length === 0) {
    onWarn?.(`${source} matched no known vendor — falling back to the built-in order`);
    return Array.isArray(declaredOrder) ? declaredOrder : [];
  }

  return accepted;
}

/**
 * A vendor's effective status, after environment overrides.
 *
 *   `AI_VENDOR_DISABLED=openclaw,openai`  take vendors out of every chain
 *   `AI_VENDOR_ENABLED=deepseek`          promote a stub to active
 *
 * Disable wins over enable: naming a vendor in both is contradictory, and the
 * safe reading of a contradiction is the one that serves less traffic.
 */
function resolveVendorStatus(vendorId, declaredStatus, { onWarn } = {}) {
  if (parseList(process.env.AI_VENDOR_DISABLED).includes(vendorId)) {
    return 'disabled';
  }

  if (parseList(process.env.AI_VENDOR_ENABLED).includes(vendorId)) {
    const blockedReason = NEVER_ENABLE.get(vendorId);
    if (blockedReason) {
      onWarn?.(`AI_VENDOR_ENABLED cannot enable ${vendorId} — ${blockedReason}`);
      return declaredStatus;
    }
    return 'active';
  }

  return declaredStatus;
}

/**
 * First defined, non-empty value — for `MODEL || FALLBACK || 'literal'` chains
 * where an unset variable reads as an empty string rather than undefined.
 */
function pickModel(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return undefined;
}


/**
 * The output token ceiling for a use case.
 *
 * Precedence matches resolveVendorOrder(): `AI_MAX_TOKENS_<USE_CASE>`, then
 * `AI_MAX_TOKENS`, then the code default.
 *
 * This is a ceiling on the ANSWER, and setting it too low does not produce a
 * shorter answer — it produces a truncated one, cut mid-word, with no signal to
 * the caller that anything is missing. Measured 2026-09-04 on `ask-ai`, whose
 * default was 350: MiniMax needed 411-511 tokens to finish "How do I rotate my
 * API key?", so every reply to that question was chopped mid-sentence.
 */
function resolveMaxTokens(useCase, declared, { onWarn } = {}) {
  const scoped = process.env[`AI_MAX_TOKENS_${envSuffix(useCase)}`];
  const global = process.env.AI_MAX_TOKENS;
  const raw = (scoped ?? global ?? '').trim();
  if (raw === '') return declared;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    onWarn?.(`AI_MAX_TOKENS override for ${useCase} is not a positive integer (${raw}) — keeping ${declared}`);
    return declared;
  }
  return parsed;
}

module.exports = {
  NEVER_ENABLE,
  envSuffix,
  parseList,
  pickModel,
  resolveMaxTokens,
  resolveVendorOrder,
  resolveVendorStatus,
};
