'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const AIServiceRouter = require('../core/ai-service-router');
const {
  TOOL_PASSTHROUGH_USE_CASE,
  TOOL_PASSTHROUGH_ENV,
  trustedAuthIds,
  isToolPassthroughAllowed,
  assertToolPassthroughAllowed,
  assertPassthroughTools,
  toOpenAIToolCalls,
  normaliseToolTranscript,
} = require('../core/tool-passthrough');
const { assertCallerRoles } = require('../core/message-policy');
const { toChatCompletion } = require('../core/openai-compat');
const {
  USE_CASES,
  VENDOR_REGISTRY,
  resolveVendorChainForUseCase,
} = require('../vendors');
const { validateLaneConfiguration, LANES } = require('../vendors/vendor-config');

// The defect this lane fixes, observed live 2026-10-27 on dashboard-assistant:
//
//   "I can't determine that without access to the application catalogue and
//    live status tools. None were provided in this session..."
//
// That answer was correct. dashboard-assistant leads with pi, whose adapter
// passes `--no-tools` unconditionally, so the model was shown nothing. And even
// on a vendor that forwards `tools`, the router executed the calls itself and
// answered every caller-defined name with "Unsupported tool".
//
// These tests pin the two properties that make the lane real — tool-capable
// vendors only, calls returned rather than executed — plus the allowlist that
// stops it becoming an open function-calling proxy.

const withEnv = (over, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(over)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

// ── Lane registration ──────────────────────────────────────────────────────

test('tool-proxy is registered as an agent lane that never streams', () => {
  const config = USE_CASES[TOOL_PASSTHROUGH_USE_CASE];
  assert.ok(config, 'tool-proxy must exist in USE_CASES');
  assert.equal(config.lane, LANES.AGENT);
  assert.equal(config.passthrough, true);
  assert.equal(config.requiresNativeTools, true);
  assert.equal(config.streamable, false);
});

test('the chain carries only vendors that forward tools', () => {
  const chain = resolveVendorChainForUseCase(TOOL_PASSTHROUGH_USE_CASE);
  assert.ok(chain.length > 0, 'expected at least one tool-capable vendor');

  const ids = chain.map((link) => link._vendorId);
  // pi is the whole reason this lane exists; it must never be in this chain.
  assert.ok(!ids.includes('pi'), `pi must not serve tool-proxy, got ${ids.join(', ')}`);
  assert.ok(!ids.includes('hermes'));
  assert.ok(!ids.includes('supabase-edge'));
});

test('runtime env overrides cannot inject a non-tool vendor', () => {
  withEnv({ AI_VENDOR_ORDER_TOOL_PROXY: 'pi,minimax' }, () => {
    const result = validateLaneConfiguration({
      useCases: USE_CASES,
      vendorRegistry: VENDOR_REGISTRY,
    });
    assert.equal(result.valid, false);
    const codes = result.violations.map((v) => v.code);
    assert.ok(
      codes.includes('use-case-vendor-cannot-call-tools'),
      `expected the tool-vendor violation, got ${codes.join(', ')}`,
    );
  });
});

test('a pass-through lane may not be streamable', () => {
  const result = validateLaneConfiguration({
    useCases: {
      'bad-passthrough': {
        lane: LANES.AGENT,
        maxTokens: 2000,
        requiresNativeTools: true,
        passthrough: true,
        streamable: true,
        vendorOrder: ['openai'],
      },
    },
  });
  const codes = result.violations.map((v) => v.code);
  assert.ok(codes.includes('passthrough-lane-streamable'), codes.join(', '));
});

test('every vendor must declare whether it can be given tools', () => {
  const result = validateLaneConfiguration({
    useCases: {},
    vendorRegistry: {
      mystery: { status: 'active', lane: LANES.COMPLETION, adapter: {}, models: {} },
    },
  });
  const codes = result.violations.map((v) => v.code);
  assert.ok(codes.includes('registry-vendor-tools-undeclared'), codes.join(', '));
});

// ── The allowlist ──────────────────────────────────────────────────────────

test('the gate is fail-closed when the allowlist is unset', () => {
  withEnv({ [TOOL_PASSTHROUGH_ENV]: undefined }, () => {
    assert.equal(trustedAuthIds().size, 0);
    assert.equal(isToolPassthroughAllowed('auth-1'), false);
    assert.throws(
      () => assertToolPassthroughAllowed({ uai: { authId: 'auth-1' } }),
      (err) => err.status === 403 && err.code === 'tool_passthrough_not_authorized',
    );
  });
});

test('an unlisted or absent auth id is refused', () => {
  withEnv({ [TOOL_PASSTHROUGH_ENV]: 'auth-1, auth-2' }, () => {
    assert.equal(isToolPassthroughAllowed('auth-1'), true);
    assert.equal(isToolPassthroughAllowed(' auth-2 '), true);
    assert.equal(isToolPassthroughAllowed('auth-3'), false);
    // Anonymous callers never reach this lane, whatever the list says.
    assert.equal(isToolPassthroughAllowed(undefined), false);
    assert.equal(isToolPassthroughAllowed(''), false);
  });
});

test('the lane requires caller-supplied tools', () => {
  assert.throws(
    () => assertPassthroughTools({}),
    (err) => err.status === 400 && err.code === 'tools_required',
  );
  assert.throws(
    () => assertPassthroughTools({ tools: [] }),
    (err) => err.code === 'tools_required',
  );
  assert.doesNotThrow(() => assertPassthroughTools({
    tools: [{ type: 'function', function: { name: 'apps.list' } }],
  }));
});

test('tool-role messages are accepted for the follow-up turn', () => {
  // The caller sends the tool results back as role:"tool"; the message policy
  // only reserves system/developer, so nothing rejects them.
  assert.doesNotThrow(() => assertCallerRoles([
    { role: 'user', content: 'list the apps' },
    { role: 'tool', tool_call_id: 'call_1', content: '[]' },
  ]));
});

// ── Response shape ─────────────────────────────────────────────────────────

test('calls are normalised to the OpenAI shape with stable ids', () => {
  const calls = toOpenAIToolCalls([
    { id: 'call_abc', name: 'apps.list', arguments: { limit: 5 } },
    { id: '', name: 'apps.status', arguments: '{"id":"x"}' },
  ]);

  assert.deepEqual(calls, [
    {
      id: 'call_abc',
      type: 'function',
      function: { name: 'apps.list', arguments: '{"limit":5}' },
    },
    {
      id: 'call_1',
      type: 'function',
      function: { name: 'apps.status', arguments: '{"id":"x"}' },
    },
  ]);
});

test('the OpenAI facade exposes the returned calls as tool_calls', () => {
  const completion = toChatCompletion({
    response: '',
    tool_calls: [{
      id: 'call_abc',
      type: 'function',
      function: { name: 'apps.list', arguments: '{}' },
    }],
  }, { id: 'chatcmpl-1', created: 0 });

  assert.equal(completion.choices[0].finish_reason, 'tool_calls');
  assert.equal(completion.choices[0].message.tool_calls[0].function.name, 'apps.list');
});

test('a replayed assistant turn is normalised for the next round', () => {
  // Shape the dashboard sent before this lane existed: no `type`, and the
  // signed arguments still an object. OpenAI's schema requires both.
  const messages = normaliseToolTranscript([
    { role: 'user', content: 'list the apps' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_abc', function: { name: 'apps.list', arguments: { limit: 5 } } }],
    },
    { role: 'tool', tool_call_id: 'call_abc', content: '[]' },
  ]);

  assert.deepEqual(messages[1].tool_calls, [{
    id: 'call_abc',
    type: 'function',
    function: { name: 'apps.list', arguments: '{"limit":5}' },
  }]);
  // Untouched turns stay the same objects.
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[2].role, 'tool');
});

