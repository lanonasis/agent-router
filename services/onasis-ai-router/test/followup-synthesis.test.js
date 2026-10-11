'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const AIServiceRouter = require('../core/ai-service-router');

// Measured live 2026-09-04, the same query the Slack report used
// ("search my memory bank for the agent banks project status"):
//
//   ask-ai              41.4s -> follow-up re-emitted memory.get, suppressed
//   dashboard-assistant 55.8s -> follow-up aborted at the 30s vendor timeout
//
// The re-emission was not a weak model looping. memory.search returned two
// truncated records and the model asked to read one in full — the reasonable
// next step, and one the tool array it had just been handed said was available.
// This router runs exactly one tool round, so that reply could never be
// honoured; it was discarded and the user got raw records after 41s.
//
// So the follow-up pass no longer offers tools. What it offers is what it can
// honour.

const router = new AIServiceRouter({});

const build = (over = {}) => router._buildFollowupRequest({
  messages: [{ role: 'user', content: 'q' }],
  systemPrompt: 'BASE PROMPT',
  temperature: 0.7,
  maxTokens: 1200,
  tools: [{ type: 'function', function: { name: 'memory.search' } }],
  ...over,
});

test('the synthesis pass is not offered tools', () => {
  assert.equal('tools' in build(), false);
});

test('the rest of the request is passed through unchanged', () => {
  const req = build();
  assert.deepEqual(req.messages, [{ role: 'user', content: 'q' }]);
  assert.equal(req.temperature, 0.7);
  assert.equal(req.maxTokens, 1200);
});

test('FOLLOWUP_OFFER_TOOLS restores the previous behaviour', () => {
  const prev = process.env.FOLLOWUP_OFFER_TOOLS;
  process.env.FOLLOWUP_OFFER_TOOLS = 'true';
  try {
    assert.equal(build().tools.length, 1);
  } finally {
    if (prev === undefined) delete process.env.FOLLOWUP_OFFER_TOOLS;
    else process.env.FOLLOWUP_OFFER_TOOLS = prev;
  }
});

test('the lever is off unless explicitly set to true', () => {
  const prev = process.env.FOLLOWUP_OFFER_TOOLS;
  try {
    // Untrimmed, matching ALLOW_CALLER_SYSTEM_MESSAGES in core/message-policy.js:
    // a security-relevant lever should open on the exact word and nothing else.
    for (const v of ['', 'false', '1', 'yes', 'true ']) {
      process.env.FOLLOWUP_OFFER_TOOLS = v;
      assert.equal('tools' in build(), false,
        `FOLLOWUP_OFFER_TOOLS=${JSON.stringify(v)} should not offer tools`);
    }
    // Case-insensitive, as every other lever in this codebase is.
    process.env.FOLLOWUP_OFFER_TOOLS = 'TRUE';
    assert.equal('tools' in build(), true);
  } finally {
    if (prev === undefined) delete process.env.FOLLOWUP_OFFER_TOOLS;
    else process.env.FOLLOWUP_OFFER_TOOLS = prev;
  }
});

test('the directive tells the model the tools already ran', () => {
  const p = router._synthesisSystemPrompt('BASE PROMPT');
  assert.match(p, /already run/i);
  assert.match(p, /answer the user directly from those results/i);
  assert.match(p, /no further tool will run/i);
});

test('the composed prompt is preserved, not replaced', () => {
  // The use-case prompt carries the assistant's voice and its guardrails;
  // losing it here would make the synthesis turn sound like a different system.
  const p = router._synthesisSystemPrompt('BASE PROMPT');
  assert.ok(p.startsWith('BASE PROMPT'), 'base prompt must lead');
});

test('a null composed prompt yields the directive alone', () => {
  // systemPromptForVendor() returns null for ollama in embedded mode, where the
  // model carries its own prompt. "null\n\n<directive>" would be sent verbatim.
  const p = router._synthesisSystemPrompt(null);
  assert.doesNotMatch(p, /null/);
  assert.match(p, /already run/i);
});

