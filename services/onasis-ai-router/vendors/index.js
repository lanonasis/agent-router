'use strict';

/**
 * Onasis AI Vendor Abstraction Layer
 *
 * Design rules (per vendor-abstraction skill):
 *  - Client APIs are USE-CASE based — never model/vendor specific
 *  - Vendor identifiers, model names, API keys, and endpoints are NEVER
 *    exposed in client-facing responses or logs at the info level
 *  - Only this module decides which vendor + model handles each use case
 *  - Adding a new vendor requires registering all supported use-cases here
 *    before the vendor status is changed from 'stub' → 'active'
 *  - Removing a vendor requires a deprecation entry for ≥ 30 days first
 */

const { stripToolMarkup } = require('./_shared/tool-markup');
const path = require('path');
const { pickModel, resolveMaxTokens, resolveVendorOrder, resolveVendorStatus } = require('./vendor-config');

// ─── Use-Case Registry ───────────────────────────────────────────────────────
//
// Defines WHAT the platform needs, not HOW any vendor fulfills it.
// Clients only ever send a use_case string; they never see model names.

// `vendorOrder` is the REAL vendor fallback order for a use case, tried
// left-to-right. It exists because the previous `vendorPriority` field was
// badly misnamed: it never selected a vendor at all — it only picked which
// MODEL LANE to use *within* whichever vendor the chain happened to land on,
// while vendor selection was implicitly "first active vendor in
// VENDOR_REGISTRY key order that supports this use case" (always `ollama`).
// That made `openclaw`/`hermes` structurally unreachable regardless of config
// and forced every interactive surface onto a CPU-bound local model.
// It is retained below as `modelLane` — same values, honest name.
//
// Ordering principle: interactive, user-facing surfaces (someone is watching a
// spinner) lead with fast cloud vendors and keep local LM Studio only as a
// last-resort; batch/tolerant lanes (code, content) lead with free local
// inference and escalate to cloud only on failure.
// (Local vendor was ollama until 2026-09-18, replaced by lmstudio — see
// VENDOR_REGISTRY below for why.)
const USE_CASES = {
  'landing-guide': {
    description: 'Onboarding AI guide on landing pages',
    // Raised from 400 by analogy with ask-ai below, whose ceiling was measured.
    // This lane has not been sampled directly; the truncation warning in
    // _noteTruncation will say so if 1000 also turns out to be short.
    maxTokens: 1000,
    temperature: 0.7,
    systemPromptKey: 'onboarding',
    modelLane: 'lana',   // LANA (Reasoning/Planning)
    vendorOrder: ['pi', 'minimax', 'openclaw', 'openai', 'anthropic', 'lmstudio'],
    streamable: false,
  },
  'ask-ai': {
    description: 'Quick "Ask AI" button on index and dashboard pages',
    // Raised from 350 on 2026-09-04, after every reply to "How do I rotate my
    // API key?" came back cut mid-word.
    //
    // A ceiling does not shorten an answer, it truncates one — and this lane's
    // ceiling was being spent on invisible work. MiniMax-M3 is a reasoning
    // model: `completion_tokens_details.reasoning_tokens` counts against
    // max_tokens but never appears in the content. Against this router's full
    // system prompt it reasons heavily — one measured reply spent ~720 of 800
    // tokens thinking and returned 321 characters of prose.
    //
    // So the number is set from measurement, not arithmetic. At 1500 all five
    // sampled replies finished on their own (322/450/625/976/620 completion
    // tokens, none hitting the cap); at 800, three of five were still cut. 800
    // was tried first and was not enough.
    maxTokens: 1500,
    temperature: 0.65,
    systemPromptKey: 'concise-helper',
    modelLane: 'lana',
    vendorOrder: ['pi', 'minimax', 'openclaw', 'openai', 'anthropic', 'lmstudio'],
    streamable: false,
  },
  'dashboard-assistant': {
    description: 'Full AI assistant panel inside user dashboards',
    maxTokens: 1200,
    temperature: 0.75,
    systemPromptKey: 'full-assistant',
    modelLane: 'lana',
    vendorOrder: ['pi', 'minimax', 'openclaw', 'openai', 'anthropic', 'lmstudio'],
    streamable: true,
  },
  'support-chat': {
    description: 'Customer support and help desk conversations',
    maxTokens: 800,
    temperature: 0.6,
    systemPromptKey: 'support',
    modelLane: 'lana',
    vendorOrder: ['pi', 'minimax', 'openclaw', 'openai', 'anthropic', 'lmstudio'],
    streamable: false,
  },
  'content-generation': {
    description: 'Marketing copy, summaries, and content creation',
    maxTokens: 2000,
    temperature: 0.85,
    systemPromptKey: 'creative',
    modelLane: 'coda',
    vendorOrder: ['minimax', 'pi', 'openclaw', 'openai', 'anthropic', 'lmstudio'],
    streamable: false,
  },
   'code-assist': {
     description: 'Developer and technical assistance',
     maxTokens: 2000,
     temperature: 0.2,
     systemPromptKey: 'technical',
     modelLane: 'coda',
     vendorOrder: ['minimax', 'pi', 'openclaw', 'openai', 'anthropic', 'lmstudio'],
     streamable: false,
   },
   'memory-analysis': {
     description: 'Memory intelligence pattern analysis and insights',
     maxTokens: 2000,
     temperature: 0.3,
     systemPromptKey: 'memory-intelligence',
     modelLane: 'mira',
     // Interactive: backs the IDE-extension concierge chat box and the
     // Slack/Discord memory concierge — latency-sensitive, cloud-first.
     vendorOrder: ['minimax', 'pi', 'openclaw', 'openai', 'anthropic', 'lmstudio'],
     streamable: false,
   },
   'memory-analysis-json': {
     description: 'Memory intelligence tasks for the edge functions, answered in bare JSON',
     // Reached through POST /api/v1/internal/memory-analysis (core/memory-analysis.js),
     // which builds the request itself. Same budget as memory-analysis: the
     // first-choice vendor is a reasoning model whose hidden reasoning counts
     // against max_tokens, and a truncated JSON reply is unparseable.
     maxTokens: 2000,
     temperature: 0.3,
     systemPromptKey: 'memory-analysis-json',
     modelLane: 'mira',
     vendorOrder: ['minimax', 'pi', 'openclaw', 'openai', 'anthropic', 'lmstudio'],
     streamable: false,
   },
   'repl-nlp': {
     description: 'REPL CLI natural language command interpretation',
     maxTokens: 1500,
     temperature: 0.2,
     systemPromptKey: 'repl-assistant',
     modelLane: 'coda',
     vendorOrder: ['pi', 'minimax', 'openclaw', 'openai', 'anthropic', 'lmstudio'],
     streamable: false,
   },
 };

