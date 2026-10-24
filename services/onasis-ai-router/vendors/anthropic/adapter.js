'use strict';

/**
 * Anthropic Vendor Adapter — INTERNAL ONLY
 *
 * Translates Onasis-internal inference requests into Anthropic Messages API
 * and normalises responses into the vendor-agnostic internal shape.
 *
 * Tool definitions arrive in OpenAI's native `{type:'function',
 * function:{name,description,parameters}}` shape (the router's internal
 * format) and are translated to Anthropic's `{name,description,
 * input_schema}` shape below. Anthropic tool use is returned as `tool_use`
 * content blocks rather than a separate `tool_calls` array — those are
 * extracted and normalised into the same top-level `tool_calls` shape the
 * other adapters return, so the router's extractToolCalls() doesn't need to
 * know which vendor served the response.
 */

const { fetchWithRetry, healthCheckTimeoutMs } = require('../_shared/http-client');
const { assertUsableCompletion } = require('../_shared/response-contract');
const { sseIterator } = require('../_shared/sse-reader');

const BASE_URL          = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
const CHAT_PATH         = process.env.ANTHROPIC_CHAT_PATH || '/messages';
const TIMEOUT_MS        = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || '30000', 10);
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';
const API_KEY           = process.env.ANTHROPIC_API_KEY || '';

function toAnthropicTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools
    .filter((t) => t?.function?.name)
    .map((t) => ({
      name: t.function.name,
      description: t.function.description || '',
      input_schema: t.function.parameters || { type: 'object', properties: {} },
    }));
}