// ── Synthesis retry on the rest of the chain ────────────────────────────────
//
// Root cause found live 2026-09-04. openclaw's gateway proxies `fixer` to an
// upstream provider that was returning 401; its auth-profile rotation then
// stalled until our own 30s timeout fired ("ClientDisconnectError ... HTTP
// client disconnected", 26 auth failures in two hours). Every synthesis pass
// failed while every FIRST pass kept succeeding, because choosing a tool is
// cheap and reading the result is not.
//
// Two consequences this covers:
//   1. Summarising tool results is vendor-independent work — the results are
//      already in hand — so one vendor failing it should not cost the answer.
//   2. The synthesis pass reported nothing to the scoreboard, so the vendor
//      failing 100% of the time still looked healthy and its circuit never
//      opened.

const stubChain = (impl) => ({ run: impl });

test('a recovered synthesis reports the vendor that actually answered', async () => {
  const r = new AIServiceRouter({});
  r._chain = stubChain(async ({ exclude }) => {
    assert.deepEqual(exclude, ['openclaw'], 'the failed vendor must be excluded');
    return { adapterResponse: { message: { role: 'assistant', content: 'ok' } },
             selectedVendor: { _vendorId: 'minimax' } };
  });
  const out = await r._retrySynthesisOnChain({
    useCase: 'ask-ai',
    followupMessages: [{ role: 'user', content: 'q' }],
    promptBundle: { systemPromptForVendor: () => 'BASE' },
    temperature: 0.7, maxTokens: 1200, exclude: ['openclaw'],
  });
  assert.equal(out.vendorId, 'minimax');
  assert.equal(out.adapterResponse.message.content, 'ok');
});

test('the retry carries no tools either', async () => {
  const r = new AIServiceRouter({});
  let seen;
  r._chain = stubChain(async (args) => {
    seen = args;
    return { adapterResponse: {}, selectedVendor: { _vendorId: 'ollama' } };
  });
  await r._retrySynthesisOnChain({
    useCase: 'ask-ai', followupMessages: [], exclude: ['openclaw'],
    promptBundle: { systemPromptForVendor: () => 'BASE' }, temperature: 0.7, maxTokens: 100,
  });
  assert.equal(seen.tools, undefined);
});

test('each retry vendor gets the prompt composed for IT', async () => {
  // systemPromptForVendor() varies per vendor (ollama gets a compact prompt, and
  // nothing at all in embedded mode). Reusing the failed vendor's string would
  // hand the fallback a prompt shaped for someone else.
  const r = new AIServiceRouter({});
  let bundle;
  r._chain = stubChain(async (args) => {
    bundle = args.promptBundle;
    return { adapterResponse: {}, selectedVendor: { _vendorId: 'ollama' } };
  });
  await r._retrySynthesisOnChain({
    useCase: 'ask-ai', followupMessages: [], exclude: ['openclaw'],
    promptBundle: { systemPromptForVendor: (v) => (v === 'ollama' ? null : 'RICH') },
    temperature: 0.7, maxTokens: 100,
  });
  assert.match(bundle.systemPromptForVendor('minimax'), /^RICH/);
  // ollama/embedded composes to null — the directive must still be delivered,
  // and must not arrive as the string "null".
  const forOllama = bundle.systemPromptForVendor('ollama');
  assert.doesNotMatch(forOllama, /null/);
  assert.match(forOllama, /already run/i);
});

test('exhausting the chain yields null, not a throw', async () => {
  // The caller has the tool results in hand and renders them; this is an
  // expected outcome with a defined answer, not an error.
  const r = new AIServiceRouter({});
  r._chain = stubChain(async () => { throw new Error('No alternative AI vendor available for ask-ai.'); });
  const out = await r._retrySynthesisOnChain({
    useCase: 'ask-ai', followupMessages: [], exclude: ['openclaw'],
    promptBundle: { systemPromptForVendor: () => 'BASE' }, temperature: 0.7, maxTokens: 100,
  });
  assert.equal(out, null);
});


