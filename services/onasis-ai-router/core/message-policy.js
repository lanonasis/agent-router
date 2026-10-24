'use strict';

/**
 * Who may set the system instruction.
 *
 * Convergence plan §"Fixed decisions": *"Applications send user/assistant/
 * approved tool history. Agent Heaven owns hidden system/developer
 * instruction."* This module is the single place that rule is expressed, so the
 * OpenAI facade (/v1) and the native path (/api/v1/ai-chat) cannot drift apart.
 *
 * This is enforcement, not hygiene. Before it existed a caller-supplied system
 * message reshaped the assistant end-to-end — a "you are a pirate" role
 * produced *"Arrr, I be yer Onasis AI assistant, matey"* (observed 2026-09-03,
 * intermittently, which makes it harder to notice rather than less real).
 * `sanitizePersonaLeaks` blocks known persona NAMES downstream; nothing stopped
 * a caller redefining the ROLE.
 */

// `developer` is included because OpenAI promoted it to a system-equivalent
// role; accepting it would reopen the hole under a different name.
const CALLER_FORBIDDEN_ROLES = new Set(['system', 'developer']);

/**
 * Shared persona-leak blocklist and sanitizer.
 *
 * Exported from vendors/index.js so both the buffered path (sanitizeVendorResponse)
 * and the streaming path (routeToAIServiceStream) share the same rules — one
 * source of truth.  Streaming copies the logic here so it does not depend on
 * the full response object that only exists in the buffered path.
 *
 * Covered shapes (observed live from gateway vendors):
 *   "You can call me Nemotron" / "I am Nemotron" / "My name is X"
 *   "trained by NVIDIA researchers" / "developed by OpenAI"
 *   "running inside the OpenClaw platform"
 *   "as an AI language model"
 *   vendor/model names that bleed through ("NVIDIA", "MiniMax", etc.)
 *
 * @param {string} text
 * @returns {string}
 */
