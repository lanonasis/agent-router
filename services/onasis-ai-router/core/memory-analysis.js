'use strict';

/**
 * Internal surface for the memory intelligence edge functions
 * (POST /api/v1/internal/memory-analysis).
 *
 * Those functions previously called the vendors directly and could not use
 * /api/v1/ai-chat, for three reasons this module exists to answer:
 *
 *   1. Every one of them sent a `system` message, and message-policy rejects a
 *      caller-supplied system role with 400. Here the caller sends a task NAME;
 *      the brief that used to be their system message lives in TASK_BRIEFS and
 *      the lane prompt is the router's, so system instruction stays ours.
 *
 *   2. /api/v1/ai-chat needs a credential, and a shared lano_ key in the edge
 *      environment is one identity for every user: MemoryPrefetch would search
 *      that account's memories and splice them into other users' answers. This
 *      route instead runs as `_publicSurface` — no identity, no prefetch, no
 *      tools — behind a shared secret that grants nothing but this route.
 *
 *   3. Five callers parse the reply with JSON.parse; the memory-intelligence
 *      lane is a conversational persona. `memory-analysis-json` asks for bare
 *      JSON only.
 *
 * As in public-ask.js, the body is built here from a whitelist and never spread
 * from the request, so a field added to the caller's shape cannot leak through.
 */

const crypto = require('crypto');

const MEMORY_ANALYSIS_USE_CASE = 'memory-analysis-json';

// The edge functions cap their digests well below this (extract-insights at
// 12,000 chars); this is the ceiling for a well-behaved caller, not a target.
const MAX_INPUT_CHARS = 24_000;

const INTERNAL_SECRET_HEADER = 'x-internal-secret';

// Moved from the system messages the edge functions used to send
// (Onasis-CORE supabase/functions/intelligence-*/index.ts, 2026-10-05).
// Verbatim except extract-insights, which adds an output cap.
const TASK_BRIEFS = Object.freeze({
  'analyze-patterns':
    'You are a productivity analyst helping users understand their memory/note-taking patterns. Be concise and actionable.',
  'suggest-tags':
    'You are a tagging assistant. Suggest relevant, concise tags for knowledge management. Return only a JSON array.',
  // The edge function's prompt asks for "detailed insights" with no limit on
  // how many. Measured 2026-10-05 against its exact prompt: 18-19 insights and
  // ~2,700 output tokens, 37s - past both the first vendor's 30s and the CLI's
  // 30s, so the caller only ever saw the tags-and-types fallback. With the cap
  // below: 6 insights, 9-10s. A count alone was not enough (12-14 came back);
  // the length limit is what makes the model keep to it.
  'extract-insights':
    'You are a knowledge analyst helping users understand patterns in their notes and memories. Be insightful but grounded in the actual content. Return at most 6 insights in total, and keep each insight to two sentences.',
  'health-check':
    'You are a productivity and knowledge management expert. Provide specific, actionable advice.',
  'behavior-suggest':
    'You are a workflow assistant that suggests next steps for software engineering tasks. Return only valid JSON arrays. Base suggestions on the completed steps and any relevant past patterns provided.',
});

function sanitizeMemoryAnalysis(rawBody) {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return { ok: false, code: 'invalid_body', message: 'Send a JSON body with "task" and "input".' };
  }

  const task = typeof rawBody.task === 'string' ? rawBody.task.trim() : '';
  if (!Object.prototype.hasOwnProperty.call(TASK_BRIEFS, task)) {
    return {
      ok: false,
      code: 'unknown_task',
      message: `"task" must be one of: ${Object.keys(TASK_BRIEFS).join(', ')}.`,
    };
  }

  const input = typeof rawBody.input === 'string' ? rawBody.input.trim() : '';
  if (!input) {
    return { ok: false, code: 'input_required', message: 'A non-empty "input" string is required.' };
  }
  if (input.length > MAX_INPUT_CHARS) {
    // Refused rather than truncated: a cut digest silently changes the answer.
    return {
      ok: false,
      code: 'input_too_long',
      message: `Keep "input" under ${MAX_INPUT_CHARS} characters.`,
    };
  }

  return {
    ok: true,
    task,
    body: {
      use_case: MEMORY_ANALYSIS_USE_CASE,
      messages: [{ role: 'user', content: `Task brief: ${TASK_BRIEFS[task]}\n\n${input}` }],
      tools: [],
    },
  };
}

/**
 * @returns {'ok'|'invalid'|'not_configured'}
 * Unset or empty means the route is off — fail closed, never open.
 */
function verifyInternalSecret(provided, expected) {
  if (typeof expected !== 'string' || expected.length === 0) return 'not_configured';
  if (typeof provided !== 'string' || provided.length === 0) return 'invalid';
  // Digest both sides so timingSafeEqual gets equal lengths and the comparison
  // does not reveal the secret's length.
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b) ? 'ok' : 'invalid';
}

module.exports = {
  sanitizeMemoryAnalysis,
  verifyInternalSecret,
  MEMORY_ANALYSIS_USE_CASE,
  MAX_INPUT_CHARS,
  INTERNAL_SECRET_HEADER,
  TASK_BRIEFS,
};
