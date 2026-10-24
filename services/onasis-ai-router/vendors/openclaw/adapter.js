'use strict';

/**
 * OpenClaw Vendor Adapter — INTERNAL ONLY
 *
 * OpenClaw speaks the OpenAI Chat Completions shape on
 *   POST <OPENCLAW_BASE_URL>/v1/chat/completions
 * with bearer auth (OPENCLAW_GATEWAY_TOKEN). It is treated here as a
 * vendor on equal footing with ollama/anthropic/openai/supabase-edge.
 *
 * Key differences vs the stock OpenAI adapter:
 *  - The gateway fronts multiple agents. Agent is selected by either:
 *      • `model: "openclaw:<agentId>"` in the request body, OR
 *      • `x-openclaw-agent-id: <agentId>` request header
 *    We send BOTH for compatibility.
 *  - Session continuity is established via the OpenAI-style `user` field,
 *    which OpenClaw uses as a stable key to share an agent's session
 *    across requests.
 *  - The upstream authorisation header is OPENCLAW_GATEWAY_TOKEN, not
 *    OPENAI_API_KEY; we never reuse or rename the OpenAI header.
 *
 * Privacy invariant: the response is normalised into the same internal
 * shape as the other adapters. `agentId`, `model`, `vendor`, and any
 * `x-openclaw-*` keys are NEVER returned to clients — that happens in
 * `sanitizeVendorResponse()` higher up.
 */

const { fetchWithRetry, healthCheckTimeoutMs } = require('../_shared/http-client');
const { assertUsableCompletion } = require('../_shared/response-contract');

