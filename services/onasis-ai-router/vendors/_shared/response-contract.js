'use strict';

/**
 * Vendor response contract.
 *
 * A vendor returning HTTP 200 does not mean it returned a usable completion.
 * OpenClaw intermittently returns 200 whose content is the gateway's own error
 * string ("⚠️ Agent couldn't generate a response."), which the router served to
 * users as the answer while never falling through to a healthy vendor.
 *
 * Rules 1 and 2 below are generic. Rule 3 (sentinels) is a per-vendor blocklist
 * and is deliberately a fast path for known failures, NOT the strategy — the
 * durable defence is the scoreboard, which demotes a vendor on repeated
 * contract violations regardless of whether the string is recognised.
 */

/**
 * Every vendor spells "I stopped because I hit the ceiling" differently:
 * OpenAI/MiniMax/Ollama say `length`, Anthropic says `max_tokens`, Pi says
 * `max_token`. The router acts on exactly one spelling — `done_reason ===
 * 'length'` in _noteTruncation() — so an unmapped spelling means a half-
 * sentence reaches the caller flagged as a complete answer.
 *
 * That was live for Anthropic: its `stop_reason: "max_tokens"` passed straight
 * through, so `truncated` was never set for the one active vendor that does not
 * use OpenAI's wire format. Normalising per-adapter is what allowed the gap —
 * each new adapter had to remember. It is done here instead, at the one
 * function every adapter must already call, so forgetting is not possible.
 *
 * Unrecognised values pass through untouched rather than being guessed at.
 */
const DONE_REASON_ALIASES = new Map([
  // ceiling reached — the only value the router acts on
  ['length', 'length'],
  ['max_tokens', 'length'],
  ['max_token', 'length'],
  ['model_length', 'length'],
  // finished normally
  ['stop', 'stop'],
  ['end_turn', 'stop'],
  ['stop_sequence', 'stop'],
  ['eos', 'stop'],
  // handed back a tool call
  ['tool_calls', 'tool_calls'],
  ['tool_use', 'tool_calls'],
]);

function normalizeDoneReason(reason) {
  if (typeof reason !== 'string') return reason;
  return DONE_REASON_ALIASES.get(reason.trim().toLowerCase()) || reason;
}

class VendorContractError extends Error {
  constructor(message, { vendorId, reason }) {
    super(message);
    this.name = 'VendorContractError';
    this.vendorId = vendorId;
    this.reason = reason;
  }
}

/**
 * @param {{message:{role:string,content:string}, done_reason?:string, tool_calls?:Array}} normalised
 * @param {{vendorId:string, sentinels?:RegExp[]}} opts
 * @returns {object} the same object, when usable
 * @throws {VendorContractError}
 */
function assertUsableCompletion(normalised, { vendorId, sentinels = [] }) {
  if (normalised && typeof normalised === 'object') {
    normalised.done_reason = normalizeDoneReason(normalised.done_reason);
  }

  const content = typeof normalised?.message?.content === 'string'
    ? normalised.message.content.trim()
    : '';
  const hasToolCalls = Array.isArray(normalised?.tool_calls) && normalised.tool_calls.length > 0;

  // A tool-call turn legitimately carries no prose — it must not throw.
  if (hasToolCalls) return normalised;

  if (!content) {
    // An empty turn stopped by the token cap is the incomplete-turn signature:
    // the model spent its budget on reasoning and emitted no assistant message.
    const reason = normalised?.done_reason === 'length' ? 'incomplete_turn' : 'empty_content';
    throw new VendorContractError(`Vendor returned an unusable completion (${reason})`, {
      vendorId, reason,
    });
  }

  for (const sentinel of (sentinels || [])) {
    if (sentinel.test(content)) {
      throw new VendorContractError('Vendor returned a gateway error string as content', {
        vendorId, reason: 'error_sentinel',
      });
    }
  }

  return normalised;
}

module.exports = { assertUsableCompletion, normalizeDoneReason, VendorContractError };
