'use strict';

/**
 * MiniMax Vendor Adapter — INTERNAL ONLY
 *
 * MiniMax exposes an OpenAI-compatible Chat Completions API
 * (https://api.minimax.io/v1/chat/completions), so this is structurally the
 * same as vendors/openai/adapter.js. Two MiniMax-specific behaviours are
 * handled here and NOT in the shared layer, because they're wire-format
 * quirks of this vendor:
 *
 *  1. REASONING TOKENS ARE INLINE IN `content`. MiniMax-M3 is a reasoning
 *     model that emits a <think>...</think> block inside message.content —
 *     it does NOT use a separate `reasoning_content` field (verified live
 *     2026-08-19). Without stripping, users see the model's internal
 *     monologue as the answer, e.g.
 *       "<think>The user just said "hello" - a simple greeting. I should
 *        respond naturally...</think>\n\nHello! How can I help you today?"
 *     stripThinkBlocks() removes it. Note the soft tool-call parser
 *     (extractSoftToolCalls) scans response text for JSON, so leaving a
 *     think-block in place could also cause a reasoning-trace JSON snippet
 *     to be misread as a tool call.
 *
 *  2. IT IGNORES SYSTEM-PROMPT IDENTITY INSTRUCTIONS. Asked "who are you?"
 *     with an Onasis system prompt in place, it still answers "I'm MiniMax-M3,
 *     an AI assistant made by MiniMax" (verified live). That's handled at the
 *     shared enforcement point — 'MiniMax' is on PERSONA_LEAK_BLOCKLIST in
 *     vendors/index.js — not here, since every vendor needs that same
 *     treatment and one central list is the auditable place for it.
 *
 * RULES (vendor-abstraction skill):
 *  - Inputs come from vendors/index.js (already validated)
 *  - Output uses the normalised Onasis internal format
 *  - Vendor/model identity must never reach a client response
 */

const { fetchWithRetry, healthCheckTimeoutMs } = require('../_shared/http-client');
const { assertUsableCompletion } = require('../_shared/response-contract');

const BASE_URL   = process.env.MINIMAX_BASE_URL   || 'https://api.minimax.io/v1';
const CHAT_PATH  = process.env.MINIMAX_CHAT_PATH  || '/chat/completions';
const TIMEOUT_MS = parseInt(process.env.MINIMAX_TIMEOUT_MS || '30000', 10);
const API_KEY    = process.env.MINIMAX_API_KEY    || '';

/**
 * Remove <think>...</think> reasoning blocks from response text.
 * Tolerates an unclosed trailing <think> (truncated/max-token responses),
 * which would otherwise dump a partial monologue to the client.
 */
function stripThinkBlocks(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .trim();
}

function normalizeMessage(raw) {
  const message = raw?.choices?.[0]?.message || { role: 'assistant', content: '' };
  const rawContent = typeof message.content === 'string' ? message.content : '';

  return {
    message: {
      role: message.role || 'assistant',
      content: stripThinkBlocks(rawContent),
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
    throw new Error('MINIMAX_API_KEY is not configured — MiniMax vendor unavailable');
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
    throw new Error(`MiniMax adapter: upstream returned ${response.status} — ${detail.slice(0, 200)}`);
  }

  const raw = await response.json();

  // MiniMax returns HTTP 200 with an in-body error envelope on some failures
  // (auth, quota, rate limit) rather than a non-2xx status — a bare
  // `response.ok` check would treat those as successful empty completions and
  // return an empty string to the user instead of failing over to the next
  // vendor in the chain. status_code 0 means success.
  if (raw?.base_resp && raw.base_resp.status_code !== 0) {
    throw new Error(
      `MiniMax adapter: upstream error ${raw.base_resp.status_code} — ${String(raw.base_resp.status_msg || '').slice(0, 200)}`
    );
  }

  return assertUsableCompletion(normalizeMessage(raw), {
    vendorId: 'minimax',
    sentinels: internalRequest.errorSentinels,
  });
}

async function healthCheck() {
  if (!API_KEY) return false;

  try {
    // MiniMax has no cheap unauthenticated liveness route that also proves the
    // key works, so issue a 1-token completion. Deliberately NOT a bare
    // reachability probe: this router already learned the hard way (openclaw,
    // 2026-08-19) that a reachability-only health check reports "healthy"
    // through an entire credential outage — the exact failure it exists to catch.
    const response = await fetchWithRetry(`${BASE_URL}${CHAT_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'Onasis-CORE/1.0',
      },
      body: JSON.stringify({
        model: process.env.MINIMAX_FAST_MODEL || 'MiniMax-M3',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      timeoutMs: healthCheckTimeoutMs('MINIMAX'),
      retries: 0,
    });

    if (!response.ok) return false;
    const raw = await response.json().catch(() => null);
    return Boolean(raw) && (!raw.base_resp || raw.base_resp.status_code === 0);
  } catch {
    return false;
  }
}

module.exports = { chat, healthCheck, stripThinkBlocks };