const BASE_URL    = (process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789').replace(/\/+$/, '');
const CHAT_PATH   = process.env.OPENCLAW_CHAT_PATH || '/v1/chat/completions';
const TIMEOUT_MS  = parseInt(process.env.OPENCLAW_TIMEOUT_MS || '30000', 10);
const API_KEY     = process.env.OPENCLAW_GATEWAY_TOKEN || '';

const DEFAULT_AGENT = process.env.OPENCLAW_DEFAULT_AGENT || 'fixer';

// Must match the real agent roster on this gateway (`openclaw agents list`) —
// fixer / research / coder / data / onasis-router. Verified 2026-08-19 on
// srv896342; re-check before assuming parity on another host's OpenClaw install.
//
// `onasis-router` (added 2026-08-19) is a dedicated, freshly-created agent
// used ONLY for conversational/identity-sensitive use cases. fixer/data/coder
// are general-purpose OpenClaw agents with their own accumulated identity —
// tool-use framing, skill-workshop history (/root/.openclaw/skill-workshop/*),
// and ambient persona ("Mr Banks") that bled into concierge responses even
// with a strong system prompt (see commit 9abfa7e's sanitizePersonaLeaks —
// necessary defense-in-depth, but treating the symptom). A brand-new agent
// with no accumulated history has far less ambient identity to leak in the
// first place. code-assist/repl-nlp/content-generation stay on the
// capability-specialized agents (coder/research) since those lanes are
// identity-insensitive and benefit more from the coding-tuned agent.
// NOTE: agents created via `openclaw agents add` get their OWN isolated auth
// store (agents/<id>/agent/openclaw-agent.sqlite) which starts EMPTY —
// requests to them fail `No API key found for provider "..."` until auth is
// configured or portable profiles are copied from the main agentDir. The
// dedicated `onasis-router` agent (created 2026-08-19) hit exactly this and is
// therefore NOT routed to yet; the conversational lanes stay on `fixer`, which
// is authenticated and fast (~4s). Its original justification — isolating from
// recall-forge's auto-injected cross-agent context — was also addressed at the
// source on 2026-08-19 by switching that plugin to recallMode:'ondemand' /
// autoRecall:false. Re-point these lanes at `onasis-router` only after
// verifying it answers a direct gateway probe without a 401.
const USE_CASE_AGENT = {
  'code-assist':         'coder',
  'repl-nlp':            'coder',
  'content-generation':  'research',
  // Conversational / identity-sensitive lanes now run on the dedicated
  // `onasis-router` agent. The precondition recorded above — "answers a direct
  // gateway probe without a 401" — was verified 2026-09-01 after the 2026.8.1
  // gateway recovery: 3/3 runs, 200 in 1.8-2.9s, returning a clean "OK".
  // The earlier 401 was the gateway's broken post-update state, NOT the empty
  // auth_profile_store it was first attributed to — that store is still empty
  // and the agent answers fine.
  // Same probe against `fixer`: 200 in 11.9s, prefixed with reasoning text and
  // truncated mid-sentence — the accumulated-identity weight this move avoids.
  'support-chat':        'onasis-router',
  'memory-analysis':     'onasis-router',
  'memory-analysis-json': 'onasis-router',
  'dashboard-assistant': 'onasis-router',
  'ask-ai':              'onasis-router',
  'landing-guide':       'onasis-router',
};

function pickAgent(useCase) {
  return USE_CASE_AGENT[useCase] || DEFAULT_AGENT;
}

function authHeaders() {
  if (!API_KEY) return null;
  return {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type':  'application/json',
    'User-Agent':    'Onasis-CORE/1.0',
  };
}

function normaliseResponse(raw, agentId) {
  const choice = raw?.choices?.[0] || {};
  const message = choice.message || { role: 'assistant', content: '' };
  return {
    message: {
      role:    message.role    || 'assistant',
      content: typeof message.content === 'string' ? message.content : '',
    },
    done:        true,
    done_reason: choice.finish_reason || raw?.stop_reason || 'stop',
    tool_calls:  Array.isArray(message.tool_calls) ? message.tool_calls : [],
    usage: {
      prompt_tokens:     raw?.usage?.prompt_tokens     || 0,
      completion_tokens: raw?.usage?.completion_tokens || 0,
      total_tokens:      raw?.usage?.total_tokens      || 0,
    },
    _routed_agent: agentId,
  };
}

async function chat(internalRequest, model) {
  if (!API_KEY) {
    throw new Error('OPENCLAW_GATEWAY_TOKEN is not configured — OpenClaw vendor unavailable');
  }

  const headers = authHeaders();
  if (!headers) {
    throw new Error('OpenClaw adapter: missing auth headers (token not loaded)');
  }

  const { messages = [], systemPrompt, temperature, maxTokens, useCase } = internalRequest;

  const agentId = pickAgent(useCase);

  const payloadMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const payload = {
    model:    `openclaw:${agentId}`,
    messages: payloadMessages,
    temperature: temperature ?? 0.7,
    max_tokens:  maxTokens  ?? 500,
    stream:      false,
    user:        internalRequest.user || process.env.OPENCLAW_SESSION_KEY || undefined,
  };

  if (payload.user === undefined) delete payload.user;

  // Tool definitions arrive in OpenAI's native shape already (the router's
  // internal format) — OpenClaw's gateway speaks the same OpenAI-compatible
  // chat/completions schema, so they're forwarded as-is.
  if (Array.isArray(internalRequest.tools) && internalRequest.tools.length > 0) {
    payload.tools = internalRequest.tools;
  }

  const timeoutMs = internalRequest.timeoutOverrideMs || TIMEOUT_MS;

  const response = await fetchWithRetry(`${BASE_URL}${CHAT_PATH}`, {
    method: 'POST',
    headers: { ...headers, 'x-openclaw-agent-id': agentId },
    body: JSON.stringify(payload),
    timeoutMs,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenClaw adapter: upstream returned ${response.status} — ${detail.slice(0, 200)}`);
  }

  const raw = await response.json();
  return assertUsableCompletion(normaliseResponse(raw, agentId), {
    vendorId: 'openclaw',
    sentinels: internalRequest.errorSentinels,
  });
}

async function healthCheck() {
  if (!API_KEY) return false;

  try {
    const response = await fetchWithRetry(`${BASE_URL}/v1/models`, {
      headers: authHeaders(),
      timeoutMs: healthCheckTimeoutMs('OPENCLAW'),
      retries: 0,
    });
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
}

module.exports = {
  chat,
  healthCheck,
};
