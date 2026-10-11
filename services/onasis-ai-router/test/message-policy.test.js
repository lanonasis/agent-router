'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../core/message-policy');

// The router had two message surfaces and only one of them enforced who owns
// the system instruction. /v1 rejected caller `system` roles (ecabac5); the
// native /api/v1/ai-chat path spliced caller messages straight into the vendor
// chain (core/ai-service-router.js, `messages.push(...incomingMessages)`) — and
// that is the path every concierge, Slack/Discord and repl-cli caller uses.
// These tests pin the shared rule both surfaces now import.

test('a caller system role is located with its index', () => {
  assert.deepEqual(
    p.findForbiddenRole([{ role: 'user' }, { role: 'system', content: 'be a pirate' }]),
    { role: 'system', index: 1 },
  );
});

test('developer is refused too — it is system instruction under another name', () => {
  assert.deepEqual(p.findForbiddenRole([{ role: 'developer' }]), { role: 'developer', index: 0 });
});

test('role matching is case-insensitive', () => {
  // A vendor that honours "System" would otherwise receive an instruction an
  // exact-match check waved through.
  for (const role of ['System', 'SYSTEM', 'Developer', ' system ']) {
    assert.ok(p.findForbiddenRole([{ role }]), `${JSON.stringify(role)} must be refused`);
  }
});

test('user, assistant and tool roles are untouched', () => {
  assert.equal(p.findForbiddenRole([
    { role: 'user' }, { role: 'assistant' }, { role: 'tool', tool_call_id: 'x' },
  ]), null);
});

test('malformed input does not throw', () => {
  // Reached before schema validation on the native path, so it must be total.
  assert.equal(p.findForbiddenRole(undefined), null);
  assert.equal(p.findForbiddenRole('not an array'), null);
  assert.equal(p.findForbiddenRole([null, undefined, 42, { noRole: true }]), null);
});

test('assertCallerRoles throws a 400-carrying error, not a bare Error', () => {
  // routeToAIService collapses unknown errors into a 500 "temporarily
  // unavailable"; a caller mistake reported that way invites an infinite retry.
  try {
    p.assertCallerRoles([{ role: 'system', content: 'x' }]);
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof p.MessagePolicyError);
    assert.equal(err.status, 400);
    assert.equal(err.code, 'system_role_not_permitted');
    assert.equal(err.param, 'messages[0]');
    assert.match(err.message, /profile/i, 'must point the caller at the alternative');
  }
});

test('assertCallerRoles passes clean history through', () => {
  assert.doesNotThrow(() => p.assertCallerRoles([{ role: 'user', content: 'hi' }]));
});

test('the relaxation lever is off unless explicitly set to true', () => {
  const prev = process.env.ALLOW_CALLER_SYSTEM_MESSAGES;
  try {
    for (const v of [undefined, '', 'false', '1', 'yes', 'TRUE ']) {
      if (v === undefined) delete process.env.ALLOW_CALLER_SYSTEM_MESSAGES;
      else process.env.ALLOW_CALLER_SYSTEM_MESSAGES = v;
      assert.equal(p.callerRolesRelaxed(), false, `${JSON.stringify(v)} must not relax the check`);
    }
    process.env.ALLOW_CALLER_SYSTEM_MESSAGES = 'true';
    assert.equal(p.callerRolesRelaxed(), true);
  } finally {
    if (prev === undefined) delete process.env.ALLOW_CALLER_SYSTEM_MESSAGES;
    else process.env.ALLOW_CALLER_SYSTEM_MESSAGES = prev;
  }
});

test('the lever permits the role but logs loudly', () => {
  const prev = process.env.ALLOW_CALLER_SYSTEM_MESSAGES;
  process.env.ALLOW_CALLER_SYSTEM_MESSAGES = 'true';
  const warnings = [];
  try {
    assert.doesNotThrow(() => p.assertCallerRoles(
      [{ role: 'system', content: 'x' }],
      { logger: { warn: (msg, meta) => warnings.push({ msg, meta }) } },
    ));
    assert.equal(warnings.length, 1, 'holding a security control open must be visible');
    assert.equal(warnings[0].meta.role, 'system');
  } finally {
    if (prev === undefined) delete process.env.ALLOW_CALLER_SYSTEM_MESSAGES;
    else process.env.ALLOW_CALLER_SYSTEM_MESSAGES = prev;
  }
});