test('an empty tool_calls array is dropped, not forwarded', () => {
  const [turn] = normaliseToolTranscript([
    { role: 'assistant', content: 'Nothing to call.', tool_calls: [] },
  ]);
  assert.equal('tool_calls' in turn, false);
  assert.equal(turn.content, 'Nothing to call.');
});

// ── End-to-end through handleOllamaChat ────────────────────────────────────

function harness(adapterResponse, { executed, messages } = {}) {
  const router = new AIServiceRouter({});
  const chain = resolveVendorChainForUseCase(TOOL_PASSTHROUGH_USE_CASE);

  router._prefetch = {
    calls: 0,
    async brief() {
      this.calls += 1;
      return '';
    },
  };
  router._chain = {
    calls: 0,
    async run() {
      this.calls += 1;
      return { adapterResponse, selectedVendor: chain[0] };
    },
  };
  // Any router-side execution is a failure of the lane's contract.
  router._toolLoop.executeToolCalls = async () => {
    if (executed) executed.push('executeToolCalls');
    throw new Error('the router must not execute caller-owned tools');
  };

  const tools = [{
    type: 'function',
    function: { name: 'apps.list', description: 'List apps', parameters: { type: 'object', properties: {} } },
  }];

  const req = {
    body: {
      use_case: TOOL_PASSTHROUGH_USE_CASE,
      messages: messages || [{ role: 'user', content: 'which apps are up?' }],
      tools,
    },
    headers: {},
    uai: { authId: 'auth-allowed', organizationId: 'org-1' },
    requestId: 'req-test',
  };

  return { router, req, tools };
}

