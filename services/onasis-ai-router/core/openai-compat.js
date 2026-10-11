'use strict';

/**
 * OpenAI-compatible facade for the router.
 *
 * The router's native contract is POST /api/v1/ai-chat with
 * { use_case, messages } -> { response, usage, onasis_metadata }. Every current
 * caller (Slack/Discord concierge, L0 concierge, repl-cli, the integration
 * guide) uses that and keeps using it. This module adds a *narrow* second
 * surface under /v1 so harnesses that can only speak OpenAI — Pi, IDE
 * extensions, SDK-based clients — can call the router without a bespoke adapter.
 *
 * Design rules, all deliberate:
 *
 * 1. One public model. Callers see `lzero` (alias `Vortex-L0`), owned by
 *    `Onasis`. The real vendor and model are never disclosed — the same rule
 *    sanitizeVendorResponse() already enforces on the native path.
 * 2. The facade only translates. It does not route, retry, or pick vendors; it
 *    reshapes a request, hands it to the existing handler, and reshapes the
 *    reply. All routing behaviour stays in one place.
 * 3. Streaming is refused explicitly, not faked. `stream: true` returns a clear
 *    error until real SSE exists, because a silently non-streaming response to
 *    a client that asked to stream looks like a hang.
 */

const { CALLER_FORBIDDEN_ROLES, forbiddenRoleMessage } = require('./message-policy');

const MODEL_ID = 'lzero';
const MODEL_OWNER = 'Onasis';

// Accepted spellings for the one model. Case-insensitive. Anything else is a
// 404 model_not_found, matching OpenAI's behaviour, so a misconfigured client
// gets a precise error instead of silently receiving a different model.
const MODEL_ALIASES = new Set(['lzero', 'vortex-l0', 'vortexl0', 'l0']);

// Created timestamp for the model object. Fixed, not Date.now(): OpenAI clients
// may cache or diff this, and a value that changes every request is noise.
const MODEL_CREATED = 1756684800; // 2026-09-01T00:00:00Z

// The lane the facade maps to. dashboard-assistant is the general-purpose
// conversational lane (1200 max tokens); ask-ai's 350 is too tight to serve as
// a general OpenAI endpoint. Callers may still name a lane explicitly via
// X-Use-Case, which the native resolver already validates.
const DEFAULT_USE_CASE = 'dashboard-assistant';

function modelObject(id = MODEL_ID) {
  return { id, object: 'model', created: MODEL_CREATED, owned_by: MODEL_OWNER };
}

function modelList() {
  return { object: 'list', data: [modelObject()] };
}

function isKnownModel(model) {
  if (model === undefined || model === null || model === '') return true; // default
  return MODEL_ALIASES.has(String(model).trim().toLowerCase());
}

/** OpenAI-shaped error envelope. */
function openAIError(message, { type = 'invalid_request_error', code = null, param = null } = {}) {
  return { error: { message, type, param, code } };
}

/**
 * OpenAI SDKs send the key as `Authorization: Bearer <key>`. This translation
 * was added because the auth gateway accepted a `lano_` key only as
 * `X-API-Key` — measured 2026-09-01: Bearer+lano_ -> 401 in 113ms,
 * X-API-Key+lano_ -> 200.
 *
 * **That is no longer true.** Onasis-CORE PR #112 shipped (auth-gateway
 * `a28f056`, "resolve bearer API keys to UAI") and is deployed; re-measured
 * 2026-09-03, both transports return 200. So this is now a no-op in effect.
 *
 * Kept deliberately rather than deleted: it costs one header comparison, it
 * keeps this surface working if the router is ever pointed at an older gateway,
 * and it enforces the "never send both Authorization and X-API-Key" rule at the
 * one boundary where an SDK controls the transport. Remove it only alongside a
 * check that no deployment target predates a28f056.
 *
 * `lms_` keys are MaaS-scoped and cannot authenticate here at all, so they are
 * reported precisely rather than forwarded to produce an opaque 401.
 */
function normalizeCredential(req) {
  const auth = req.headers?.['authorization'];
  if (!auth || req.headers['x-api-key']) return null;

  const m = /^Bearer\s+(.+)$/i.exec(String(auth).trim());
  if (!m) return null;
  const token = m[1].trim();

  if (token.startsWith('lano_')) {
    req.headers['x-api-key'] = token;
    delete req.headers['authorization'];
    return 'moved-to-x-api-key';
  }
  if (token.startsWith('lms_') || token.startsWith('vx_')) {
    return 'unsupported-credential';
  }
  return null; // JWT / OAuth bearer — leave for the normal Bearer path
}

