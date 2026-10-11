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

const { fetchWithRetry, healthCheckTimeoutMs } = require('../_shared/http-client');

// Correction (2026-08-18, superseding an earlier same-day fix): this
// project (mxtsdgkwzjzlttpotole, "the-fixer-initiative" — the platform main
// DB, per onasis-core/CLAUDE.md) IS the correct target, confirmed via the
// Supabase Management API against the real deployed function source. Two
// different "ai-chat"-ish functions exist across the org and neither is
// what should be called here:
//   - mxtsdgkwzjzlttpotole's OWN `ai-chat` function requires a genuine
//     Supabase Auth user session JWT (calls /auth/v1/user and rejects
//     anon/service-role keys with "missing sub claim") — not usable from a
//     service-to-service backend without provisioning a dedicated logged-in
//     service user, which is out of scope here.
//   - ptnrwrgzrsbocgxlpvhd's `ai-chat` (auth-gateway's own project) DOES
//     accept an anon key, but is a different, unrelated project.
// The correct target is mxtsdgkwzjzlttpotole's `ai-router` function
// ("Multi-provider AI router") — verified live: accepts the plain anon key,
// accepts {messages: [...]} directly (no payload translation needed),
// responds in ~1.4-2.5s via Lovable AI Gateway (Gemini 2.5 Flash), and its
// {"response": "..."} field already matches normaliseResponse() below.
const SUPABASE_URL      = process.env.SUPABASE_URL             || 'https://mxtsdgkwzjzlttpotole.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY        || '';
const EDGE_CHAT_PATH    = process.env.SUPABASE_EDGE_CHAT_PATH  || '/functions/v1/ai-router';
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
    raw?.output                             ||  // Current edge fallback payload
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

  const { messages = [], systemPrompt } = internalRequest;

  const conversationMessages = messages.filter(
    m => m.role === 'user' || m.role === 'assistant'
  );

  if (conversationMessages.length === 0) {
    throw new Error('Supabase edge adapter: no user message found in request');
  }

  // The edge function falls back to its own default persona (VortexCore's
  // "digital banker") only when no system-role message is present — verified
  // live 2026-08-19. It DOES honor a role:"system" entry inside `messages`
  // (a top-level `system` field is ignored), so the caller's persona must be
  // forwarded this way or every use case that falls through to this
  // last-resort vendor silently gets VortexCore's persona instead of its own.
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...conversationMessages]
    : conversationMessages;

  // ai-router's contract is {messages: [...]} directly — verified live
  // 2026-08-18, no payload translation needed.
  const payload = { messages: allMessages };

  const timeoutMs = internalRequest.timeoutOverrideMs || TIMEOUT_MS;

  const response = await fetchWithRetry(`${SUPABASE_URL}${EDGE_CHAT_PATH}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'apikey':        SUPABASE_ANON_KEY,
      'User-Agent':    'Onasis-CORE/1.0',
    },
    body:   JSON.stringify(payload),
    timeoutMs,
  });

  if (!response.ok) {
    // Intentionally vague — do not surface upstream error details
    throw new Error(`Supabase edge adapter: upstream returned ${response.status}`);
  }

  const raw = await response.json();
  return normaliseResponse(raw);
}

/**
 * Health check — verifies the Supabase project is reachable.
 * Checks the lightweight REST health endpoint (not the edge function,
 * to avoid unnecessary invocation costs).
 */
async function healthCheck() {
  if (!SUPABASE_ANON_KEY) return false;

  try {
    // Supabase projects expose /rest/v1/ to confirm the project is up.
    // This project restricts /rest/v1/ to service_role keys — anon key returns 401.
    // 401 is an intentional auth rejection (not a connectivity failure), so treat it
    // as "project is reachable". Only timeouts and 5xx indicate actual downtime.
    const response = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/`, {
      headers: { 'apikey': SUPABASE_ANON_KEY },
      timeoutMs: healthCheckTimeoutMs('SUPABASE_EDGE'),
      retries: 0,
    });
    return response.ok || response.status === 401 || response.status === 404;
  } catch {
    return false;
  }
}

module.exports = { chat, healthCheck };