test('a tool call is returned to the caller, not executed', async () => {
  const executed = [];
  const adapterResponse = {
    message: { role: 'assistant', content: '' },
    done_reason: 'stop',
    tool_calls: [{
      id: 'call_abc',
      type: 'function',
      function: { name: 'apps.list', arguments: '{"limit":5}' },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };

  const { router, req } = harness(adapterResponse, { executed });

  await withEnv({ [TOOL_PASSTHROUGH_ENV]: 'auth-allowed' }, async () => {
    const result = await router.handleOllamaChat(req);

    assert.deepEqual(result.tool_calls, [{
      id: 'call_abc',
      type: 'function',
      function: { name: 'apps.list', arguments: '{"limit":5}' },
    }]);
    assert.equal(result.response, '');
    assert.deepEqual(result.usage, adapterResponse.usage);
    assert.deepEqual(executed, []);
    // One vendor pass: no synthesis round, because there is nothing to
    // synthesise until the caller sends the results back.
    assert.equal(router._chain.calls, 1);
    // No memory brief: the caller's transcript and tool results are the
    // context, and this lane is several requests per user turn.
    assert.equal(router._prefetch.calls, 0);
  });
});

test('the vendor is handed the caller tools, not the router defaults', async () => {
  const adapterResponse = {
    message: { role: 'assistant', content: 'Nothing to do.' },
    done_reason: 'stop',
    tool_calls: [],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };

  const { router, req, tools } = harness(adapterResponse);
  let seen;
  const originalRun = router._chain.run;
  router._chain.run = async (payload) => {
    seen = payload;
    return originalRun.call(router._chain, payload);
  };

  await withEnv({ [TOOL_PASSTHROUGH_ENV]: 'auth-allowed' }, async () => {
    const result = await router.handleOllamaChat(req);
    assert.equal(result.response, 'Nothing to do.');
    assert.equal(result.tool_calls, undefined);
  });

  assert.deepEqual(seen.tools, tools);
});

test('a follow-up round reaches the vendor with a valid tool transcript', async () => {
  const adapterResponse = {
    message: { role: 'assistant', content: 'Both apps are up.' },
    done_reason: 'stop',
    tool_calls: [],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };

  const { router, req } = harness(adapterResponse, {
    messages: [
      { role: 'user', content: 'which apps are up?' },
      {
        // The sloppy replay shape: no `type`, arguments as an object.
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_abc', function: { name: 'apps.list', arguments: {} } }],
      },
      { role: 'tool', tool_call_id: 'call_abc', content: '[{"name":"console","status":"up"}]' },
    ],
  });

  let seen;
  const originalRun = router._chain.run;
  router._chain.run = async (payload) => {
    seen = payload;
    return originalRun.call(router._chain, payload);
  };

  await withEnv({ [TOOL_PASSTHROUGH_ENV]: 'auth-allowed' }, async () => {
    const result = await router.handleOllamaChat(req);
    assert.equal(result.response, 'Both apps are up.');
  });

  const replayed = seen.messages.find((message) => message.role === 'assistant');
  assert.deepEqual(replayed.tool_calls, [{
    id: 'call_abc',
    type: 'function',
    function: { name: 'apps.list', arguments: '{}' },
  }]);
  assert.ok(seen.messages.some((message) => message.role === 'tool'));
});

test('the response names the lane the router actually served', () => {
  // A caller that asked for a lane needs to know it got it: an unrecognised
  // `use_case` falls back to the default lane, so a router that is too old to
  // know a lane answers 200 with a different lane's behaviour and no error.
  // That silent substitution is how the tool lane looked like a working
  // assistant while never being served (observed 2026-10-27).
  const router = new AIServiceRouter({});
  const response = router.addOnasisBranding({ response: 'ok' }, {
    service: 'ai-chat',
    user_auth_id: 'auth-1',
    processing_time: 12,
    use_case: TOOL_PASSTHROUGH_USE_CASE,
  });

  assert.equal(response.onasis_metadata.use_case, TOOL_PASSTHROUGH_USE_CASE);
});

test('a request with no caller tools is refused before any vendor call', async () => {
  const { router, req } = harness({});
  delete req.body.tools;

  await withEnv({ [TOOL_PASSTHROUGH_ENV]: 'auth-allowed' }, async () => {
    await assert.rejects(
      () => router.handleOllamaChat(req),
      (err) => err.status === 400 && err.code === 'tools_required',
    );
  });

  assert.equal(router._chain.calls, 0);
});

test('the lane refuses an unlisted credential before touching a vendor', async () => {
  const { router, req } = harness({});

  await withEnv({ [TOOL_PASSTHROUGH_ENV]: 'someone-else' }, async () => {
    await assert.rejects(
      () => router.handleOllamaChat(req),
      (err) => err.status === 403 && err.code === 'tool_passthrough_not_authorized',
    );
  });

  assert.equal(router._chain.calls, 0);
});
