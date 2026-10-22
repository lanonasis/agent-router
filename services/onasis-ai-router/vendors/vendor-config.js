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

/**
 * The token floor for agent-lane use cases.
 *
 * Spec §7: a use case that routes to an agent-lane vendor (stateful,
 * tool-using, multi-round-trip) needs room for the agent's own turn. The
 * incident this exists for: a 350-token ceiling pointed at a 72-tool agent,
 * which truncated every answer instead of failing loudly.
 *
 * `AGENT_LANE_MIN_TOKENS` moves the floor. A malformed value keeps the
 * default and warns — a typo must not disarm the check by making it
 * meaningless, and must never throw at boot.
 */
const DEFAULT_AGENT_LANE_MIN_TOKENS = 2000;

function resolveAgentLaneMinTokens({ onWarn } = {}) {
  const raw = (process.env.AGENT_LANE_MIN_TOKENS ?? '').trim();
  if (raw === '') return DEFAULT_AGENT_LANE_MIN_TOKENS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    onWarn?.(`AGENT_LANE_MIN_TOKENS is not a positive integer (${raw}) — keeping ${DEFAULT_AGENT_LANE_MIN_TOKENS}`);
    return DEFAULT_AGENT_LANE_MIN_TOKENS;
  }
  return parsed;
}

/**
 * Validate the lane typing of a use-case map against a vendor registry.
 *
 * Spec §7 of the outcome-driven routing design: a vendor declares a lane
 * ('completion' — stateless single call, or 'agent' — stateful, tool-using,
 * multi-round-trip), a use case declares the lane it needs, and the PAIRING
 * is checked rather than assumed. Two rules carry the weight:
 *
 *   1. A completion lane may not carry an agent-lane vendor. An agent
 *      gateway is stateful and multi-round-trip; a single stateless call is
 *      the wrong shape for it, and pairing it with a short ceiling is how
 *      the original truncation incident happened (a 350-token cap against a
 *      72-tool agent).
 *   2. An agent lane that carries an agent-lane vendor must have a token
 *      ceiling at or above AGENT_LANE_MIN_TOKENS — the EFFECTIVE ceiling,
 *      after any AI_MAX_TOKENS override, so an environment variable cannot
 *      smuggle a 350-token cap past the floor.
 *
 * Every violation is collected rather than thrown on, so an operator sees
 * every problem in one boot instead of one per restart.
 *
 * @param {object}        options
 * @param {object}        options.useCases          use-case map, keyed by use case
 * @param {object}        options.vendorRegistry    vendor registry
 * @param {Set<string>}  [options.knownVendorIds]  ids a chain may name
 * @param {number|null}  [options.minTokens]       agent-lane floor; read from the
 *                                                 environment when null/undefined
 * @param {function}     [options.onWarn]           receives floor-parse warnings
 * @returns {{ valid: boolean, violations: Array<object>, floor: number }}
 */
function validateLaneConfiguration({
  useCases,
  vendorRegistry,
  knownVendorIds = null,
  minTokens = null,
  onWarn,
} = {}) {
  const known = knownVendorIds || new Set(Object.keys(vendorRegistry || {}));
  const floor = (typeof minTokens === 'number' && Number.isFinite(minTokens) && minTokens > 0)
    ? minTokens
    : resolveAgentLaneMinTokens({ onWarn });

  const violations = [];
  const add = (code, useCase, message, extra = {}) =>
    violations.push({ code, useCase, message, ...extra });

  for (const [useCase, config] of Object.entries(useCases || {})) {
    const lane = config && config.lane;
    /**
 * Resolve the actual runtime chain (honours AI_VENDOR_ORDER* env overrides).
 * The declared vendorOrder is insufficient — the env escape hatch can inject
 * any vendor (including agent-lane ones) into a completion lane. The validator
 * must check what the router ACTUALLY executes, not what the source says.
 */
const chain = resolveVendorOrder(
  useCase,
  config.vendorOrder,
  { knownVendorIds: known, onWarn },
);

    // (a) The use case must declare which lane it needs.
    if (!lane) {
      add('use-case-lane-missing', useCase,
        `use case "${useCase}" declares no lane — every use case must declare "completion" or "agent"`);
    } else if (lane !== 'completion' && lane !== 'agent') {
      add('use-case-lane-invalid', useCase,
        `use case "${useCase}" declares an unknown lane "${lane}" — expected "completion" or "agent"`);
    }

    // (b) Every id in the chain must be a vendor this router knows.
    // (e) Every vendor in the chain must declare a lane of its own.
    const agentVendors = [];
    for (const vendorId of chain) {
      if (!known.has(vendorId)) {
        add('unknown-vendor', useCase,
          `use case "${useCase}" names unknown vendor "${vendorId}"`,
          { vendor: vendorId });
        continue;
      }
      const vendor = (vendorRegistry || {})[vendorId] || {};
      if (!vendor.lane) {
        add('vendor-lane-missing', useCase,
          `vendor "${vendorId}" (in the chain for "${useCase}") declares no lane — every vendor must declare "completion" or "agent"`,
          { vendor: vendorId });
        continue;
      }
      if (vendor.lane !== 'completion' && vendor.lane !== 'agent') {
        add('vendor-lane-invalid', useCase,
          `vendor "${vendorId}" declares an unknown lane "${vendor.lane}" — expected "completion" or "agent"`,
          { vendor: vendorId });
        continue;
      }
      if (vendor.lane === 'agent') agentVendors.push(vendorId);
    }

    // (d) A completion lane may not carry an agent-lane vendor.
    if (lane === 'completion') {
      for (const vendorId of agentVendors) {
        add('completion-lane-agent-vendor', useCase,
          `use case "${useCase}" is a completion lane but its chain includes agent-lane vendor "${vendorId}" — a completion lane must be served by completion-lane vendors only`,
          { vendor: vendorId });
      }
    }

    // (c) An agent lane that carries an agent-lane vendor needs the floor,
    // measured against the EFFECTIVE ceiling so no override can undercut it.
    if (lane === 'agent' && agentVendors.length > 0) {
      const effective = resolveMaxTokens(useCase, config.maxTokens, { onWarn });
      if (!Number.isFinite(effective)) {
        add('agent-lane-missing-max-tokens', useCase,
          `use case "${useCase}" is an agent lane with agent-lane vendor(s) ${agentVendors.map((v) => `"${v}"`).join(', ')} but has no usable maxTokens ceiling — it must be at least ${floor}`,
          { vendor: agentVendors[0] });
      } else if (effective < floor) {
        add('agent-lane-token-floor', useCase,
          `use case "${useCase}" is an agent lane with agent-lane vendor(s) ${agentVendors.map((v) => `"${v}"`).join(', ')} but its effective maxTokens is ${effective}, below the agent-lane floor of ${floor} — raise maxTokens or AGENT_LANE_MIN_TOKENS`,
          { vendor: agentVendors[0], maxTokens: effective, floor });
      }
    }
  }

  return { valid: violations.length === 0, violations, floor };
}

module.exports = {
  DEFAULT_AGENT_LANE_MIN_TOKENS,
  NEVER_ENABLE,
  envSuffix,
  parseList,
  pickModel,
  resolveAgentLaneMinTokens,
  resolveMaxTokens,
  resolveVendorOrder,
  resolveVendorStatus,
  validateLaneConfiguration,
};
