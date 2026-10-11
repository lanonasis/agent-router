'use strict';

/**
 * OpenAI Vendor Adapter — INTERNAL ONLY
 *
 * Translates Onasis-internal inference requests into OpenAI Chat Completions
 * and normalises responses into the vendor-agnostic internal shape.
 *
 * Tool definitions arrive already in OpenAI's native `{type:'function',
 * function:{name,description,parameters}}` shape (that's the router's
 * internal format), so they're forwarded as-is — no translation needed.
 */

const { fetchWithRetry, healthCheckTimeoutMs } = require('../_shared/http-client');
const { assertUsableCompletion } = require('../_shared/response-contract');

const BASE_URL   = process.env.OPENAI_BASE_URL   || 'https://api.openai.com/v1';
const CHAT_PATH  = process.env.OPENAI_CHAT_PATH  || '/chat/completions';
const TIMEOUT_MS = parseInt(process.env.OPENAI_TIMEOUT_MS || '30000', 10);
const API_KEY    = process.env.OPENAI_API_KEY    || '';

function normalizeMessage(raw) {
  const message = raw?.choices?.[0]?.message || { role: 'assistant', content: '' };
  return {
    message: {
      role: message.role || 'assistant',
      content: typeof message.content === 'string' ? message.content : '',
    },
    done:        true,
    done_reason: raw?.choices?.[0]?.finish_reason || 'stop',
    tool_calls:  Array.isArray(message.tool_calls) ? message.tool_calls : [],
    usage: {
      prompt_tokens:     raw?.usage?.prompt_tokens || 0,
      completion_tokens: raw?.usage?.completion_tokens || 0,
      total_tokens:      raw?.usage?.total_tokens || 0,
    },
  };
}

async function chat(internalRequest, model) {
  if (!API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured — OpenAI vendor unavailable');
  }

  const { messages = [], systemPrompt, temperature, maxTokens } = internalRequest;
  const payloadMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const payload = {
    model,
    messages: payloadMessages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 500,
    stream: false,
  };

  if (Array.isArray(internalRequest.tools) && internalRequest.tools.length > 0) {
    payload.tools = internalRequest.tools;
  }

  const timeoutMs = internalRequest.timeoutOverrideMs || TIMEOUT_MS;

  const response = await fetchWithRetry(`${BASE_URL}${CHAT_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'User-Agent': 'Onasis-CORE/1.0',
    },
    body: JSON.stringify(payload),
    timeoutMs,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenAI adapter: upstream returned ${response.status} — ${detail.slice(0, 200)}`);
  }

  const raw = await response.json();
  return assertUsableCompletion(normalizeMessage(raw), {
    vendorId: 'openai',
    sentinels: internalRequest.errorSentinels,
  });
}

async function healthCheck() {
  if (!API_KEY) return false;

  try {
    const response = await fetchWithRetry(`${BASE_URL}/models`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'Onasis-CORE/1.0',
      },
      timeoutMs: healthCheckTimeoutMs('OPENAI'),
      retries: 0,
    });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = { chat, healthCheck };
