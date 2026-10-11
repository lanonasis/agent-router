'use strict';

/**
 * Hermes Gateway Vendor Adapter — INTERNAL ONLY — STUB (not routed)
 *
 * Hermes Agent's gateway service (`hermes-gateway` systemd --user unit) exposes
 * an API on this host's own Tailscale IP only — not 127.0.0.1, not 0.0.0.0.
 * Per the delegation-guide skill (Hermes Gateway section, verified 2026-07-22
 * on srv896342):
 *   - Endpoint: http://100.107.32.45:8642 (srv896342) — a different, unrelated
 *     instance backs http://100.98.62.115:8642 on lanonasis-main; do not treat
 *     them as a load-balanced pair.
 *   - Auth: Bearer token, value is API_SERVER_KEY (per-host, not shared).
 *   - Model name surfaced by the gateway: "Hermes Agent" (API_SERVER_MODEL_NAME).
 *
 * UPDATE 2026-08-18: chat path IS now curl-verified — it's real and correctly
 * shaped. Two things fixed/found this session:
 *   - `.env.production`'s API_SERVER_KEY had been migrated from the wrong
 *     source (an orphaned /etc file) earlier this session and was NOT the
 *     real gateway key — corrected by re-migrating from the authoritative
 *     `/root/.hermes/.env` (confirmed via length/hash, values differed).
 *   - With the correct key, POST /v1/chat/completions reaches real backend
 *     agent logic (past auth) but currently 500s with a Hermes-side bug:
 *     `load_soul_md() got an unexpected keyword argument 'home_override'`
 *     — a Python signature mismatch inside Hermes's own runtime, not
 *     anything in this adapter or the request shape. This needs a fix on
 *     the Hermes Agent side (report upstream / `hermes update`), not here.
 * Still a STUB — do not flip to 'active' in vendors/index.js until that
 * backend bug is fixed and a real chat response is confirmed end-to-end.
 */

const { fetchWithRetry, healthCheckTimeoutMs } = require('../_shared/http-client');

const BASE_URL   = (process.env.HERMES_BASE_URL || 'http://100.107.32.45:8642').replace(/\/+$/, '');
const CHAT_PATH  = process.env.HERMES_CHAT_PATH || '/v1/chat/completions';
const TIMEOUT_MS = parseInt(process.env.HERMES_TIMEOUT_MS || '30000', 10);
const API_KEY    = process.env.API_SERVER_KEY || '';
const MODEL_NAME = process.env.API_SERVER_MODEL_NAME || 'Hermes Agent';

function authHeaders() {
  if (!API_KEY) return null;
  return {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type':  'application/json',
    'User-Agent':    'Onasis-CORE/1.0',
  };
}

function normaliseResponse(raw) {
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
  };
}

async function chat(internalRequest) {
  if (!API_KEY) {
    throw new Error('API_SERVER_KEY is not configured — Hermes vendor unavailable');
  }

  const { messages = [], systemPrompt, temperature, maxTokens } = internalRequest;

  const payloadMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const payload = {
    model:       MODEL_NAME,
    messages:    payloadMessages,
    temperature: temperature ?? 0.7,
    max_tokens:  maxTokens  ?? 500,
    stream:      false,
  };

  const timeoutMs = internalRequest.timeoutOverrideMs || TIMEOUT_MS;

  const response = await fetchWithRetry(`${BASE_URL}${CHAT_PATH}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
    timeoutMs,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Hermes adapter: upstream returned ${response.status} — ${detail.slice(0, 200)}`);
  }

  const raw = await response.json();
  return normaliseResponse(raw);
}

async function healthCheck() {
  if (!API_KEY) return false;

  try {
    // Only `/` is confirmed reachable (returns 404, not 200 — service alive,
    // no root handler). Any response at all — including 404 — means the
    // gateway process is up and Tailscale routing works.
    const response = await fetchWithRetry(`${BASE_URL}/`, {
      headers: authHeaders(),
      timeoutMs: healthCheckTimeoutMs('HERMES'),
      retries: 0,
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

module.exports = { chat, healthCheck };
