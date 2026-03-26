'use strict';

/**
 * Anthropic (Claude) Vendor Stub — NOT YET ACTIVE
 *
 * Status: stub
 * Activate by:
 *   1. Wiring up the API call with ANTHROPIC_API_KEY env var
 *   2. Changing status to 'active' in vendors/index.js
 *   3. Verifying all use-case mappings pass integration tests
 *
 * RULES:
 *  - Client responses MUST never contain 'claude', 'anthropic', or model identifiers
 *  - All client-facing text must use Onasis branding only
 *  - Follow the same normalised output shape as vendors/ollama/adapter.js
 */

async function chat(_internalRequest, _model) {
  throw new Error(
    '[Anthropic stub] This vendor is not yet configured. ' +
    'Set status to "active" in vendors/index.js after wiring ANTHROPIC_API_KEY.'
  );
}

async function healthCheck() {
  return false; // Stub — always reports unhealthy until activated
}

module.exports = { chat, healthCheck };
