'use strict';

/**
 * Caller-executed tool pass-through.
 *
 * Most lanes here are router-executed: the model emits a tool call, the router
 * runs it against memory or code, and the model summarises the result. That
 * works because the router owns the tools. The dashboard concierge is the
 * opposite shape — it sends its OWN tools (control-room queries, proposal
 * writes) that the router cannot reach and has no credentials for, executes
 * them in the dashboard, and sends the results back on the next turn.
 *
 * Until this module existed the router had no way to express that second
 * shape. Every request was treated as router-executed, so a caller-supplied
 * tool the router did not implement came back as `{"error":"Unsupported tool"}`
 * — and on the lanes that led with pi, whose adapter hardcodes `--no-tools`,
 * the model was never even shown the tool list and truthfully answered that no
 * tools were available (observed 2026-10-27 on dashboard-assistant).
 *
 * The lane that fixes it is `tool-proxy`:
 *
 *   1. only vendors that forward `tools` and return native calls may serve it
 *      (`requiresNativeTools` in vendors/index.js);
 *   2. the router RETURNS the calls instead of executing them;
 *   3. the caller sends them back as `role: "tool"` messages on the next turn,
 *      which every adapter already accepts.
 *
 * It is gated because it turns the router into a paid, authenticated way to
 * run an arbitrary function-calling loop with a caller's own schemas. The
 * allowlist is fail-closed and keyed on the UAI auth id the credential
 * resolved to — never on a header — for the same reason CODE_TOOLS_TRUSTED_AUTH_IDS
 * is: a body field or header is caller-controlled, and the thing being
 * authorised is the caller.
 *
 * Unset means nobody, not everybody. An operator who sees a rejected request
 * gets the auth id in the log line, which is the whole provisioning step.
 */

const { MessagePolicyError } = require('./message-policy');

const TOOL_PASSTHROUGH_USE_CASE = 'tool-proxy';
const TOOL_PASSTHROUGH_ENV = 'TOOL_PASSTHROUGH_AUTH_IDS';

function isToolPassthroughUseCase(useCase) {
  return useCase === TOOL_PASSTHROUGH_USE_CASE;
}

/** auth_ids permitted to use the lane. Unset/empty means nobody. */
function trustedAuthIds(raw = process.env[TOOL_PASSTHROUGH_ENV]) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

/**
 * @returns {boolean} true only when the caller's resolved auth id is listed.
 *   An absent auth id is never trusted: anonymous callers cannot reach this
 *   lane at all, and the check should not depend on that elsewhere.
 */
function isToolPassthroughAllowed(authId, raw = process.env[TOOL_PASSTHROUGH_ENV]) {
  const id = typeof authId === 'string' ? authId.trim() : '';
  if (!id) return false;
  return trustedAuthIds(raw).has(id);
}

/**
 * Refuse the lane unless the credential's own auth id is allowlisted.
 *
 * Throws MessagePolicyError so routeToAIService answers 403 with a stable code
 * instead of its catch-all 500 — a 500 would read as an outage and invite a
 * retry that can never succeed.
 */
function assertToolPassthroughAllowed(req, { logger, raw } = {}) {
  const authId = req?.uai?.authId;
  if (isToolPassthroughAllowed(authId, raw)) return;

  logger?.warn?.('Rejected tool pass-through request — auth id is not allowlisted', {
    request_id: req?.requestId || null,
    // The id is not a secret (it is the caller's own identity, already in every
    // log line for the request) and an operator needs it to provision access.
    auth_id: authId || null,
    allowlist_env: TOOL_PASSTHROUGH_ENV,
  });

  throw new MessagePolicyError(
    `The '${TOOL_PASSTHROUGH_USE_CASE}' use case is not enabled for this credential. `
      + `Ask an operator to add its auth id to ${TOOL_PASSTHROUGH_ENV}.`,
    { status: 403, code: 'tool_passthrough_not_authorized' }
  );
}

/**
 * The lane only exists to hand calls back to the caller, so a request with no
 * tools has nothing to do here. Falling back to the router's memory defaults
 * would silently reproduce the exact defect this lane fixes: an assistant that
 * says it has no tools.
 */
function assertPassthroughTools(body) {
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  if (tools.length > 0) return;

  throw new MessagePolicyError(
    `The '${TOOL_PASSTHROUGH_USE_CASE}' use case requires caller-supplied tools — `
      + 'send a non-empty `tools` array with the request.',
    { status: 400, code: 'tools_required', param: 'tools' }
  );
}

/**
 * Normalise extracted calls to the OpenAI tool_calls shape.
 *
 * The caller replays these verbatim as an assistant turn, so every call needs
 * an id and stringified arguments: a missing id produces a tool message whose
 * tool_call_id references nothing, which OpenAI-compatible vendors reject
 * outright (observed on MiniMax, 2026-09-04). Soft-parsed calls carry no id,
 * so one is synthesised deterministically.
 */
function toOpenAIToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];

  return toolCalls
    .filter((call) => call && call.name)
    .map((call, index) => {
      const args = call.arguments;
      const serialised = typeof args === 'string'
        ? args
        : JSON.stringify(args === undefined || args === null ? {} : args);

      return {
        id: call.id || `call_${index}`,
        type: 'function',
        function: {
          name: call.name,
          arguments: serialised,
        },
      };
    });
}

/**
 * Normalise the replayed part of a tool transcript.
 *
 * On the follow-up turn a caller echoes the assistant message that declared the
 * calls, then one `role: "tool"` message per result. That assistant message
 * comes from the caller's own storage, and the common hand-rolled shape omits
 * `type: "function"` (the dashboard concierge did exactly this) or keeps
 * arguments as an object. OpenAI's schema requires the type and a string
 * argument, and vendors are inconsistent about tolerating the omission — the
 * router would 400 on the second round of a conversation that worked on the
 * first. Fixing the shape on the way in is cheaper and safer than trusting
 * every client to rebuild it perfectly.
 *
 * Only assistant turns with tool_calls are touched; everything else is
 * returned as-is, by identity.
 */
function normaliseToolTranscript(messages) {
  if (!Array.isArray(messages)) return messages;

  return messages.map((message) => {
    if (!message || message.role !== 'assistant' || !Array.isArray(message.tool_calls)) {
      return message;
    }

    const calls = message.tool_calls
      .filter((call) => call && (call.function?.name || call.name))
      .map((call, index) => {
        const args = call.function?.arguments ?? call.arguments;
        return {
          id: call.id || `call_${index}`,
          type: 'function',
          function: {
            name: call.function?.name || call.name,
            arguments: typeof args === 'string'
              ? args
              : JSON.stringify(args === undefined || args === null ? {} : args),
          },
        };
      });

    if (calls.length === 0) {
      // A `tool_calls: []` turn is not a tool turn; vendors reject an empty
      // array on an assistant message. Drop the field, keep the text.
      const { tool_calls: _dropped, ...rest } = message;
      return rest;
    }

    return { ...message, tool_calls: calls };
  });
}

module.exports = {
  TOOL_PASSTHROUGH_USE_CASE,
  TOOL_PASSTHROUGH_ENV,
  isToolPassthroughUseCase,
  trustedAuthIds,
  isToolPassthroughAllowed,
  assertToolPassthroughAllowed,
  assertPassthroughTools,
  toOpenAIToolCalls,
  normaliseToolTranscript,
};
