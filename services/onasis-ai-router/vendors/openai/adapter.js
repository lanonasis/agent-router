'use strict';

/**
 * OpenAI Vendor Adapter — INTERNAL ONLY
 *
 * Translates Onasis-internal inference requests into OpenAI Chat Completions
 * and normalises responses into the vendor-agnostic internal shape.
 *
 * NOTE:
 *  - We intentionally do not forward tool definitions on this adapter yet.
 *    This keeps fallback behaviour deterministic across providers.
 */

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
    tool_calls:  [],
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let raw;
  try {
    const response = await fetch(`${BASE_URL}${CHAT_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'Onasis-CORE/1.0',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const _detail = await response.text().catch(() => '');
      throw new Error(`OpenAI adapter: upstream returned ${response.status}`);
    }

    raw = await response.json();
  } finally {
    clearTimeout(timer);
  }

  return normalizeMessage(raw);
}

async function healthCheck() {
  if (!API_KEY) return false;

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5000);

  try {
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
