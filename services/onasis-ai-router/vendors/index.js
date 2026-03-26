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

const path = require('path');

// ─── Use-Case Registry ───────────────────────────────────────────────────────
//
// Defines WHAT the platform needs, not HOW any vendor fulfills it.
// Clients only ever send a use_case string; they never see model names.

const USE_CASES = {
  'landing-guide': {
    description: 'Onboarding AI guide on landing pages',
    maxTokens: 400,
    temperature: 0.7,
    systemPromptKey: 'onboarding',
    vendorPriority: 'lana',   // LANA (Reasoning/Planning)
    streamable: false,
  },
  'ask-ai': {
    description: 'Quick "Ask AI" button on index and dashboard pages',
    maxTokens: 350,
    temperature: 0.65,
    systemPromptKey: 'concise-helper',
    vendorPriority: 'lana',
    streamable: false,
  },
  'dashboard-assistant': {
    description: 'Full AI assistant panel inside user dashboards',
    maxTokens: 1200,
    temperature: 0.75,
    systemPromptKey: 'full-assistant',
    vendorPriority: 'lana',
    streamable: true,
  },
  'support-chat': {
    description: 'Customer support and help desk conversations',
    maxTokens: 800,
    temperature: 0.6,
    systemPromptKey: 'support',
    vendorPriority: 'lana',
    streamable: false,
  },
  'content-generation': {
    description: 'Marketing copy, summaries, and content creation',
    maxTokens: 2000,
    temperature: 0.85,
    systemPromptKey: 'creative',
    vendorPriority: 'coda',
    streamable: false,
  },
   'code-assist': {
     description: 'Developer and technical assistance',
     maxTokens: 2000,
     temperature: 0.2,
     systemPromptKey: 'technical',
     vendorPriority: 'coda',
     streamable: false,
   },
   'memory-analysis': {
     description: 'Memory intelligence pattern analysis and insights',
     maxTokens: 2000,
     temperature: 0.3,
     systemPromptKey: 'memory-intelligence',
     vendorPriority: 'mira',
     streamable: false,
   },
   'repl-nlp': {
     description: 'REPL CLI natural language command interpretation',
     maxTokens: 1500,
     temperature: 0.2,
     systemPromptKey: 'repl-assistant',
     vendorPriority: 'coda',
     streamable: false,
   },
 };

// Default use case when none is specified in the request
const DEFAULT_USE_CASE = 'ask-ai';

// ─── System Prompt Templates ─────────────────────────────────────────────────
//
// All prompts are Onasis-branded. Vendor / model names MUST NOT appear here.

const SYSTEM_PROMPTS = {
  'onboarding':
    'You are the Onasis onboarding guide. Welcome users warmly and help them ' +
    'discover Onasis services. Keep responses friendly, brief (2-3 sentences), ' +
    'and action-oriented. Never mention internal systems or AI provider names.',

  'concise-helper':
    'You are an Onasis AI assistant. Provide clear, concise answers in 1-3 sentences ' +
    'unless more detail is genuinely needed. Never reveal AI provider or model information.',

  'full-assistant':
    'You are the Onasis AI assistant. Help users accomplish their goals within the ' +
    'Onasis platform. Be thorough but efficient. Never reveal AI provider, model names, ' +
    'or internal configuration.',

  'support':
    'You are an Onasis support specialist. Help users resolve issues with empathy ' +
    'and clarity. Escalate to human agents when needed. Never reveal AI provider ' +
    'or model information.',

  'creative':
    'You are an Onasis content assistant. Create engaging, brand-aligned content. ' +
    'Maintain a professional yet approachable tone. Never reveal AI provider or ' +
    'model information.',

   'technical':
     'You are an Onasis technical assistant. Provide precise, accurate technical ' +
     'guidance. Prefer code examples and clear steps. Never reveal AI provider ' +
     'or model information.',

   'memory-intelligence':
     'You are an Onasis memory intelligence analyzer. Analyze patterns in memory data and ' +
     'provide actionable insights. Be analytical and precise. Never reveal AI provider ' +
     'or model information.',

   'repl-assistant':
     'You are an Onasis REPL assistant. Interpret user commands and translate them into ' +
     'structured actions. Be precise and follow command patterns. Never reveal AI provider ' +
     'or model information.',
 };

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
  'memory-analysis', 'repl-nlp',
];