// Default use case when none is specified in the request
const DEFAULT_USE_CASE = 'ask-ai';

// ─── System Prompt Templates ─────────────────────────────────────────────────
//
// All prompts are Onasis-branded. Vendor / model names MUST NOT appear here.

// ─── Lane prompts ────────────────────────────────────────────────────────────
//
// The lane prompt — who the agent is for a given use case — lives in the
// model-file corpus under `agent_model_files/lanes/`, next to SOUL.md and the
// role prompts it gets composed with.
//
// Until 2026-09-11 these were string literals here while the rest of the
// persona sat in the corpus: two prompt systems over one key space, with
// different owners, different formats, and only one of them overridable
// without a redeploy. Registering a use case meant editing both, and nothing
// compared them. They are one system now — `core/prompt-composer.js` resolves
// both halves from the single table in `DEFAULT_USE_CASE_PROMPTS`.
//
// The text is unchanged by that move: `test/prompt-system-merge.test.js` pins
// each lane against the literal it replaced.

let laneComposer = null;

function laneCorpus() {
  if (!laneComposer) {
    const { PromptComposer } = require('../core/prompt-composer');
    laneComposer = new PromptComposer();
  }
  return laneComposer;
}

// Test seam: `PROMPTS_ROOT` is read when the composer is built, so a suite that
// repoints the corpus mid-run needs the cached one dropped.
function resetLaneCorpus() {
  laneComposer = null;
}

function systemPromptForUseCase(useCaseConfig) {
  return laneCorpus().lanePromptForKey(useCaseConfig.systemPromptKey);
}

// ─── Vendor Registry ─────────────────────────────────────────────────────────
//
// Everything in this object is INTERNAL. It must never be serialised
// into a client response or surfaced in info-level logs.
//
// status values:
//   'active'     — fully wired, routes live traffic
//   'stub'       — file present but NOT wired; traffic falls through to active
//   'deprecated' — traffic migrated away; remove after deprecationDate

const ALL_USE_CASES = [
  'landing-guide', 'ask-ai', 'dashboard-assistant',
  'support-chat', 'content-generation', 'code-assist',
  'memory-analysis', 'memory-analysis-json', 'repl-nlp',
];

const DEFAULT_CODA_MODEL =
  process.env.OLLAMA_CODA_MODEL ||
  process.env.OLLAMA_OPS_MODEL ||
  'qwen2.5-coder-ops:latest';

// The original branded lanes (lana/mira) used smaller local models that are no
// longer present on this host. Fall back to a currently-installed general model
// so persona-sensitive routes stay on Ollama instead of dropping into the
// incompatible Supabase edge fallback.
const DEFAULT_GENERAL_MODEL =
  process.env.OLLAMA_GENERAL_MODEL ||
  process.env.OLLAMA_FAST_MODEL ||
  'qwen2.5-coder:3b';