/**
 * Validate an OpenAI chat.completions request and convert it to the router's
 * native body. Returns { body } or { error, status }.
 */
function toInternalRequest(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};

  if (!isKnownModel(body.model)) {
    return {
      status: 404,
      error: openAIError(
        `The model '${body.model}' does not exist. This endpoint serves '${MODEL_ID}'.`,
        { type: 'invalid_request_error', code: 'model_not_found', param: 'model' },
      ),
    };
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return {
      status: 400,
      error: openAIError("'messages' is required and must be a non-empty array.",
        { code: 'invalid_messages', param: 'messages' }),
    };
  }

  for (const [i, msg] of body.messages.entries()) {
    if (!msg || typeof msg !== 'object' || typeof msg.role !== 'string') {
      return {
        status: 400,
        error: openAIError(`messages[${i}] must be an object with a 'role'.`,
          { code: 'invalid_message', param: `messages[${i}]` }),
      };
    }
    // Convergence plan §3: applications send user/assistant/approved tool
    // history; system and developer instruction is owned server-side.
    //
    // This is enforcement, not hygiene. Before it existed, a caller-supplied
    // system message reshaped the assistant through this endpoint — a "you are
    // a pirate" system role produced "Arrr, I be yer Onasis AI assistant,
    // matey" (observed 2026-09-03, intermittently, which makes it harder to
    // notice rather than less real). sanitizePersonaLeaks blocks known persona
    // NAMES downstream; nothing stopped a caller redefining the ROLE.
    //
    // The rule itself lives in core/message-policy.js so this facade and the
    // native path enforce one definition. The env relaxation lever there is
    // deliberately NOT honoured here: /v1 is a new surface with no legacy
    // callers, so there is nothing to keep compatible.
    // Compared case-insensitively: a vendor that accepts "System" would
    // otherwise take an instruction this check waved through.
    const role = msg.role.trim().toLowerCase();
    if (CALLER_FORBIDDEN_ROLES.has(role)) {
      return {
        status: 400,
        error: openAIError(forbiddenRoleMessage(role),
          { code: 'system_role_not_permitted', param: `messages[${i}]` }),
      };
    }
  }

  if (body.stream === true) {
    // Refused rather than silently ignored: a client that asked to stream and
    // gets a buffered body with no error reads as a hang. See the streaming
    // notes spec for what implementing this properly requires.
    return {
      status: 400,
      error: openAIError(
        'Streaming is not supported on this endpoint yet. Retry with "stream": false.',
        { type: 'invalid_request_error', code: 'stream_unsupported', param: 'stream' },
      ),
    };
  }

  const internal = { messages: body.messages };
  if (typeof body.temperature === 'number') internal.temperature = body.temperature;
  if (typeof body.max_tokens === 'number') internal.max_tokens = body.max_tokens;
  if (Array.isArray(body.tools) && body.tools.length > 0) internal.tools = body.tools;
  if (body.tool_choice) internal.tool_choice = body.tool_choice;

  return { body: internal };
}

/**
 * Convert the router's native reply into an OpenAI chat.completion.
 *
 * `id` and `created` are injected by the caller so this stays pure and
 * testable — Date.now() here would make assertions time-dependent.
 */
function toChatCompletion(native, { id, created, model = MODEL_ID } = {}) {
  const content = typeof native?.response === 'string' ? native.response : '';
  const toolCalls = Array.isArray(native?.tool_calls) ? native.tool_calls : [];
  const u = native?.usage || {};

  const message = { role: 'assistant', content: content || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [{
      index: 0,
      message,
      logprobs: null,
      finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    }],
    usage: {
      prompt_tokens:     Number(u.prompt_tokens) || 0,
      completion_tokens: Number(u.completion_tokens) || 0,
      total_tokens:      Number(u.total_tokens)
        || (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0),
    },
  };
}

module.exports = {
  MODEL_ID,
  MODEL_OWNER,
  MODEL_ALIASES,
  MODEL_CREATED,
  DEFAULT_USE_CASE,
  modelObject,
  modelList,
  isKnownModel,
  openAIError,
  normalizeCredential,
  toInternalRequest,
  toChatCompletion,
};
