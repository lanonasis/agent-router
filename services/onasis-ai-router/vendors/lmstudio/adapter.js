'use strict';

/**
 * LM Studio Vendor Adapter — INTERNAL ONLY
 *
 * LM Studio's local server speaks the OpenAI Chat Completions wire format
 * (`/v1/chat/completions`), so this adapter is structurally a copy of the
 * OpenAI adapter pointed at the local `llmster` daemon instead — no API key,
 * no translation beyond that. Replaces `ollama` as the local/free vendor:
 * measured ~12x faster on this host for the same coder model, and the
 * server is systemd-managed (see /etc/systemd/system/lmstudio.service) so
 * it survives reboots the way the old manually-started ollama process did
 * not.
 *
 * RULES:
 *  - Inputs come from vendors/index.js (already validated)
 *  - Output uses the normalised Onasis internal format (never LM-Studio-
 *    specific keys — `reasoning_content`/`stats` in the raw response are
 *    intentionally dropped, not forwarded)
 *  - This file MUST NOT be imported anywhere that builds client responses
 *    directly
 */

const { fetchWithRetry, healthCheckTimeoutMs } = require('../_shared/http-client');
const { assertUsableCompletion } = require('../_shared/response-contract');
const { sseIterator } = require('../_shared/sse-reader');

const BASE_URL   = process.env.LMSTUDIO_BASE_URL  || 'http://127.0.0.1:1234/v1';
const CHAT_PATH  = process.env.LMSTUDIO_CHAT_PATH || '/chat/completions';
const TIMEOUT_MS = parseInt(process.env.LMSTUDIO_TIMEOUT_MS || '20000', 10);

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
      'User-Agent': 'Onasis-CORE/1.0',
    },
    body: JSON.stringify(payload),
    timeoutMs,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LM Studio adapter: upstream returned ${response.status} — ${detail.slice(0, 200)}`);
  }

  const raw = await response.json();
  return assertUsableCompletion(normalizeMessage(raw), {
    vendorId: 'lmstudio',
    sentinels: internalRequest.errorSentinels,
  });
}

/**
 * Stream a chat completion through LM Studio.
 *
 * LM Studio exposes the OpenAI-compatible streaming endpoint.
 *
 * @param {object} internalRequest
 * @param {string} model
 * @yields {{ content?: string, tool_calls?: Array, usage?: object }}
 */
async function* chatStream(internalRequest, model) {
  const { messages = [], systemPrompt, temperature, maxTokens, tools } = internalRequest;

  const payloadMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const payload = {
    model,
    messages: payloadMessages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 500,
    stream: true,
  };

  if (Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
  }

  const timeoutMs = internalRequest.timeoutOverrideMs || TIMEOUT_MS;

  const response = await fetchWithRetry(`${BASE_URL}${CHAT_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Onasis-CORE/1.0',
    },
    body: JSON.stringify(payload),
    timeoutMs,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LM Studio adapter: upstream returned ${response.status} — ${detail.slice(0, 200)}`);
  }

  for await (const { json } of sseIterator(response, { vendorId: 'lmstudio' })) {
    const choice = json.choices?.[0];
    if (!choice) continue;

    const delta = choice.delta || {};

    if (delta.content) {
      yield { content: delta.content };
    }

    if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
      yield { tool_calls: delta.tool_calls };
    }

    if (choice.finish_reason && json.usage) {
      yield {
        usage: {
          prompt_tokens:     json.usage.prompt_tokens || 0,
          completion_tokens: json.usage.completion_tokens || 0,
          total_tokens:      json.usage.total_tokens || 0,
        },
      };
    }
  }
}

/**
 * Health check — returns true if the LM Studio local server is reachable.
 * Reachability only (matches every other local/simple adapter in this
 * registry) — does not verify a specific model is loaded.
 */
async function healthCheck() {
  try {
    const response = await fetchWithRetry(`${BASE_URL}/models`, {
      externalSignal,
      timeoutMs: healthCheckTimeoutMs('LMSTUDIO'),
      retries: 0,
    });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = { chat, chatStream, healthCheck };