const DEFAULT_LANA_MODEL =
  process.env.OLLAMA_LANA_MODEL ||
  DEFAULT_GENERAL_MODEL;

const DEFAULT_MIRA_MODEL =
  process.env.OLLAMA_MIRA_MODEL ||
  DEFAULT_GENERAL_MODEL;

const RETIRED_OLLAMA_MODEL_ALIASES = {
  coda: DEFAULT_CODA_MODEL,
  'code-assistant': DEFAULT_CODA_MODEL,
  'onasis-coder': DEFAULT_CODA_MODEL,
  'onasis-tester': DEFAULT_CODA_MODEL,
  'onasis-architect': DEFAULT_CODA_MODEL,
  'onasis-researcher': DEFAULT_CODA_MODEL,
  lana: DEFAULT_LANA_MODEL,
  'onasis-reviewer': DEFAULT_LANA_MODEL,
  mira: DEFAULT_MIRA_MODEL,
};

function resolveOllamaModel(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const model = candidate.trim();
    if (!model) continue;
    return RETIRED_OLLAMA_MODEL_ALIASES[model] || model;
  }
  return 'qwen2.5-coder:3b';
}

const VENDOR_REGISTRY = {
  // ── Primary: local LM Studio ───────────────────────────────────────────────
  // Added 2026-09-18, replacing ollama as the local/free vendor in every
  // vendorOrder chain below. Measured ~12x faster than ollama on this host
  // for the same coder model, and the server is systemd-managed
  // (/etc/systemd/system/lmstudio.service, survives reboots) — ollama's
  // equivalent process had been running unmanaged since manual start.
  // Only `qwen2.5-coder-ops` is confirmed loaded/working on this host
  // (verified via a real chat completion, not just /v1/models); every lane
  // below defaults to it. Set LMSTUDIO_*_MODEL env vars once other models
  // (e.g. a genuinely small "speed" model) are loaded and confirmed working.
  lmstudio: {
    status: 'active',
    adapter: require('./lmstudio/adapter'),
    // Model names are internal — clients never see them
    models: {
      speed:   pickModel(process.env.LMSTUDIO_FAST_MODEL, 'qwen2.5-coder-ops'),
      quality: pickModel(process.env.LMSTUDIO_QUALITY_MODEL, 'qwen2.5-coder-ops'),
      lana:    pickModel(process.env.LMSTUDIO_LANA_MODEL, 'qwen2.5-coder-ops'),
      mira:    pickModel(process.env.LMSTUDIO_MIRA_MODEL, 'qwen2.5-coder-ops'),
      coda:    pickModel(process.env.LMSTUDIO_CODA_MODEL, 'qwen2.5-coder-ops'),
    },
    capabilities: ALL_USE_CASES,
    // Fallback chain when local inference is unavailable
    fallbackVendor: 'openai',
  },

  // ── DEPRECATED 2026-09-18: replaced by lmstudio ─────────────────────────────
  //
  // Superseded by the lmstudio adapter above — same local/free role, ~12x
  // faster measured on this host, and its systemd unit actually persists
  // across reboots (this ollama.service instance had been running unmanaged
  // since a manual `lms`-style start until this session set that up too).
  // Its only pulled model (qwen2.5-coder-ops:latest) was removed to reclaim
  // disk and OLLAMA_KEEP_ALIVE was set to 0, so this vendor would 404 on
  // every call even if re-activated — the ollama.service systemd unit is
  // kept running only for `ollama: cloud` usage, not local inference.
  // Status 'deprecated' removes it from every chain (resolveVendorChainForUseCase
  // only walks active vendors) while keeping the adapter on disk. Do NOT flip
  // this back to 'active' without re-pulling a model first.
  ollama: {
    status: 'deprecated',
    deprecationDate: '2026-09-18',
    adapter: require('./ollama/adapter'),
    // Model names are internal — clients never see them
    models: {
      speed:   resolveOllamaModel(process.env.OLLAMA_FAST_MODEL, process.env.OLLAMA_MODEL, 'llama3.2:1b'),
      quality: resolveOllamaModel(process.env.OLLAMA_QUALITY_MODEL, process.env.OLLAMA_MODEL, 'qwen2.5-coder:3b'),
      lana: resolveOllamaModel(
        process.env.OLLAMA_LANA_MODEL,
        process.env.OLLAMA_GENERAL_MODEL,
        process.env.OLLAMA_FAST_MODEL,
        DEFAULT_LANA_MODEL,
        process.env.OLLAMA_MODEL
      ),
      mira: resolveOllamaModel(
        process.env.OLLAMA_MIRA_MODEL,
        process.env.OLLAMA_GENERAL_MODEL,
        process.env.OLLAMA_FAST_MODEL,
        DEFAULT_MIRA_MODEL,
        process.env.OLLAMA_MODEL
      ),
      coda: resolveOllamaModel(
        process.env.OLLAMA_CODA_MODEL,
        process.env.OLLAMA_QUALITY_MODEL,
        process.env.OLLAMA_MODEL,
        'qwen2.5-coder:3b'
      ),
    },
    capabilities: ALL_USE_CASES,
    // End of chain — no further fallback
    fallbackVendor: null,
  },

  // ── DEPRECATED 2026-08-19: circular dependency + unfixable persona leak ────
  //
  // This adapter targets mxtsdgkwzjzlttpotole/functions/v1/ai-router, which is
  // VORTEXCORE'S OWN AI ROUTER — one of THIS router's consuming applications.
  // That inverts the intended architecture (VortexCore → Onasis router) into a
  // cycle: Onasis router → VortexCore ai-router → (VortexCore calls Onasis).
  // A shared platform router must never fall back into one consuming product.
  //
  // It is also the confirmed root cause of the "VortexCore digital banker"
  // persona leak. Verified against the deployed edge function source
  // (Supabase Management API, 2026-08-19): it HARDCODES its own persona as the
  // first system message and appends the caller's messages after it —
  //     const conversation = [
  //       { role: 'system', content: VORTEX_SYSTEM_PROMPT },   // "You are
  //       ...messages.slice(-8)...                             //  VortexAI,
  //     ];                                                     //  digital banker"
  // so a caller's system prompt can never replace it. An earlier same-day fix
  // in vendors/supabase-edge/adapter.js (forwarding systemPrompt as a
  // role:'system' message) reduced but could not eliminate the leak, because
  // no caller-side payload can override a server-side hardcoded prepend. It
  // also truncates to the last 8 messages and rewrites role:'tool' → 'assistant',
  // silently corrupting this router's tool-calling contract.
  //
  // Status 'deprecated' removes it from every chain (resolveVendorChainForUseCase
  // only walks active vendors) while keeping the adapter on disk. Do NOT flip
  // this back to 'active'. If a last-resort managed fallback is wanted later, it
  // must be a NEUTRAL Onasis-owned endpoint that honors the caller's system
  // prompt verbatim — not any single product's assistant.
  'supabase-edge': {
    status: 'deprecated',
    deprecationDate: '2026-08-19',
    adapter: require('./supabase-edge/adapter'),
    models: {
      // 'auto' signals that the edge function picks the model internally
      speed:   'auto',
      quality: 'auto',
    },
    capabilities: ALL_USE_CASES,
    // End of chain — no further fallback
    fallbackVendor: null,
  },

  // ── Cloud fallbacks (active) ───────────────────────────────────────────────
  anthropic: {
    status: 'active',
    adapter: require('./anthropic/adapter'),
    models: {
      speed:   pickModel(process.env.ANTHROPIC_FAST_MODEL, 'claude-3-5-haiku-latest'),
      quality: pickModel(process.env.ANTHROPIC_QUALITY_MODEL, 'claude-3-5-sonnet-latest'),
    },
    capabilities: ALL_USE_CASES,
    fallbackVendor: null,
  },

   openai: {
     status: 'active',
     adapter: require('./openai/adapter'),
     models: {
       speed:   pickModel(process.env.OPENAI_FAST_MODEL, 'gpt-4o-mini'),
       quality: pickModel(process.env.OPENAI_QUALITY_MODEL, 'gpt-4o'),
     },
     capabilities: ALL_USE_CASES,
     fallbackVendor: 'anthropic',
   },

   // ── External: MiniMax (OpenAI-compatible) ─────────────────────────────────
   // Added 2026-08-19. Fast (~3s) and, at the time of writing, the only cloud
   // vendor here with working credit — openai and anthropic are both
   // zero-balance, so this is what actually keeps the cloud tier of every
   // chain alive. Key comes from MINIMAX_API_KEY (.env.production).
   minimax: {
     status: 'active',
     adapter: require('./minimax/adapter'),
     models: {
       speed:   pickModel(process.env.MINIMAX_FAST_MODEL, 'MiniMax-M3'),
       quality: pickModel(process.env.MINIMAX_QUALITY_MODEL, 'MiniMax-M3'),
     },
     capabilities: ALL_USE_CASES,
     fallbackVendor: null,
   },

   // ── Local agent CLI: Pi (subprocess, normalised contract) ─────────────────
   // Added 2026-09-04. Unlike every other entry here, this is not an HTTP
   // endpoint — vendors/pi/adapter.js spawns the `pi` CLI per request.
   //
   // What it buys is one spelling for controls each vendor names differently.
   // The truncation incident that prompted it: MiniMax-M3 counts reasoning
   // tokens against max_tokens without putting them in the content, so an
   // `ask-ai` reply spent ~720 of 800 tokens thinking and returned 321
   // characters, cut mid-word. Through Pi with `--thinking off` the same
   // question answered completely in 58 completion tokens and 2.2s.
   //
   // The adapter strips Pi to the minimum on every call — no tools, no
   // extensions, no skills, no prompt templates, no context files, no session —
   // and never uses Pi's own defaults, which on this host point at the `hetz`
   // credential that has been returning 401. See the adapter header; several of
   // those flags are load-bearing rather than tidy.
   //
   // Leads the short conversational lanes (ask-ai, repl-nlp, dashboard-assistant,
   // support-chat, landing-guide), where someone is waiting on a spinner and the
   // answer is prose. Measured on ask-ai over four requests each:
   //
   //     pi first        mean  4.1s, 178-659 completion tokens
   //     minimax first   mean 25.6s, 583-1222 completion tokens
   //
   // Six concurrent calls all succeeded in 3.3s, so the process-per-request
   // shape holds under load. Only ask-ai was measured directly; the other four
   // share its shape. The analytical lanes (code-assist, content-generation,
   // memory-analysis) keep minimax first — reasoning may well earn its cost
   // there, and that has NOT been measured.
   pi: {
     status: 'active',
     adapter: require('./pi/adapter'),
     models: {
       speed:   pickModel(process.env.PI_FAST_MODEL, process.env.PI_MODEL, 'MiniMax-M3'),
       quality: pickModel(process.env.PI_QUALITY_MODEL, process.env.PI_MODEL, 'MiniMax-M3'),
     },
     capabilities: ALL_USE_CASES,
     fallbackVendor: null,
   },

   // ── External: DeepSeek API ────────────────────────────────────────────────
   deepseek: {
     status: 'stub',
     adapter: require('./deepseek/adapter'),
     models: {
       speed:   pickModel(process.env.DEEPSEEK_FAST_MODEL, 'deepseek-chat'),
       quality: pickModel(process.env.DEEPSEEK_QUALITY_MODEL, 'deepseek-reasoner'),
     },
      capabilities: ['dashboard-assistant', 'content-generation', 'code-assist', 'support-chat', 'ask-ai', 'memory-analysis', 'memory-analysis-json', 'repl-nlp'],
     fallbackVendor: null,
   },

   // ── Multi-channel gateway: OpenClaw (fronts multiple Pi-embedded agents) ──
   openclaw: {
     status: 'active',
     adapter: require('./openclaw/adapter'),
     // The gateway rewrites an incomplete agent turn into a 200 whose content
     // is this string (see journal: "stopReason=length ... surfacing error to
     // user"). Verified live 2026-08-26. A blocklist entry, not the strategy —
     // see vendors/_shared/response-contract.js.
     errorSentinels: [/^\u26A0\uFE0F\s*Agent couldn't generate a response/i],
     models: {
       // Model selection is internal to the adapter (agent routing by
       // use-case, see USE_CASE_AGENT in vendors/openclaw/adapter.js) —
       // 'auto' signals that the registry's models map isn't consulted.
       speed:   'auto',
       quality: 'auto',
     },
     capabilities: ALL_USE_CASES,
     fallbackVendor: null,
   },

   // ── Tailscale-only execution surface: Hermes Gateway ──────────────────────
   // STUB — chat endpoint path is unverified (see vendors/hermes/adapter.js
   // header). Do not flip to 'active' until that's confirmed.
   hermes: {
     status: 'stub',
     adapter: require('./hermes/adapter'),
     models: {
       speed:   pickModel(process.env.HERMES_FAST_MODEL, 'Hermes Agent'),
       quality: pickModel(process.env.HERMES_QUALITY_MODEL, 'Hermes Agent'),
     },
     capabilities: ALL_USE_CASES,
     fallbackVendor: null,
   },
};

// Warnings from vendor-config reach the process log rather than a request
// logger: these describe a misconfigured environment, which is an operator
// problem visible at boot, not something a caller can act on.
const warnConfig = (message) => console.warn(`[vendors] ${message}`);

const KNOWN_VENDOR_IDS = new Set(Object.keys(VENDOR_REGISTRY));

/** A vendor is in play only if the ENVIRONMENT also agrees it is active. */
function isVendorActive(vendorId, vendorConfig) {
  return Boolean(vendorConfig)
    && resolveVendorStatus(vendorId, vendorConfig.status, { onWarn: warnConfig }) === 'active';
}

/** The declared order for a use case, after any environment override. */
function orderForUseCase(useCase, useCaseConfig) {
  return resolveVendorOrder(useCase, useCaseConfig.vendorOrder, {
    knownVendorIds: KNOWN_VENDOR_IDS,
    onWarn: warnConfig,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve the best active vendor for a given use case.
 *
 * Returns an internal config object. This MUST NOT be returned directly
 * in any API response — call sanitizeVendorResponse() first.
 *
 * @param {string} useCase - One of the keys in USE_CASES
 * @returns {{ _vendorId, _model, _adapter, systemPrompt, maxTokens, temperature, streamable }}
 */
function resolveVendorForUseCase(useCase) {
  const useCaseConfig = USE_CASES[useCase] || USE_CASES[DEFAULT_USE_CASE];
  // See resolveVendorChainForUseCase: modelLane selects the model within a
  // vendor; vendorPriority is its pre-2026-08-19 name, read as a fallback.
  const modelLane = useCaseConfig.modelLane || useCaseConfig.vendorPriority;

  // Find active vendors that declare support for this use case, honouring the
  // use case's explicit vendorOrder first so this agrees with the chain
  // resolver instead of silently returning registry-key order (always ollama).
  const isEligible = (vendor, vendorId) =>
    vendor &&
    isVendorActive(vendorId, vendor) &&
    vendor.capabilities.includes(useCase);

  const declaredOrder = orderForUseCase(useCase, useCaseConfig);
  const ordered = Array.isArray(declaredOrder) && declaredOrder.length > 0
    ? useCaseConfig.vendorOrder
        .map((id) => [id, VENDOR_REGISTRY[id]])
        .filter(([vendorId, vendor]) => isEligible(vendor, vendorId))
    : [];

  const candidates = ordered.length > 0
    ? ordered
    : Object.entries(VENDOR_REGISTRY).filter(([vendorId, vendor]) => isEligible(vendor, vendorId));

  // Fallback: any active vendor if none explicitly supports this use case
  if (candidates.length === 0) {
    const fallback = Object.entries(VENDOR_REGISTRY).find(([id, v]) => isVendorActive(id, v));
    if (!fallback) {
      throw new Error('No active AI vendor available. Check vendor configuration.');
    }
    candidates.push(fallback);
  }

  // Future: add load-balancing / cost-optimisation logic here.
  // For now: pick the first eligible active vendor.
  const [vendorId, vendorConfig] = candidates[0];

  const systemPrompt = systemPromptForUseCase(useCaseConfig);

  // Internal config — NEVER expose directly to clients
  return {
    _vendorId:   vendorId,
    _model:      vendorConfig.models[modelLane] || vendorConfig.models.speed,
    _adapter:    vendorConfig.adapter,
    systemPrompt,
    maxTokens:   resolveMaxTokens(useCase, useCaseConfig.maxTokens, { onWarn: warnConfig }),
    temperature: useCaseConfig.temperature,
    streamable:  useCaseConfig.streamable,
  };
}

/**
 * Resolve an ordered fallback chain of active vendors for a given use case.
 *
 * Returns vendors in priority order: primary first, then each fallbackVendor
 * in the chain. Only 'active' vendors are included.
 *
 * The caller tries each vendor in order and stops at the first success.
 * This keeps the client API completely transparent to outages.
 *
 * @param {string} useCase - One of the keys in USE_CASES
 * @returns {Array<{ _vendorId, _model, _adapter, systemPrompt, maxTokens, temperature, streamable }>}
 */
function resolveVendorChainForUseCase(useCase) {
  const useCaseConfig = USE_CASES[useCase] || USE_CASES[DEFAULT_USE_CASE];
  // `modelLane` picks the model WITHIN a vendor; `vendorOrder` picks the
  // vendors themselves. `vendorPriority` is the pre-2026-08-19 name for
  // modelLane, still read as a fallback so an older/partial config can't
  // silently resolve every lane to `models.speed`.
  const modelLane = useCaseConfig.modelLane || useCaseConfig.vendorPriority;

  const systemPrompt = systemPromptForUseCase(useCaseConfig);

  const buildLink = (vendorId, vendorConfig) => ({
    _vendorId:   vendorId,
    _model:      vendorConfig.models[modelLane] || vendorConfig.models.speed,
    _adapter:    vendorConfig.adapter,
    systemPrompt,
    maxTokens:   resolveMaxTokens(useCase, useCaseConfig.maxTokens, { onWarn: warnConfig }),
    temperature: useCaseConfig.temperature,
    streamable:  useCaseConfig.streamable,
  });

  const isEligible = (vendorConfig, vendorId) =>
    vendorConfig &&
    isVendorActive(vendorId, vendorConfig) &&
    vendorConfig.capabilities.includes(useCase);

  // ── Preferred path: explicit, use-case-specific vendor order ──────────────
  // Skips vendors that are missing/deprecated/incapable rather than stopping
  // at the first gap, so deprecating one vendor never truncates a whole chain.
  const declaredOrder = orderForUseCase(useCase, useCaseConfig);
  if (Array.isArray(declaredOrder) && declaredOrder.length > 0) {
    const seen = new Set();
    const chain = [];
    for (const vendorId of declaredOrder) {
      if (seen.has(vendorId)) continue;
      seen.add(vendorId);
      const vendorConfig = VENDOR_REGISTRY[vendorId];
      if (!isEligible(vendorConfig, vendorId)) continue;
      chain.push(buildLink(vendorId, vendorConfig));
    }
    if (chain.length > 0) return chain;
    // Fall through to the legacy walk only if vendorOrder yielded nothing
    // (e.g. every named vendor is down) — better a stale-but-working chain
    // than an empty one.
  }

  // ── Legacy path: registry-order primary + fallbackVendor pointer walk ─────
  // Retained for any use case that has no vendorOrder yet.
  const chain = [];
  const visited = new Set();

  const primaryEntry = Object.entries(VENDOR_REGISTRY).find(
    ([id, v]) => isEligible(v, id)
  );
  if (!primaryEntry) {
    // No active vendor — return empty chain; caller will throw
    return chain;
  }

  let [currentId] = primaryEntry;

  // Walk the fallback chain, collecting each vendor config
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const vendorConfig = VENDOR_REGISTRY[currentId];
    if (!vendorConfig || vendorConfig.status !== 'active') break;

    if (vendorConfig.capabilities.includes(useCase)) {
      chain.push(buildLink(currentId, vendorConfig));
    }

    currentId = vendorConfig.fallbackVendor || null;
  }

  return chain;
}

/**
 * Strip all vendor-specific fields from a raw response before returning
 * it to the client. Adds Onasis metadata.
 *
 * @param {object} rawResponse
 * @param {string} useCase
 * @returns {object}
 */
function sanitizeVendorResponse(rawResponse, useCase) {
  const clean = Object.assign({}, rawResponse);

  // Hard-remove every field that could identify the vendor or model
  const vendorLeakFields = [
    'model', 'provider', 'backend', 'vendor', 'engine',
    'deployment_id', 'system_fingerprint', 'object',
    'ai_service_provider',                  // stripped from Onasis branding block too
  ];
  for (const field of vendorLeakFields) {
    delete clean[field];
  }

  // Text-level persona enforcement. Base models answer "who are you?" from
  // training data despite system-prompt instructions, and agent-gateway
  // vendors can bleed their own platform identity through. Field stripping
  // can't catch text, so rewrite the worst self-identification shapes here —
  // the hard stop that keeps every response Onasis-branded. (The VortexCore
  // vector was removed structurally in commit 3db9287; this closes the
  // text-level gap for every vendor, including openclaw/hermes gateways.)
  //
  // In-text tool-call markup and chat-template control tokens are removed
  // FIRST. Order matters: `]<]…[>[` is a vendor template delimiter that
  // carries a vendor name, and running the persona rewrite over it first is
  // what produced `]<]Onasis[>[` in a live repl-nlp answer (2026-09-26) — the
  // name was masked but the delimiter and the `<tool_call>` after it were
  // passed through. The router already strips this on the first and
  // follow-up passes; this is the last line for any path that did not.
  if (typeof clean.response === 'string') {
    clean.response = sanitizePersonaLeaks(stripToolMarkup(clean.response));
  }
  if (clean.message && typeof clean.message.content === 'string') {
    clean.message.content = sanitizePersonaLeaks(stripToolMarkup(clean.message.content));
  }

  // Stamp with Onasis-only metadata
  clean.onasis_metadata = Object.assign(clean.onasis_metadata || {}, {
    service:       'onasis-ai',
    use_case:      useCase || DEFAULT_USE_CASE,
    privacy_level: 'high',
    vendor_masked: true,
    pii_removed:   true,
  });

  return clean;
}

/**
 * Internal platform/model identity names that must never appear in
 * client-facing response text. Whole-word replacement only, so legitimate
 * content (e.g. a memory about "NVIDIA GPU setup") is rewritten too — that
 * is the deliberate privacy contract: every response is Onasis-branded.
 */
const PERSONA_LEAK_BLOCKLIST = [
  'OpenClaw', 'Nemotron', 'NVIDIA', 'Nvidia', 'nvidia',
  'Hermes Agent', 'Hermes', 'Ollama', 'ollama', 'VortexAI', 'VortexCore',
  'kilocode', 'Kilocode',
  // MiniMax self-identifies ("I'm MiniMax-M3, an AI assistant made by MiniMax")
  // even with an Onasis system prompt in place — verified live 2026-08-19.
  // 'MiniMax-M3' is also caught by the model-identifier regex below, but the
  // bare brand name needs its own entry.
  'MiniMax', 'Minimax', 'minimax',
];

/**
 * Rewrite self-identification phrases before text reaches a client.
 *
 * Covered shapes (observed live 2026-08-19 from the openclaw gateway vendor):
 *   "You can call me Nemotron" / "I am Nemotron" / "My name is X"
 *   "trained by NVIDIA researchers" / "developed by OpenAI"
 *   "running inside the OpenClaw platform"
 *   "as an AI language model"
 *
 * @param {string} text
 * @returns {string}
 */
function sanitizePersonaLeaks(text) {
  if (!text || typeof text !== 'string') return text;

  let out = text;

  for (const name of PERSONA_LEAK_BLOCKLIST) {
    out = out.replace(new RegExp(`\\b${name}\\b`, 'g'), 'Onasis');
  }

  // The user's agent identity ("Mr Banks") must never surface as the
  // concierge's own persona — the sidebar chat presents as Onasis/L0.
  out = out.replace(/\bMr\.?\s+Banks\b/g, 'Onasis');

  // Server-internal filesystem paths and the operator's own name/workspace
  // context. Observed live 2026-08-19 even from a brand-new, freshly-created
  // OpenClaw agent with no accumulated history — traced to the recall-forge
  // plugin's cross-agent fallback context (openclaw.json: "fallback": true),
  // not this router's own prompt. A concierge response must never disclose
  // the host's directory structure or the server operator's identity to an
  // end user asking "who are you?".
  out = out.replace(/\/(?:root|home)\/[^\s"'`]+/g, '[workspace]');
  out = out.replace(/\bSeye\s+Derick\b/gi, 'the Onasis team');
  out = out.replace(/\bDerick'?s\b/gi, "the Onasis team's");
  out = out.replace(/\b(?:Seye|Derick)\b/g, 'the Onasis team');

  // Whole model-identifier strings ("kilocode/Onasis/nemotron-3.5-lightning:free",
  // "qwen2.5-coder:3b", "llama3.2:1b", "gpt-4o") — masked when they contain a
  // known model stem. Standalone words like "Lightning Network" are untouched
  // because a stem is required inside the identifier.
  out = out.replace(
    /\b[a-zA-Z0-9_./:-]*(?:nemotron|qwen|llama|claude|mistral|deepseek|gpt)[a-zA-Z0-9_./:-]*(?::[a-z0-9-]+)?\b/gi,
    'Onasis'
  );

  // "as an AI language model" / "as a language model" boilerplate
  out = out.replace(
    /\bas\s+an?\s+(?:AI|large\s+language)\s+language\s+model\b/gi,
    'as the Onasis assistant'
  );

  // "trained by X" / "developed by X" / "created by X" — vendor attribution.
  // Only capitalized proper nouns are rewritten; "created by my team" survives.
  out = out.replace(
    /\b(?:trained|developed|built|created|designed|made|powered)\s+by\s+([A-Z][A-Za-z0-9_-]{1,30})\b/g,
    (_match, name) => {
      if (/^onasis/i.test(name)) return _match;
      return `${_match.split(/\s+by\s+/)[0]} by Onasis`;
    }
  );

  // Generic capitalized self-introduction — catches model names not on the
  // blocklist ("I am <Something>" / "call me <Something>" / "My name is X").
  // The name capture stays case-SENSITIVE on purpose: only capitalized proper
  // nouns are rewritten, so "I am happy to help" is never touched.
  out = out.replace(
    /\b(?:I am|I'm|I‘m|I’m|You can call me|My name is|Call me|Called)\s+([A-Z][A-Za-z0-9_-]{1,30})\b/g,
    (_match, name) => {
      // Never rewrite an already-Onasis introduction.
      if (/^onasis/i.test(name)) return _match;
      return 'I am the Onasis assistant';
    }
  );

  return out;
}

/**
 * Resolve the use case from a request.
 * Checks (in priority order):
 *   1. req.body.use_case
 *   2. X-Use-Case header
 *   3. DEFAULT_USE_CASE
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function resolveUseCaseFromRequest(req) {
  const body    = req.body || {};
  const fromBody   = typeof body.use_case === 'string' && body.use_case.trim();
  const fromHeader = typeof req.headers['x-use-case'] === 'string' && req.headers['x-use-case'].trim();
  const candidate  = fromBody || fromHeader || DEFAULT_USE_CASE;

  // Only allow declared use cases — prevents enumeration / injection
  return USE_CASES[candidate] ? candidate : DEFAULT_USE_CASE;
}

module.exports = {
  resolveVendorForUseCase,
  resolveVendorChainForUseCase,
  sanitizeVendorResponse,
  resolveUseCaseFromRequest,
  USE_CASES,        // Safe to export (no vendor details)
  DEFAULT_USE_CASE,
  // Internal-only: consumed by server-side health checks — NEVER serialise to client responses
  VENDOR_REGISTRY,
  resetLaneCorpus,
};