function sanitizePersonaLeaks(text) {
  if (!text || typeof text !== 'string') return text;

  let out = text;

  const PERSONA_LEAK_BLOCKLIST = [
    'OpenClaw', 'Nemotron', 'NVIDIA', 'Nvidia', 'nvidia',
    'Hermes Agent', 'Hermes', 'Ollama', 'ollama', 'VortexAI', 'VortexCore',
    'kilocode', 'Kilocode',
    'MiniMax', 'Minimax', 'minimax',
  ];

  for (const name of PERSONA_LEAK_BLOCKLIST) {
    out = out.replace(new RegExp(`\\b${name}\\b`, 'g'), 'Onasis');
  }

  out = out.replace(/\bMr\.?\s+Banks\b/g, 'Onasis');

  out = out.replace(/\/(?:root|home)\/[^\s"'`]+/g, '[workspace]');
  out = out.replace(/\bSeye\s+Derick\b/gi, 'the Onasis team');
  out = out.replace(/\bDerick'?s\b/gi, "the Onasis team's");
  out = out.replace(/\b(?:Seye|Derick)\b/g, 'the Onasis team');

  out = out.replace(
    /\b[a-zA-Z0-9_./:-]*(?:nemotron|qwen|llama|claude|mistral|deepseek|gpt)[a-zA-Z0-9_./:-]*(?::[a-z0-9-]+)?\b/gi,
    'Onasis'
  );

  out = out.replace(
    /\bas\s+an?\s+(?:AI|large\s+language)\s+language\s+model\b/gi,
    'as the Onasis assistant'
  );

  out = out.replace(
    /\b(?:trained|developed|built|created|designed|made|powered)\s+by\s+([A-Z][A-Za-z0-9_-]{1,30})\b/g,
    (_match, name) => {
      if (/^onasis/i.test(name)) return _match;
      return `${_match.split(/\s+by\s+/)[0]} by Onasis`;
    }
  );

  out = out.replace(
    /\b(?:I am|I'm|I'm|I'm|You can call me|My name is|Call me|Called)\s+([A-Z][A-Za-z0-9_-]{1,30})\b/g,
    (_match, name) => {
      if (/^onasis/i.test(name)) return _match;
      return 'I am the Onasis assistant';
    }
  );

  return out;
}

/**
 * Exported so both buffered and streaming paths share one blocklist.
 * `sanitizeVendorResponse` in vendors/index.js also calls it, but that is a
 * separate code path (it operates on a full response object).  This export
 * is only for streaming where we only have per-chunk text.
 */

// Rollback lever for the native path, default OFF.
//
// Checked live on 2026-09-03: no caller of /api/v1/ai-chat sends a system
// message — every `role: 'system'` construction in the estate targets
// api.openai.com or api.anthropic.com directly, not the router. So this is not
// a compatibility shim for a known caller; it is the documented way to restore
// previous behaviour if an unknown integration turns out to depend on it,
// without a redeploy. It is deliberately not honoured on /v1, which is a new
// surface with no legacy callers to protect.
function callerRolesRelaxed() {
  return String(process.env.ALLOW_CALLER_SYSTEM_MESSAGES || '').toLowerCase() === 'true';
}

/**
 * @returns {{role: string, index: number}|null} the first offending message.
 */
function findForbiddenRole(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = 0; i < messages.length; i++) {
    const raw = messages[i] && messages[i].role;
    if (typeof raw !== 'string') continue;
    // Trimmed and lowercased: whether a given vendor honours " System " is not
    // worth discovering in production, and normalising costs nothing.
    const role = raw.trim().toLowerCase();
    if (CALLER_FORBIDDEN_ROLES.has(role)) {
      return { role, index: i };
    }
  }
  return null;
}

/** Shared wording so both surfaces point callers at the same alternative. */
// Leads with X-Use-Case because that is the option a caller can act on today:
// X-Onasis-Profile exists but refuses every request until auth-gateway returns
// entitlements, so advertising it first would send people down a dead end.
function forbiddenRoleMessage(role) {
  return `The '${role}' role is not accepted here — system instruction is owned by the `
    + 'service. Select behaviour with a use case (X-Use-Case), or an entitled '
    + 'profile (X-Onasis-Profile) where one has been provisioned.';
}

/**
 * Carries an HTTP status so routeToAIService can answer 400 instead of
 * collapsing a caller mistake into its catch-all 500
 * "AI service temporarily unavailable".
 */
class MessagePolicyError extends Error {
  constructor(message, { status = 400, code = 'system_role_not_permitted', param = null } = {}) {
    super(message);
    this.name = 'MessagePolicyError';
    this.status = status;
    this.code = code;
    this.param = param;
  }
}

/**
 * Native-path gate. Throws MessagePolicyError when a caller supplies a role it
 * does not own.
 */
function assertCallerRoles(messages, { logger } = {}) {
  const found = findForbiddenRole(messages);
  if (!found) return;

  if (callerRolesRelaxed()) {
    // Loud on purpose: this is a security control being held open.
    logger?.warn?.('Caller-supplied system role permitted by ALLOW_CALLER_SYSTEM_MESSAGES', {
      role: found.role, index: found.index,
    });
    return;
  }

  throw new MessagePolicyError(forbiddenRoleMessage(found.role), {
    param: `messages[${found.index}]`,
  });
}

/** True when a message carries something a model could answer. */
function hasContent(message) {
  const content = message && message.content;
  if (typeof content === 'string') return content.trim().length > 0;
  // Multimodal content arrives as an array of parts.
  return Array.isArray(content) && content.length > 0;
}

/**
 * Refuse a request that carries nothing to answer.
 *
 * The native path reads `messages`, or a `prompt` string. A body with neither
 * (`{"question": "..."}`, the shape /api/v1/public/ask takes, is the common
 * one) used to reach the vendor chain as an empty conversation. Every vendor
 * rejected it, each rejection was recorded against that vendor's health, and
 * the caller was told 503 "No AI capacity is currently available" — an outage
 * report for what was a malformed request.
 */
function assertUserContent(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const answerable = list.some((m) => m && String(m.role || '').trim().toLowerCase() === 'user' && hasContent(m));
  if (answerable) return;

  throw new MessagePolicyError(
    'Nothing to answer: send "messages" with at least one non-empty user message, or a "prompt" string.',
    { code: 'user_message_required', param: 'messages' },
  );
}

module.exports = {
  CALLER_FORBIDDEN_ROLES,
  MessagePolicyError,
  assertCallerRoles,
  assertUserContent,
  callerRolesRelaxed,
  findForbiddenRole,
  forbiddenRoleMessage,
  sanitizePersonaLeaks,
};