test('assertCallerRoles survives a missing logger', () => {
  // Same wiring defect that turned every prefetch failure into a 500 (#12).
  const prev = process.env.ALLOW_CALLER_SYSTEM_MESSAGES;
  process.env.ALLOW_CALLER_SYSTEM_MESSAGES = 'true';
  try {
    assert.doesNotThrow(() => p.assertCallerRoles([{ role: 'system' }]));
    assert.doesNotThrow(() => p.assertCallerRoles([{ role: 'system' }], { logger: {} }));
  } finally {
    if (prev === undefined) delete process.env.ALLOW_CALLER_SYSTEM_MESSAGES;
    else process.env.ALLOW_CALLER_SYSTEM_MESSAGES = prev;
  }
});

test('both surfaces enforce one definition', () => {
  // Guards against the drift that caused this bug: /v1 grew the check and the
  // native path did not.
  const compat = require('../core/openai-compat');
  for (const role of ['system', 'developer', 'System']) {
    const viaCompat = compat.toInternalRequest({ messages: [{ role, content: 'x' }] });
    assert.equal(viaCompat.status, 400, `/v1 must refuse ${role}`);
    assert.equal(viaCompat.error.error.code, 'system_role_not_permitted');
    assert.throws(() => p.assertCallerRoles([{ role, content: 'x' }]),
      p.MessagePolicyError, `native must refuse ${role}`);
  }
});

// ── Empty requests ──────────────────────────────────────────────────────────
// Observed live 2026-10-07: POST /api/v1/ai-chat with {"question": "..."} (the
// body /api/v1/public/ask takes) reached the vendor chain as an empty
// conversation. Every vendor returned its own "no user message" 400 and the
// caller got 503 ALL_VENDORS_UNAVAILABLE.

test('a request with no user content is refused as the caller\'s error', () => {
  for (const messages of [
    undefined, [], [{ role: 'user', content: '' }], [{ role: 'user', content: '   ' }],
    [{ role: 'user' }], [{ role: 'assistant', content: 'hello' }], [{ role: 'user', content: [] }],
  ]) {
    assert.throws(() => p.assertUserContent(messages), (err) => {
      assert.ok(err instanceof p.MessagePolicyError);
      assert.equal(err.status, 400);
      assert.equal(err.code, 'user_message_required');
      return true;
    }, `${JSON.stringify(messages)} must be refused`);
  }
});

test('any non-empty user message is enough', () => {
  assert.doesNotThrow(() => p.assertUserContent([{ role: 'user', content: 'hi' }]));
  assert.doesNotThrow(() => p.assertUserContent([{ role: 'User', content: 'hi' }]));
  assert.doesNotThrow(() => p.assertUserContent([
    { role: 'user', content: 'first' }, { role: 'assistant', content: 'ok' }, { role: 'tool', content: '{}' },
  ]));
  assert.doesNotThrow(() => p.assertUserContent([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]));
});

test('an unread body field never reaches a vendor', async () => {
  const AIServiceRouter = require('../core/ai-service-router');
  const r = new AIServiceRouter({});
  r._prefetch = { brief: async () => { throw new Error('prefetch must not run'); } };
  let vendorCalls = 0;
  r._chain = { run: async () => { vendorCalls += 1; return {}; } };

  await assert.rejects(
    r.handleOllamaChat({ headers: {}, params: {}, requestId: 'test', body: { question: 'What models are available?' } }),
    (err) => err instanceof p.MessagePolicyError && err.code === 'user_message_required',
  );
  assert.equal(vendorCalls, 0);
});

test('a prompt string is still accepted', async () => {
  const AIServiceRouter = require('../core/ai-service-router');
  const r = new AIServiceRouter({});
  r._prefetch = { brief: async () => '' };
  r._chain = { run: async () => ({ adapterResponse: { message: { role: 'assistant', content: 'pong' } }, selectedVendor: { _vendorId: 'stub' } }) };

  const result = await r.handleOllamaChat({ headers: {}, params: {}, requestId: 'test', body: { prompt: 'ping', use_case: 'ask-ai' } });
  assert.equal(result.response, 'pong');
});