function toAnthropicRequest(internalRequest, model) {
  const { messages = [], systemPrompt, temperature, maxTokens, tools } = internalRequest;

  const systemParts = [];
  if (systemPrompt) systemParts.push(systemPrompt);

  // Anthropic requires strictly alternating user/assistant roles and
  // rejects empty text content. The internal message format doesn't
  // preserve tool_use/tool_result blocks across a round trip (tool results
  // get flattened into synthetic user-role text turns below), so a
  // tool-only assistant reply (no commentary text) or more than one tool
  // result in a row can otherwise produce an empty-content message or two
  // consecutive same-role messages — both invalid here even though
  // OpenAI/Ollama tolerate them. Drop empty turns and merge consecutive
  // same-role turns instead of pushing them as separate messages.
  const anthropicMessages = [];
  const pushTurn = (role, content) => {
    if (!content) return;
    const last = anthropicMessages[anthropicMessages.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${content}`;
      return;
    }
    anthropicMessages.push({ role, content });
  };

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const role = msg.role;
    const content = typeof msg.content === 'string' ? msg.content : '';

    if (role === 'system') {
      if (content) systemParts.push(content);
      continue;
    }

    if (role === 'user' || role === 'assistant') {
      pushTurn(role, content);
      continue;
    }

    if (role === 'tool') {
      const toolName = msg.tool_name || 'tool';
      pushTurn('user', `[Tool Result: ${toolName}]\n${content}`);
    }
  }

  if (anthropicMessages.length === 0) {
    anthropicMessages.push({ role: 'user', content: '' });
  }

  const anthropicTools = toAnthropicTools(tools);

  return {
    model,
    max_tokens: maxTokens ?? 500,
    temperature: temperature ?? 0.7,
    system: systemParts.join('\n\n').trim() || undefined,
    messages: anthropicMessages,
    ...(anthropicTools ? { tools: anthropicTools } : {}),
  };
}

function normalizeMessage(raw) {
  const blocks = Array.isArray(raw?.content) ? raw.content : [];

  const text = blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');

  const toolCalls = blocks
    .filter((block) => block?.type === 'tool_use' && block.name)
    .map((block) => ({
      id: block.id || '',
      type: 'function',
      function: {
        name: block.name,
        arguments: block.input || {},
      },
    }));

  return {
    message: { role: 'assistant', content: text },
    done:        true,
    // Anthropic's own spelling (end_turn / max_tokens / tool_use) is handed
    // straight to assertUsableCompletion, which translates it onto the shared
    // contract. Do not translate it here — one place, or adapters drift.
    done_reason: raw?.stop_reason || 'stop',
    tool_calls:  toolCalls,
    usage: {
      prompt_tokens:     raw?.usage?.input_tokens || 0,
      completion_tokens: raw?.usage?.output_tokens || 0,
      total_tokens:      (raw?.usage?.input_tokens || 0) + (raw?.usage?.output_tokens || 0),
    },
  };
}

async function chat(internalRequest, model) {
  if (!API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured — Anthropic vendor unavailable');
  }

  const payload = toAnthropicRequest(internalRequest, model);
  const timeoutMs = internalRequest.timeoutOverrideMs || TIMEOUT_MS;

  const response = await fetchWithRetry(`${BASE_URL}${CHAT_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'User-Agent': 'Onasis-CORE/1.0',
    },
    body: JSON.stringify(payload),
    timeoutMs,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Anthropic adapter: upstream returned ${response.status} — ${detail.slice(0, 200)}`);
  }

  const raw = await response.json();
  return assertUsableCompletion(normalizeMessage(raw), {
    vendorId: 'anthropic',
    sentinels: internalRequest.errorSentinels,
  });
}

/**
 * Stream a chat completion through Anthropic.
 *
 * Anthropic's SSE format uses explicit event types:
 *   content_block_start / content_block_delta / content_block_stop
 *   message_start / message_delta / message_stop
 *
 * We accumulate text deltas and emit them as individual SSE chunks.
 * Tool_use content blocks are accumulated and emitted on content_block_stop.
 *
 * @param {object} internalRequest
 * @param {string} model
 * @yields {{ content?: string, tool_calls?: Array, usage?: object }}
 */
async function* chatStream(internalRequest, model) {
  if (!API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured — Anthropic vendor unavailable');
  }

  const payload = toAnthropicRequest(internalRequest, model);
  // Anthropic streaming is opt-in via the request body (not `stream: true` like OpenAI)
  payload.stream = true;

  const timeoutMs = internalRequest.timeoutOverrideMs || TIMEOUT_MS;

  const response = await fetchWithRetry(`${BASE_URL}${CHAT_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'User-Agent': 'Onasis-CORE/1.0',
    },
    body: JSON.stringify(payload),
    timeoutMs,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Anthropic adapter: upstream returned ${response.status} — ${detail.slice(0, 200)}`);
  }

  // Accumulate content per block index
  let currentText = '';
  const toolCalls = [];
  let currentToolCall = null;
  let usageInputTokens = 0;
  let usageOutputTokens = 0;

  for await (const { json, event_type } of sseIterator(response, { vendorId: 'anthropic' })) {
    const eventType = event_type || json.type;
    if (!eventType) continue;

    switch (eventType) {
      case 'content_block_start': {
        const block = json.content_block;
        if (block.type === 'tool_use') {
          currentToolCall = {
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: '' },
          };
        } else {
          // text block — reset accumulator
          currentText = '';
        }
        break;
      }

      case 'content_block_delta': {
        const delta = json.delta;
        if (delta.type === 'text_delta' && delta.text) {
          currentText += delta.text;
          yield { content: delta.text };
        }
        if (delta.type === 'input_json_delta' && delta.partial_json) {
          // Accumulate tool call JSON fragments
          if (currentToolCall) {
            currentToolCall.function.arguments += delta.partial_json;
          }
        }
        break;
      }

      case 'content_block_stop': {
        // Emit the accumulated tool call when its content block stops
        if (currentToolCall) {
          try {
            currentToolCall.function.arguments = JSON.parse(
              currentToolCall.function.arguments || '{}'
            );
          } catch {
            // Best-effort: pass raw string if it's not valid JSON
          }
          toolCalls.push(currentToolCall);
        }
        currentToolCall = null;
        break;
      }

      case 'message_delta': {
        const delta = json.delta;
        if (delta.stop_reason === 'tool_use') {
          // Flush accumulated tool calls
          if (toolCalls.length > 0) {
            yield { tool_calls: toolCalls };
          }
        }
        usageOutputTokens += delta.usage?.output_tokens || 0;
        break;
      }

      case 'message_start': {
        usageInputTokens = json.message?.usage?.input_tokens || 0;
        break;
      }

      case 'message_stop': {
        // Final usage summary
        yield {
          usage: {
            prompt_tokens:     usageInputTokens,
            completion_tokens: usageOutputTokens,
            total_tokens:      usageInputTokens + usageOutputTokens,
          },
        };
        break;
      }
    }
  }
}

async function healthCheck() {
  if (!API_KEY) return false;

  try {
    const response = await fetchWithRetry(`${BASE_URL}/models`, {
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'User-Agent': 'Onasis-CORE/1.0',
      },
      timeoutMs: healthCheckTimeoutMs('ANTHROPIC'),
      retries: 0,
    });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = { chat, chatStream, healthCheck, normalizeMessage, toAnthropicTools, toAnthropicRequest };
