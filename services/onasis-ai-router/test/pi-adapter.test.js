'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pi = require('../vendors/pi/adapter');

// Pi is the only vendor here that is a local process rather than an HTTP
// endpoint, and it ships read/bash/edit/write tools. It runs as the router, on
// the router's host. Most of what follows is not tidiness — it is the
// difference between a vendor and a remote shell.

const args = (req = {}, model = 'MiniMax-M3') => pi._buildArgs(req, model);
const has = (list, flag) => list.includes(flag);

test('tools are disabled on every invocation', () => {
  // The router runs its own tool loop against an allowlist (core/tool-loop.js).
  // That is the only tool path this service has, and it is not this one.
  assert.ok(has(args(), '--no-tools'));
});

test('tools cannot be re-enabled through the request', () => {
  // A caller-supplied field must never be able to hand a model bash on this box.
  const built = args({ tools: [{ type: 'function' }], piTools: 'bash,edit', noTools: false });
  assert.ok(has(built, '--no-tools'));
  assert.ok(!built.some((a) => String(a).includes('bash')));
});

test('extensions, skills and prompt templates are all off', () => {
  // Measured on this host: a bare `pi -p` took 89 SECONDS and returned nothing,
  // because it loads the whole extension stack per invocation. With these it
  // takes ~1.6s. It is also third-party code running inside a request path.
  const built = args();
  for (const flag of ['--no-extensions', '--no-skills', '--no-prompt-templates']) {
    assert.ok(has(built, flag), `missing ${flag}`);
  }
});

test('repository context files are not read', () => {
  // Pi discovers AGENTS.md and CLAUDE.md from its cwd. This router's own repo
  // instructions have no business shaping a caller's answer.
  assert.ok(has(args(), '--no-context-files'));
});

test('no session state is kept between requests', () => {
  // Each request is independent — the same contract the rest of the router
  // keeps, and the reason the old "ask me to summarise" reply was impossible.
  assert.ok(has(args(), '--no-session'));
});

test('provider and model are always stated explicitly', () => {
  // Pi's configured default on this host is `hetz`, the credential that has
  // been returning 401, at thinking level "high" — the exact combination that
  // produced truncated answers. Falling through to it would reintroduce both.
  const built = args({}, 'MiniMax-M3');
  assert.ok(has(built, '--provider'));
  assert.ok(has(built, '--model'));
  assert.equal(built[built.indexOf('--model') + 1], 'MiniMax-M3');
});

test('thinking is off unless a lane asks otherwise', () => {
  // The router asks for an answer of a given length. Reasoning that consumes
  // that budget without appearing in the answer is the overhead Pi is here to
  // remove.
  assert.equal(args()[args().indexOf('--thinking') + 1], 'off');
  const raised = args({ piThinking: 'medium' });
  assert.equal(raised[raised.indexOf('--thinking') + 1], 'medium');
});

test('a missing model is refused rather than defaulted', async () => {
  await assert.rejects(
    () => pi.chat({ messages: [{ role: 'user', content: 'hi' }] }, ''),
    /refusing to fall back to Pi defaults/,
  );
});

test('an empty conversation is refused before spawning anything', async () => {
  await assert.rejects(
    () => pi.chat({ messages: [] }, 'MiniMax-M3'),
    /no user content/,
  );
});

// ── conversation flattening ────────────────────────────────────────────────

test('system and developer turns never enter the prompt body', () => {
  // They go to --system-prompt instead, so the service's own instruction stays
  // distinguishable from conversation content — the same rule
  // core/message-policy.js enforces everywhere else.
  const rendered = pi._renderConversation([
    { role: 'system', content: 'SECRET SYSTEM RULE' },
    { role: 'developer', content: 'DEVELOPER RULE' },
    { role: 'user', content: 'hello' },
  ]);
  assert.doesNotMatch(rendered, /SECRET SYSTEM RULE/);
  assert.doesNotMatch(rendered, /DEVELOPER RULE/);
  assert.match(rendered, /User: hello/);
});

test('assistant and tool turns are labelled, not dropped', () => {
  const rendered = pi._renderConversation([
    { role: 'user', content: 'find it' },
    { role: 'assistant', content: 'looking' },
    { role: 'tool', tool_name: 'memory.search', content: '{"data":[]}' },
  ]);
  assert.match(rendered, /User: find it/);
  assert.match(rendered, /Assistant: looking/);
  assert.match(rendered, /Tool result \(memory\.search\)/);
});

test('malformed turns are skipped rather than crashing the render', () => {
  const rendered = pi._renderConversation([
    null, 'not an object', { role: 'user' }, { content: 'no role' },
    { role: 'user', content: 'real' },
  ]);
  assert.match(rendered, /real/);
});

// ── stream parsing ─────────────────────────────────────────────────────────

const endEvent = (over = {}) => JSON.stringify({
  type: 'message_end',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hi!' }],
    usage: { input: 142, output: 2, totalTokens: 514 },
    stopReason: 'stop',
    rawStopReason: 'end_turn',
    ...over,
  },
});

test('final content, usage and stop reason are taken from the terminal event', () => {
  const parsed = pi._parsePiStream(
    '{"type":"agent_start"}\n'
    + '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"H"}}\n'
    + `${endEvent()}\n`,
  );
  assert.equal(parsed.content, 'Hi!');
  assert.equal(parsed.usage.input, 142);
  assert.equal(parsed.stopReason, 'stop');
});

test('deltas are ignored rather than reassembled', () => {
  // Reassembling risks disagreeing with what Pi itself considers final.
  const parsed = pi._parsePiStream(
    '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"WRONG"}}\n',
  );
  assert.equal(parsed.content, '');
});

test('a partial trailing line from a killed process does not throw', () => {
  const parsed = pi._parsePiStream(`${endEvent()}\n{"type":"message_upda`);
  assert.equal(parsed.content, 'Hi!');
});

test('a truncated completion maps onto the shared done_reason contract', () => {
  // So core/ai-service-router.js flags it the same way it does for every other
  // vendor, rather than Pi being a silent exception.
  assert.equal(pi._mapStopReason('length', 'max_tokens'), 'length');
  assert.equal(pi._mapStopReason('stop', 'max_tokens'), 'length');
  assert.equal(pi._mapStopReason('stop', 'end_turn'), 'stop');
  assert.equal(pi._mapStopReason(undefined, undefined), 'stop');
});

test('the system prompt is passed as one argument, not interpolated', () => {
  // spawn() is called with an argument array and shell:false, so a prompt
  // containing shell metacharacters is inert.
  const evil = 'Be terse. $(touch /tmp/pwned) `id` && rm -rf /';
  const built = args({ systemPrompt: evil });
  assert.equal(built[built.indexOf('--system-prompt') + 1], evil);
});
