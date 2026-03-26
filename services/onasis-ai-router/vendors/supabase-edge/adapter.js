'use strict';

/**
 * Supabase Edge Function Fallback Adapter — INTERNAL ONLY
 *
 * Routes inference to the Supabase-hosted edge function when the primary
 * vendor (Ollama) is unavailable. The edge function internally delegates
 * to cloud providers (OpenAI, Claude, OpenRouter, Gemini, etc.).
 *
 * The client-facing API remains identical — no vendor identity is exposed.
 *
 * RULES (vendor-abstraction skill):
 *  - Caller never sees provider name, model, or edge function URL
 *  - Tool calls are not forwarded — edge function returns a direct text reply
 *  - This adapter is the END of the fallback chain; it must not throw silently
 */

const SUPABASE_URL      = process.env.SUPABASE_URL            || 'https://mxtsdgkwzjzlttpotole.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY        || '';
const EDGE_CHAT_PATH    = process.env.SUPABASE_EDGE_CHAT_PATH  || '/functions/v1/ai-chat';
const TIMEOUT_MS        = parseInt(process.env.SUPABASE_EDGE_TIMEOUT_MS || '30000', 10);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalise whatever the Supabase edge function returns into the
 * Onasis vendor-agnostic internal format (same shape as Ollama adapter output).
 */
function normaliseResponse(raw) {
  // Defensively check multiple possible response field names
  const content =
    raw?.reply                              ||  // Common Supabase edge pattern
    raw?.response                           ||
    raw?.answer                             ||
    raw?.message?.content                   ||  // OpenAI-style nested
    raw?.choices?.[0]?.message?.content     ||  // Full OpenAI format
    raw?.content                            ||
    raw?.text                               ||
    '';

  return {
    message:     { role: 'assistant', content: String(content) },
    done:        true,
    done_reason: 'stop',
    tool_calls:  [],  // Edge function handles tool use internally; we receive a final answer
    usage: {
      prompt_tokens:     raw?.usage?.prompt_tokens                          || 0,
      completion_tokens: raw?.usage?.completion_tokens || raw?.usage?.output_tokens || 0,
      total_tokens:      raw?.usage?.total_tokens                           || 0,
    },
  };
}

// ─── Exported Interface ───────────────────────────────────────────────────────

/**
 * Run a chat inference via the Supabase edge function.
 *
 * @param {object} internalRequest
 * @param {Array}  internalRequest.messages     - Chat messages (role/content pairs)
 * @param {string} internalRequest.systemPrompt - Use-case system prompt
 * @param {number} internalRequest.temperature  - Ignored (edge function decides)
 * @param {number} internalRequest.maxTokens    - Forwarded as hint
 * @param {string} _model                       - Ignored; edge function selects provider
 *
 * @returns {object} Normalised vendor-agnostic response
 */
async function chat(internalRequest, _model) {
  if (!SUPABASE_ANON_KEY) {
    throw new Error(
      'SUPABASE_ANON_KEY is not configured — Supabase edge fallback unavailable'
    );
  }

  const { messages = [], systemPrompt, maxTokens } = internalRequest;

  // Merge system prompt into the full message list
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  // Edge function REQUIRES messages array (confirmed from live API contract).
  // Strip system messages — edge function manages its own system prompt internally.
  const conversationMessages = allMessages.filter(
    m => m.role === 'user' || m.role === 'assistant'
  );

  if (conversationMessages.length === 0) {
    throw new Error('Supabase edge adapter: no user message found in request');
  }

  const payload = {
    // messages is the required field — always sent regardless of turn count
    messages: conversationMessages,
    // max_tokens forwarded as a hint; edge function may honour it
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let raw;
  try {
    const response = await fetch(`${SUPABASE_URL}${EDGE_CHAT_PATH}`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey':        SUPABASE_ANON_KEY,
        'User-Agent':    'Onasis-CORE/1.0',
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Intentionally vague — do not surface upstream error details
      throw new Error(`Supabase edge adapter: upstream returned ${response.status}`);
    }

    raw = await response.json();
  } finally {
    clearTimeout(timer);
  }

  return normaliseResponse(raw);
}

/**
 * Health check — verifies the Supabase project is reachable.
 * Checks the lightweight REST health endpoint (not the edge function,
 * to avoid unnecessary invocation costs).
 */
async function healthCheck() {
  if (!SUPABASE_ANON_KEY) return false;

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5000);

  try {
    // Supabase projects expose /rest/v1/ which returns 200 when the project is up
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { 'apikey': SUPABASE_ANON_KEY },
      signal:  controller.signal,
    });
    return response.ok || response.status === 404; // 404 means project is up, no table found
  } catch {
    return false;
  }
}

module.exports = { chat, healthCheck };