// ── Request budget ─────────────────────────────────────────────────────────
//
// Vendor timeouts are per-CALL. Nothing measured the request as a whole, so a
// first pass, a synthesis pass and a retry — each individually within its own
// limit — could still overrun the caller's 60s proxy. Measured live 2026-09-04:
// two 504s in six requests, in which every individual stage had in fact
// returned something usable.

test('the synthesis pass gets half of what is left, leaving room for a retry', () => {
  const r = new AIServiceRouter({});
  const startedAt = Date.now() - 5000;           // 5s already spent
  const remaining = r._remainingBudgetMs(startedAt);
  assert.ok(remaining <= 50000 && remaining > 49000, `unexpected remaining ${remaining}`);
  const req = r._buildFollowupRequest({
    messages: [], systemPrompt: 'BASE', temperature: 0.7, maxTokens: 100,
    tools: [], timeoutOverrideMs: Math.round(remaining / 2),
  });
  assert.ok(req.timeoutOverrideMs > 24000 && req.timeoutOverrideMs <= 25000,
    `unexpected synthesis budget ${req.timeoutOverrideMs}`);
});

test('an already-slow request still gets a usable floor, not a negative budget', () => {
  // Handing an adapter a 20ms budget guarantees a failure; by this point a
  // short real attempt beats none.
  const r = new AIServiceRouter({});
  assert.equal(r._remainingBudgetMs(Date.now() - 120000), 8000);
});

test('the budget is not applied when no override is passed', () => {
  const r = new AIServiceRouter({});
  const req = r._buildFollowupRequest({
    messages: [], systemPrompt: 'BASE', temperature: 0.7, maxTokens: 100, tools: [],
  });
  assert.equal('timeoutOverrideMs' in req, false);
});

test('a non-finite override is ignored rather than forwarded', () => {
  const r = new AIServiceRouter({});
  for (const bad of [NaN, Infinity, undefined, null, 'soon']) {
    const req = r._buildFollowupRequest({
      messages: [], systemPrompt: 'BASE', temperature: 0.7, maxTokens: 100,
      tools: [], timeoutOverrideMs: bad,
    });
    assert.equal('timeoutOverrideMs' in req, false, `forwarded ${JSON.stringify(bad)}`);
  }
});


// ── Token ceilings and truncation ──────────────────────────────────────────
//
// Reported 2026-09-04: `ask-ai` answers to "How do I rotate my API key?" came
// back cut mid-word — "Per your `DOTENVX-R", "the Lan-On". Not a serialization
// bug; every reply reported completion_tokens exactly 350, the lane's ceiling.
// Measured directly against MiniMax: 350 hits the cap and cuts mid-sentence,
// 800 finishes at 511, 1500 finishes at 411.

const { resolveMaxTokens } = require('../vendors/vendor-config');

test('a use-case ceiling can be raised from the environment', () => {
  const prev = process.env.AI_MAX_TOKENS_ASK_AI;
  process.env.AI_MAX_TOKENS_ASK_AI = '1234';
  try {
    assert.equal(resolveMaxTokens('ask-ai', 800), 1234);
  } finally {
    if (prev === undefined) delete process.env.AI_MAX_TOKENS_ASK_AI;
    else process.env.AI_MAX_TOKENS_ASK_AI = prev;
  }
});

