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
const { sseIterator } = require('../_shared/sse-reader');

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

/**
 * Stream a chat completion through OpenAI.
 *
 * Yields { content, usage, tool_calls } chunks. OpenAI SSE events have the
 * shape {"choices":[{"delta":{"content":"…"}},{"finish_reason":"stop"}]}
 * or {"choices":[{"delta":{"tool_calls":[{…}]}}]}.
 *
 * @param {object} internalRequest
 * @param {string} model
 * @yields {{ content?: string, tool_calls?: Array, usage?: object }}
 */
async function* chatStream(internalRequest, model) {
  if (!API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured — OpenAI vendor unavailable');
  }

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

  // Accumulate tool calls across events for this choice
  let accumulatedToolCalls = [];
  let accumToolCallIndex = null;

  for await (const { json } of sseIterator(response, { vendorId: 'openai' })) {
    const choice = json.choices?.[0];
    if (!choice) continue;

    const delta = choice.delta || {};

    // ── Content chunks ─────────────────────────────────────────────
    if (delta.content) {
      yield { content: delta.content };
    }

    // ── Tool call chunks ───────────────────────────────────────────
    if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? accumToolCallIndex;
        accumToolCallIndex = idx;

        // OpenAI streams a tool_call per event (with an index)
        // or appends to an existing one. We accumulate fragments.
        if (idx === undefined || idx === null) continue;

        let entry = accumulatedToolCalls[idx];
        if (!entry) {
          entry = { index: idx, id: '', type: 'function', function: { name: '', arguments: '' } };
          accumulatedToolCalls[idx] = entry;
        }
        if (tc.id) entry.id = tc.id;
        if (tc.type) entry.type = tc.type;
        if (tc.function?.name) entry.function.name += tc.function.name;
        if (tc.function?.arguments) entry.function.arguments += tc.function.arguments;
      }
    }

    // ── Final usage (on finish_reason === 'stop' or 'tool_calls') ──
    if (choice.finish_reason) {
      // Flush any accumulated tool calls
      const toolCalls = accumulatedToolCalls.length > 0
        ? accumulatedToolCalls.map((tc) => ({
            id: tc.id,
            type: tc.type || 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }))
        : undefined;
      if (toolCalls) yield { tool_calls: toolCalls };

      if (json.usage) {
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
}

/**
 * Health check — returns true if the OpenAI endpoint is reachable.
 */
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

module.exports = { chat, chatStream, healthCheck };
