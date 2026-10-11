'use strict';

/**
 * The unauthenticated landing-page surface.
 *
 * Every other route on this service resolves a credential before doing work.
 * This one does not, which makes it the only place where an anonymous caller
 * reaches a paid vendor. Two consequences drive the design:
 *
 *   1. Everything in the body is hostile input. This module is the entire
 *      security boundary — nothing downstream re-checks, because downstream
 *      cannot tell an anonymous request from an authenticated one.
 *
 *   2. It must not be usable as a general-purpose proxy. Anything that lets a
 *      caller choose the lane, the model, the tools, or the conversation
 *      history turns a platform-information button into free inference.
 *
 * So the caller sends exactly one thing — a question string — and everything
 * else is decided here. A caller-supplied `messages` array is DISCARDED rather
 * than merged: accepting it would let anyone forge assistant turns and claim
 * the model had already agreed to something.
 */

// The onboarding lane: 1000 token ceiling, guide persona, no memory-write.
const PUBLIC_ASK_USE_CASE = 'landing-guide';

// A platform question fits comfortably. Long enough for a real sentence,
// short enough that this is not a cheap way to summarise a document.
const MAX_QUESTION_CHARS = 500;

function sanitizePublicAsk(rawBody) {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return { ok: false, code: 'question_required', message: 'Send a JSON body with a "question" string.' };
  }

  const raw = rawBody.question;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, code: 'question_required', message: 'A non-empty "question" string is required.' };
  }

  const question = raw.trim().replace(/\s+/g, ' ');
  if (question.length > MAX_QUESTION_CHARS) {
    return {
      ok: false,
      code: 'question_too_long',
      message: `Keep the question under ${MAX_QUESTION_CHARS} characters.`,
    };
  }

  // Built from scratch, never spread from the caller's body — a whitelist by
  // construction, so a field added to the request shape later cannot leak
  // through by default.
  return {
    ok: true,
    body: {
      use_case: PUBLIC_ASK_USE_CASE,
      messages: [{ role: 'user', content: question }],
      // Explicitly empty, not absent. Absent means "use the lane default",
      // which is memory.search + memory.get — an anonymous caller must reach
      // neither, and the profile ceiling cannot help because there is no
      // profile without a credential.
      tools: [],
    },
  };
}

module.exports = { sanitizePublicAsk, PUBLIC_ASK_USE_CASE, MAX_QUESTION_CHARS };