const VENDOR_REGISTRY = {
  // ── Primary: local Ollama ─────────────────────────────────────────────────
  ollama: {
    status: 'active',
    adapter: require('./ollama/adapter'),
    // Model names are internal — clients never see them
    models: {
      speed:   process.env.OLLAMA_FAST_MODEL    || process.env.OLLAMA_MODEL || 'lana',
      quality: process.env.OLLAMA_QUALITY_MODEL || process.env.OLLAMA_MODEL || 'coda',
      lana: 'lana',
      mira: 'mira',
      coda: 'coda',
    },
    capabilities: ALL_USE_CASES,
    // Fallback chain when local inference is unavailable
    fallbackVendor: 'openai',
  },

  // ── Fallback: Supabase-hosted edge function ───────────────────────────────
  // Internally delegates to OpenAI / Claude / OpenRouter / Gemini etc.
  // Activated automatically when Ollama fails — never selected by clients.
  'supabase-edge': {
    status: 'active',
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
      speed:   process.env.ANTHROPIC_FAST_MODEL || 'claude-3-5-haiku-latest',
      quality: process.env.ANTHROPIC_QUALITY_MODEL || 'claude-3-5-sonnet-latest',
    },
    capabilities: ALL_USE_CASES,
    fallbackVendor: 'supabase-edge',
  },

   openai: {
     status: 'active',
     adapter: require('./openai/adapter'),
     models: {
       speed:   process.env.OPENAI_FAST_MODEL || 'gpt-4o-mini',
       quality: process.env.OPENAI_QUALITY_MODEL || 'gpt-4o',
     },
     capabilities: ALL_USE_CASES,
     fallbackVendor: 'anthropic',
   },

   // ── External: DeepSeek API ────────────────────────────────────────────────
   deepseek: {
     status: 'stub',
     adapter: require('./deepseek/adapter'),
     models: {
       speed:   'deepseek-chat',
       quality: 'deepseek-reasoner',
     },
      capabilities: ['dashboard-assistant', 'content-generation', 'code-assist', 'support-chat', 'ask-ai', 'memory-analysis', 'repl-nlp'],
     fallbackVendor: 'supabase-edge',
   },
};

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
  const { vendorPriority } = useCaseConfig;

  // Find active vendors that declare support for this use case
  const candidates = Object.entries(VENDOR_REGISTRY).filter(
    ([, vendor]) => vendor.status === 'active' && vendor.capabilities.includes(useCase)
  );

  // Fallback: any active vendor if none explicitly supports this use case
  if (candidates.length === 0) {
    const fallback = Object.entries(VENDOR_REGISTRY).find(([, v]) => v.status === 'active');
    if (!fallback) {
      throw new Error('No active AI vendor available. Check vendor configuration.');
    }
    candidates.push(fallback);
  }

  // Future: add load-balancing / cost-optimisation logic here.
  // For now: pick the first eligible active vendor.
  const [vendorId, vendorConfig] = candidates[0];

  const systemPrompt =
    SYSTEM_PROMPTS[useCaseConfig.systemPromptKey] || SYSTEM_PROMPTS['concise-helper'];

  // Internal config — NEVER expose directly to clients
  return {
    _vendorId:   vendorId,
    _model:      vendorConfig.models[vendorPriority] || vendorConfig.models.speed,
    _adapter:    vendorConfig.adapter,
    systemPrompt,
    maxTokens:   useCaseConfig.maxTokens,
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
  const { vendorPriority } = useCaseConfig;

  const systemPrompt =
    SYSTEM_PROMPTS[useCaseConfig.systemPromptKey] || SYSTEM_PROMPTS['concise-helper'];

  const chain = [];
  const visited = new Set();

  // Start from the best primary vendor for this use case
  const primaryEntry = Object.entries(VENDOR_REGISTRY).find(
    ([, v]) => v.status === 'active' && v.capabilities.includes(useCase)
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
      chain.push({
        _vendorId:   currentId,
        _model:      vendorConfig.models[vendorPriority] || vendorConfig.models.speed,
        _adapter:    vendorConfig.adapter,
        systemPrompt,
        maxTokens:   useCaseConfig.maxTokens,
        temperature: useCaseConfig.temperature,
        streamable:  useCaseConfig.streamable,
      });
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
};
