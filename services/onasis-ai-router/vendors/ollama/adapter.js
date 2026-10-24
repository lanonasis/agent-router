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
const { sseIterator } = require('../_shared/sse-reader');

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
  const { messages, systemPrompt, temperature, maxTokens, tools, externalSignal } = internalRequest;

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
 * Stream a chat inference request against Ollama.
 *
 * Yields { content, usage } chunks in the same normalised shape the router
 * expects from the non-streaming path — one content chunk per SSE event,
 * plus a final usage summary.
 *
 * @param {object} internalRequest
 * @param {string} model
 * @yields {{ content?: string, usage?: { prompt_tokens?: number, completion_tokens?: number, total_tokens?: number } }}
 */
async function* chatStream(internalRequest, model) {
  const { messages, systemPrompt, temperature, maxTokens, tools, externalSignal } = internalRequest;

  const ollamaMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const payload = {
    model,
    messages: ollamaMessages,
    stream: true,
    options: {
      temperature: temperature ?? 0.7,
      num_predict: maxTokens ?? 500,
    },
    ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
  };

  const timeoutMs = internalRequest.timeoutOverrideMs || TIMEOUT_MS;

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
    const detail = await response.text().catch(() => '');
    throw new Error(`Ollama adapter: upstream returned ${response.status} — ${detail.slice(0, 200)}`);
  }

  // Ollama SSE: each event is {"message":{"role":"assistant","content":"…"},"done":false}
  for await (const { json } of sseIterator(response, { vendorId: 'ollama' })) {
    // Collect token counts from the final (done=true) event
    const promptCount = json.prompt_eval_count || 0;
    const evalCount   = json.eval_count || 0;

    // Yield content chunks from every event
    if (json.message?.content) {
      yield { content: json.message.content };
    }

    // On the final event, also emit the accumulated usage
    if (json.done) {
      yield {
        usage: {
          prompt_tokens:     promptCount,
          completion_tokens: evalCount,
          total_tokens:      promptCount + evalCount,
        },
      };
    }
  }
}

/**
 * Health check — returns true if the Ollama instance is reachable.
 * Used by the router's health endpoint.
 */
async function healthCheck() {
  try {
    const response = await fetchWithRetry(`${BASE_URL}/api/tags`, {
      externalSignal,
      timeoutMs: healthCheckTimeoutMs('OLLAMA'),
      retries: 0,
    });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = { chat, chatStream, healthCheck };
