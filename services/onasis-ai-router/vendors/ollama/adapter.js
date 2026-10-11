'use strict';

/**
 * Ollama Vendor Adapter — INTERNAL ONLY
 *
 * Translates Onasis-internal inference requests into Ollama's wire format
 * and normalises the response back into a vendor-agnostic shape.
 *
 * RULES:
 *  - Inputs come from vendors/index.js (already validated)
 *  - Output uses the normalised Onasis internal format (never Ollama-specific keys)
 *  - This file MUST NOT be imported anywhere that builds client responses directly
 */

const { fetchWithRetry, healthCheckTimeoutMs } = require('../_shared/http-client');
const { assertUsableCompletion } = require('../_shared/response-contract');

const BASE_URL    = process.env.OLLAMA_BASE_URL  || 'http://localhost:11434';
const CHAT_PATH   = process.env.OLLAMA_CHAT_PATH || '/api/chat';
const TIMEOUT_MS  = parseInt(process.env.OLLAMA_TIMEOUT_MS || '30000', 10);

/**
 * Run a chat inference request against Ollama.
 *
 * @param {object} internalRequest
 * @param {Array}  internalRequest.messages      - Chat messages (role/content pairs)
 * @param {string} internalRequest.systemPrompt  - Use-case system prompt (already resolved)
 * @param {number} internalRequest.temperature
 * @param {number} internalRequest.maxTokens
 * @param {Array}  [internalRequest.tools]       - Optional tool definitions
 * @param {string} model                         - Internal model identifier from registry
 *
 * @returns {object} Normalised vendor-agnostic response
 */
async function chat(internalRequest, model) {
  const { messages, systemPrompt, temperature, maxTokens, tools } = internalRequest;

  // Prepend the system prompt as a system message
  const ollamaMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const payload = {
    model,
    messages: ollamaMessages,
    stream: false,
    options: {
      temperature: temperature ?? 0.7,
      num_predict: maxTokens ?? 500,
    },
    ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
  };

  const timeoutMs = internalRequest.timeoutOverrideMs || TIMEOUT_MS;

  let raw;
  const response = await fetchWithRetry(`${BASE_URL}${CHAT_PATH}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':   'Onasis-CORE/1.0',
    },
    body:   JSON.stringify(payload),
    timeoutMs,
  });

  if (!response.ok) {
    // The client-facing route handler always returns a generic message on
    // error (see routeToAIService's catch) — only this.logger.error sees
    // error.message — so it's safe to include the upstream body there for
    // diagnosability without surfacing Ollama's response to callers.
    const detail = await response.text().catch(() => '');
    throw new Error(`Ollama adapter: upstream returned ${response.status} — ${detail.slice(0, 200)}`);
  }

  raw = await response.json();

  // ── Normalise to vendor-agnostic format ───────────────────────────────────
  // Keys here match what ai-service-router.js already knows how to read.
  const normalised = {
    message:     raw.message || { role: 'assistant', content: '' },
    done:        raw.done ?? true,
    done_reason: raw.done_reason || 'stop',
    // Expose tool_calls if present (Ollama wraps them inside message)
    tool_calls:  raw.message?.tool_calls || [],
    usage: {
      prompt_tokens:     raw.prompt_eval_count || 0,
      completion_tokens: raw.eval_count || 0,
      total_tokens:      (raw.prompt_eval_count || 0) + (raw.eval_count || 0),
    },
  };

  return assertUsableCompletion(normalised, {
    vendorId: 'ollama',
    sentinels: internalRequest.errorSentinels,
  });
}

/**
 * Health check — returns true if the Ollama instance is reachable.
 * Used by the router's health endpoint.
 */
async function healthCheck() {
  try {
    const response = await fetchWithRetry(`${BASE_URL}/api/tags`, {
      timeoutMs: healthCheckTimeoutMs('OLLAMA'),
      retries: 0,
    });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = { chat, healthCheck };