test('a global ceiling applies to lanes without their own', () => {
  const prev = { g: process.env.AI_MAX_TOKENS, s: process.env.AI_MAX_TOKENS_ASK_AI };
  process.env.AI_MAX_TOKENS = '999';
  delete process.env.AI_MAX_TOKENS_ASK_AI;
  try {
    assert.equal(resolveMaxTokens('ask-ai', 800), 999);
    process.env.AI_MAX_TOKENS_ASK_AI = '111';
    assert.equal(resolveMaxTokens('ask-ai', 800), 111, 'the scoped key wins');
  } finally {
    for (const [k, v] of [['AI_MAX_TOKENS', prev.g], ['AI_MAX_TOKENS_ASK_AI', prev.s]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('a nonsense ceiling keeps the code default rather than capping at zero', () => {
  // `AI_MAX_TOKENS=0` or a typo must not silently reduce every answer to nothing.
  const prev = process.env.AI_MAX_TOKENS_ASK_AI;
  const warnings = [];
  try {
    for (const bad of ['0', '-5', 'lots', '']) {
      process.env.AI_MAX_TOKENS_ASK_AI = bad;
      assert.equal(resolveMaxTokens('ask-ai', 800, { onWarn: (m) => warnings.push(m) }), 800,
        `accepted ${JSON.stringify(bad)}`);
    }
  } finally {
    if (prev === undefined) delete process.env.AI_MAX_TOKENS_ASK_AI;
    else process.env.AI_MAX_TOKENS_ASK_AI = prev;
  }
  assert.ok(warnings.length >= 3, 'a bad override must be reported, not silently ignored');
});

test('an answer cut at the ceiling is flagged, not discarded', () => {
  // The partial answer is usually still useful; dropping it would trade a
  // truncated reply for no reply. But the caller must be able to tell.
  const r = new AIServiceRouter({});
  r.logger = { info() {}, warn() {}, error() {} };
  const out = r._noteTruncation({ response: 'half a sen' },
    { done_reason: 'length', usage: { completion_tokens: 350 } },
    { useCase: 'ask-ai', maxTokens: 350 });
  assert.equal(out.truncated, true);
  assert.equal(out.response, 'half a sen', 'the partial answer is kept');
});

test('a completed answer carries no truncation flag', () => {
  // Absent reads as complete, which is the common case.
  const r = new AIServiceRouter({});
  r.logger = { info() {}, warn() {}, error() {} };
  const out = r._noteTruncation({ response: 'done.' }, { done_reason: 'stop' },
    { useCase: 'ask-ai', maxTokens: 800 });
  assert.equal('truncated' in out, false);
});

test('the ceiling is logged so the cause is actionable', () => {
  const warnings = [];
  const r = new AIServiceRouter({});
  r.logger = { info() {}, warn: (m, meta) => warnings.push({ m, meta }), error() {} };
  r._noteTruncation({ response: 'x' }, { done_reason: 'length', usage: { completion_tokens: 350 } },
    { useCase: 'ask-ai', maxTokens: 350 });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].meta.maxTokens, 350);
  assert.equal(warnings[0].meta.useCase, 'ask-ai');
});


// ── Re-emitted tool call: one more attempt on a flattened transcript ───────
//
// Observed live 2026-10-07 on memory-analysis. Slack asked a memory question,
// memory.search ran, and the synthesis pass answered with two more
// memory.search calls — no tools offered, directive in the system prompt. The
// caller got "I could not compose a summary for this one, so here are the raw
// results" on every request that day.
//
// The replayed tool_calls turn and tool-role messages read as a tool
// conversation in progress. Restated as plain text there is nothing to continue.

const TOOL_RESULTS = [{ name: 'memory.search', payload: '{"results":[{"title":"Agent Banks","content":"paused"}]}' }];

test('flattening removes the tool round and keeps the conversation', () => {
  const messages = [
    { role: 'user', content: 'earlier question' },
    { role: 'assistant', content: 'earlier answer' },
    { role: 'user', content: 'what is the agent banks status?' },
  ];
  const flat = router._flattenToolRound(messages, TOOL_RESULTS);
  assert.deepEqual(flat.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.ok(flat.every((m) => !('tool_calls' in m) && !('tool_call_id' in m)));
  assert.ok(flat[2].content.startsWith('what is the agent banks status?'), 'the question still leads its turn');
  assert.match(flat[2].content, /memory\.search:\n\{"results"/);
  assert.match(flat[2].content, /do not request or write a tool call/i);
  assert.equal(messages[2].content, 'what is the agent banks status?', 'the caller\'s messages are not mutated');
});

test('flattening appends a turn when the last one cannot carry the results', () => {
  const structured = [{ role: 'user', content: [{ type: 'text', text: 'q' }] }];
  const flat = router._flattenToolRound(structured, TOOL_RESULTS);
  assert.equal(flat.length, 2);
  assert.equal(flat[1].role, 'user');
  assert.match(flat[1].content, /memory\.search:/);
  assert.match(router._flattenToolRound([], TOOL_RESULTS)[0].content, /memory\.search:/);
});

test('a synthesis reply is recognised as an answer or as another tool call', () => {
  const inspect = (resp) => router._inspectSynthesisReply(resp);
  const prose = inspect({ message: { role: 'assistant', content: 'Agent Banks is paused.' } });
  assert.equal(prose.reEmitted, false);
  assert.equal(prose.text, 'Agent Banks is paused.');

  const markup = inspect({ message: { role: 'assistant',
    content: '<tool_call>\n{"name": "memory.search", "arguments": {"query": "x"}}\n</tool_call>' } });
  assert.equal(markup.reEmitted, true);
  assert.deepEqual(markup.toolNames, ['memory.search']);

  const native = inspect({ message: { role: 'assistant', content: '' },
    tool_calls: [{ id: 'c1', function: { name: 'memory.get', arguments: '{"id":"1"}' } }] });
  assert.equal(native.reEmitted, true);
  assert.deepEqual(native.toolNames, ['memory.get']);
});

// The stub vendor carries no adapter, so the first synthesis attempt throws and
// is retried on the chain: call 1 is the first pass, call 2 the synthesis pass,
// call 3 the flattened retry.
function routerScripted(replies) {
  const r = new AIServiceRouter({});
  r._prefetch = { brief: async () => '' };
  r._toolLoop.executeToolCallWithRetry = async (call) => ({ name: call.name, payload: TOOL_RESULTS[0].payload });
  const calls = [];
  r._chain = {
    run: async (args) => {
      calls.push(args);
      const reply = replies[calls.length - 1];
      if (reply instanceof Error) throw reply;
      return { adapterResponse: { message: { role: 'assistant', content: reply } }, selectedVendor: { _vendorId: 'stub' } };
    },
  };
  const req = {
    headers: {}, params: {}, requestId: 'test',
    body: { messages: [{ role: 'user', content: 'what is the agent banks status?' }], use_case: 'repl-nlp' },
  };
  return { r, req, calls };
}

const CALL = '<tool_call>\n{"name": "memory.search", "arguments": {"query": "agent banks"}}\n</tool_call>';

test('a re-emitted call is retried on a flattened transcript and the answer is delivered', async () => {
  const { r, req, calls } = routerScripted([CALL, CALL, 'Agent Banks is paused.']);
  const result = await r.handleOllamaChat(req);
  assert.equal(result.response, 'Agent Banks is paused.');
  assert.equal(calls.length, 3);

  const retry = calls[2];
  assert.equal(retry.tools, undefined, 'the retry is not offered tools');
  assert.deepEqual(retry.exclude, [], 'the vendor that re-emitted may answer the retry');
  assert.deepEqual(retry.messages.map((m) => m.role), ['user']);
  assert.match(retry.messages[0].content, /Agent Banks/, 'the tool results travel as text');
});

test('a retry that re-emits again degrades to the raw results', async () => {
  const { r, req, calls } = routerScripted([CALL, CALL, CALL]);
  const result = await r.handleOllamaChat(req);
  assert.equal(calls.length, 3, 'exactly one flattened retry');
  assert.match(result.response, /could not compose a summary/i);
  assert.match(result.response, /Agent Banks/);
  assert.doesNotMatch(result.response, /tool_call/);
});

test('a retry that fails degrades to the raw results', async () => {
  const { r, req } = routerScripted([CALL, CALL, new Error('No alternative AI vendor available')]);
  const result = await r.handleOllamaChat(req);
  assert.match(result.response, /could not compose a summary/i);
  assert.match(result.response, /Agent Banks/);
});

test('an empty retry is not delivered as an answer', async () => {
  const { r, req } = routerScripted([CALL, CALL, '   ']);
  const result = await r.handleOllamaChat(req);
  assert.match(result.response, /could not compose a summary/i);
});
