'use strict';

/**
 * DeepSeek Vendor Adapter — INTERNAL ONLY
 *
 * Translates Onasis-internal inference requests into DeepSeek's wire format
 * and normalises the response back into a vendor-agnostic shape.
 *
 * RULES:
 *  - Inputs come from vendors/index.js (already validated)
 *  - Output uses the normalised Onasis internal format (never DeepSeek-specific keys)
 *  - This file MUST NOT be imported anywhere that builds client responses directly
 */

const BASE_URL    = process.env.DEEPSEEK_BASE_URL  || 'https://api.deepseek.com';
const CHAT_PATH   = process.env.DEEPSEEK_CHAT_PATH || '/chat/completions';
const TIMEOUT_MS  = parseInt(process.env.DEEPSEEK_TIMEOUT_MS || '30000', 10);
const API_KEY     = process.env.DEEPSEEK_API_KEY;

/**
 * Run a chat inference request against DeepSeek API.
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
  if (!API_KEY) {
    throw new Error(
      'DEEPSEEK_API_KEY is not configured — DeepSeek vendor unavailable'
    );
  }

  const { messages, systemPrompt, temperature, maxTokens, tools } = internalRequest;

  // Prepend the system prompt as a system message
  const deepseekMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const payload = {
    model,
    messages: deepseekMessages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 500,
    ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let raw;
  try {
    const response = await fetch(`${BASE_URL}${CHAT_PATH}`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent':   'Onasis-CORE/1.0',
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Do not surface DeepSeek error body to callers — log internally only
      const _detail = await response.text().catch(() => '');
      throw new Error(`DeepSeek adapter: upstream returned ${response.status}`);
    }

    raw = await response.json();
  } finally {
    clearTimeout(timer);
  }

  // ── Normalise to vendor-agnostic format ───────────────────────────────────
  // Keys here match what ai-service-router.js already knows how to read.
  const message = raw.choices?.[0]?.message || { role: 'assistant', content: '' };
  const tool_calls = message.tool_calls || [];

  return {
    message,
    done:        raw.choices?.[0]?.finish_reason === 'stop',
    done_reason: raw.choices?.[0]?.finish_reason || 'stop',
    tool_calls,
    usage: {
      prompt_tokens:     raw.usage?.prompt_tokens || 0,
      completion_tokens: raw.usage?.completion_tokens || 0,
      total_tokens:      raw.usage?.total_tokens || 0,
    },
  };
}

/**
 * Health check — returns true if the DeepSeek API is reachable.
 * Used by the router's health endpoint.
 */
async function healthCheck() {
  if (!API_KEY) return false;

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5000);
  try {
    // Simple lightweight request to check API availability
    const response = await fetch(`${BASE_URL}/models`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'Onasis-CORE/1.0',
      },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = { chat, healthCheck };