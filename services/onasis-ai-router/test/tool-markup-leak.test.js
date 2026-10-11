'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { extractInTextToolCalls, stripToolMarkup } = require('../vendors/_shared/tool-markup');
const { sanitizeVendorResponse } = require('../vendors');
const AIServiceRouter = require('../core/ai-service-router');
const { ToolLoop } = require('../core/tool-loop');

// Observed live 2026-09-26, use_case repl-nlp, HTTP 200. The router offered only
// memory.search / memory.get / memory.write; the client received:
//
//   ...Let me first inspect what's available...]<]Onasis[>[<tool_call>
//   {"name": "bash", "arguments": {...
//
// `]<]…[>[` is a vendor chat-template delimiter; the `Onasis` inside it is the
// persona sanitiser renaming the vendor name the token carried. The raw vendor
// text therefore had a vendor name there — reconstructed below with the brand
// name the blocklist rewrites.

const VENDOR_NAME = 'MiniMax';
const LIVE_RAW = `I can help with that. Let me first inspect what's available...]<]${VENDOR_NAME}[>[<tool_call>\n`
  + '{"name": "bash", "arguments": {"command": "ls -la ~/projects && cat package.json';
const LIVE_AS_DELIVERED = "I can help with that. Let me first inspect what's available...]<]Onasis[>[<tool_call>\n"
  + '{"name": "bash", "arguments": {"command": "ls -la';

const MEMORY_TOOLS = ['memory.search', 'memory.get', 'memory.write']
  .map((name) => ({ type: 'function', function: { name, parameters: { type: 'object' } } }));

const LEAK_PATTERNS = [/<\/?[\w:-]*tool_call/i, /\]<\]/, /\[>\[/, /"name"\s*:\s*"bash"/, /<invoke/i, /<\|/];
const assertNoMarkup = (text, label) => {
  for (const re of LEAK_PATTERNS) assert.doesNotMatch(String(text), re, `${label}: leaked ${re}`);
};

// ── Parser ───────────────────────────────────────────────────────────────────

test('the exact live shape: markup and template token removed, prose kept', () => {
  const out = extractInTextToolCalls(LIVE_RAW);
  assert.equal(out.found, true);
  assert.equal(out.text, "I can help with that. Let me first inspect what's available...");
  assert.deepEqual(out.calls.map((c) => [c.name, c.complete]), [['bash', false]],
    'a truncated call is recovered by name but marked incomplete');
});

test('the shape as it reached the client (already persona-rewritten) is also cleaned', () => {
  const out = extractInTextToolCalls(LIVE_AS_DELIVERED);
  assertNoMarkup(out.text, 'delivered shape');
  assert.match(out.text, /Let me first inspect/);
});

test('a complete <tool_call> JSON block is parsed into a structured call', () => {
  const out = extractInTextToolCalls(
    'Checking.\n<tool_call>\n{"name": "memory.search", "arguments": {"query": "agent banks"}}\n</tool_call>');
  assert.equal(out.text, 'Checking.');
  assert.deepEqual(out.calls, [{ id: '', name: 'memory.search', arguments: { query: 'agent banks' }, complete: true }]);
});

test('vendor-namespaced XML invoke form is parsed', () => {
  const out = extractInTextToolCalls(
    '<minimax:tool_call>\n<invoke name="memory.get">\n<parameter name="id">abc-123</parameter>\n'
    + '<parameter name="limit">5</parameter>\n</invoke>\n</minimax:tool_call>');
  assert.equal(out.text, '');
  assert.deepEqual(out.calls, [{ id: '', name: 'memory.get', arguments: { id: 'abc-123', limit: 5 }, complete: true }]);
});

test('<function=name> form is parsed', () => {
  const out = extractInTextToolCalls('<function=memory.search>\n<parameter=query>\nq\n</parameter>\n</function>');
  assert.deepEqual(out.calls.map((c) => [c.name, c.arguments]), [['memory.search', { query: 'q' }]]);
  assert.equal(out.text, '');
});

test('template control tokens are removed on their own', () => {
  for (const [input, expected] of [
    ['Hello]~b]ai there', 'Helloai there'],
    ['Answer<|im_end|>', 'Answer'],
    ['A]<]start of name[>[B', 'AB'],
    ['Done[e~[', 'Done'],
  ]) {
    assert.equal(stripToolMarkup(input), expected, JSON.stringify(input));
  }
});

test('prose that merely mentions the syntax is left alone', () => {
  for (const text of [
    'Wrap each call in a <tool_call> tag, then close it.',
    'The model emits <tool_call> blocks when it has no native channel.',
    '```\n<tool_call>{"name":"x","arguments":{}}</tool_call>\n```',
    'I ran memory.search and found 3 results.',
  ]) {
    const out = extractInTextToolCalls(text);
    assert.equal(out.found, false, text);
    assert.equal(out.text, text);
  }
});

test('non-strings are passed through', () => {
  for (const v of [undefined, null, '', 42]) {
    assert.deepEqual(extractInTextToolCalls(v).calls, []);
  }
});

// ── Last-line guard: sanitizeVendorResponse ─────────────────────────────────

test('sanitizeVendorResponse strips the live shape before the persona rewrite', () => {
  const clean = sanitizeVendorResponse({ response: LIVE_RAW }, 'repl-nlp');
  assertNoMarkup(clean.response, 'sanitised');
  assert.equal(clean.response, "I can help with that. Let me first inspect what's available...");
  assert.doesNotMatch(clean.response, new RegExp(VENDOR_NAME, 'i'));
});

test('the persona sanitiser is intact: vendor names are still rewritten', () => {
  const clean = sanitizeVendorResponse({ response: 'I am MiniMax, running inside OpenClaw.' }, 'ask-ai');
  assert.doesNotMatch(clean.response, /MiniMax|OpenClaw/);
});

// ── Router first pass ────────────────────────────────────────────────────────

function routerWith(adapterResponse, { tools } = {}) {
  const r = new AIServiceRouter({});
  r._prefetch = { brief: async () => '' };
  const executed = [];
  r._toolLoop.executeToolCallWithRetry = async (call) => {
    executed.push(call.name);
    return { name: call.name, payload: JSON.stringify({ results: [{ id: 'm1', content: 'note' }] }) };
  };
  const calls = [];
  r._chain = {
    run: async (args) => {
      calls.push(args);
      // First pass returns the scripted response; any follow-up returns prose.
      return calls.length === 1
        ? { adapterResponse, selectedVendor: { _vendorId: 'stub' } }
        : { adapterResponse: { message: { role: 'assistant', content: 'Here is what I found.' } },
            selectedVendor: { _vendorId: 'stub' } };
    },
  };
  const req = {
    headers: {}, params: {}, requestId: 'test',
    body: { messages: [{ role: 'user', content: 'what projects do I have?' }], use_case: 'repl-nlp',
      ...(tools ? { tools } : {}) },
  };
  return { r, req, executed, calls };
}

test('repl-nlp: the live leaked answer reaches the client clean and nothing is executed', async () => {
  const { r, req, executed, calls } = routerWith({ message: { role: 'assistant', content: LIVE_RAW } });
  const result = await r.handleOllamaChat(req);
  const delivered = sanitizeVendorResponse(result, 'repl-nlp');
  assertNoMarkup(delivered.response, 'delivered');
  assert.equal(delivered.response, "I can help with that. Let me first inspect what's available...");
  assert.deepEqual(executed, [], 'a tool that was never offered must never run');
  assert.equal(calls.length, 1, 'no follow-up pass for a dropped call');
});

test('a COMPLETE in-text call to a never-offered tool is dropped, not executed', async () => {
  const { r, req, executed } = routerWith({ message: { role: 'assistant',
    content: 'One moment.\n<tool_call>\n{"name": "bash", "arguments": {"command": "rm -rf /"}}\n</tool_call>' } });
  const result = await r.handleOllamaChat(req);
  assert.deepEqual(executed, []);
  assert.equal(result.response, 'One moment.');
});

test('an answer that was ONLY markup gets a plain fallback, not an empty 200', async () => {
  const { r, req, executed } = routerWith({ message: { role: 'assistant',
    content: '<tool_call>\n{"name": "bash", "arguments": {"command": "ls"}}\n</tool_call>' } });
  const result = await r.handleOllamaChat(req);
  assert.deepEqual(executed, []);
  assert.ok(result.response.length > 0);
  assertNoMarkup(result.response, 'fallback');
});

test('an in-text call to an OFFERED tool is parsed and executed as a structured call', async () => {
  const { r, req, executed, calls } = routerWith({ message: { role: 'assistant',
    content: 'Let me check.\n<tool_call>\n{"name": "memory.search", "arguments": {"query": "projects"}}\n</tool_call>' } });
  const result = await r.handleOllamaChat(req);
  assert.deepEqual(executed, ['memory.search']);
  assert.equal(calls.length, 2, 'the follow-up synthesis pass ran');
  assert.equal(result.response, 'Here is what I found.');
  // The assistant turn replayed to the vendor carries no raw markup either.
  const replayed = calls[1].messages.find((m) => m.role === 'assistant');
  assert.doesNotMatch(String(replayed?.content), /<tool_call>/);
});

test('a truncated call to an offered tool is not executed with half its arguments', async () => {
  const { r, req, executed } = routerWith({ message: { role: 'assistant',
    content: 'Searching…<tool_call>\n{"name": "memory.search", "arguments": {"query": "proj' } });
  const result = await r.handleOllamaChat(req);
  assert.deepEqual(executed, []);
  assertNoMarkup(result.response, 'truncated');
});

test('a native tool call for a tool that was not offered is dropped too', async () => {
  const { r, req, executed } = routerWith({
    message: { role: 'assistant', content: 'Sure.' },
    tool_calls: [{ id: 'c1', function: { name: 'bash', arguments: '{"command":"ls"}' } }],
  });
  const result = await r.handleOllamaChat(req);
  assert.deepEqual(executed, []);
  assert.equal(result.response, 'Sure.');
});

test('a bare-JSON call to a tool that was not offered is dropped and its JSON not echoed', async () => {
  const { r, req, executed } = routerWith({ message: { role: 'assistant',
    content: 'Running this: {"name": "bash", "arguments": {"command": "ls"}}' } });
  const result = await r.handleOllamaChat(req);
  assert.deepEqual(executed, []);
  assert.equal(result.response, 'Running this:');
});

test('follow-up pass that re-emits markup is suppressed, not delivered', async () => {
  const r = new AIServiceRouter({});
  r._prefetch = { brief: async () => '' };
  r._toolLoop.executeToolCallWithRetry = async (call) => ({ name: call.name, payload: '{"results":[]}' });
  let n = 0;
  r._chain = {
    run: async () => {
      n += 1;
      const content = n === 1
        ? '<tool_call>\n{"name": "memory.search", "arguments": {"query": "x"}}\n</tool_call>'
        : `Let me look deeper]<]${VENDOR_NAME}[>[<tool_call>\n{"name": "memory.get", "arguments": {"id": "`;
      return { adapterResponse: { message: { role: 'assistant', content } }, selectedVendor: { _vendorId: 'stub' } };
    },
  };
  const result = await r.handleOllamaChat({
    headers: {}, params: {}, requestId: 't',
    body: { messages: [{ role: 'user', content: 'q' }], use_case: 'repl-nlp' },
  });
  assertNoMarkup(sanitizeVendorResponse(result, 'repl-nlp').response, 'follow-up');
});

// ── Executor second line ─────────────────────────────────────────────────────

test('executeToolCall refuses memory.search when it was not offered', async () => {
  const tl = new ToolLoop({ logger: { info() {}, warn() {}, error() {} } });
  let fetched = false;
  tl.toolMemorySearch = async () => { fetched = true; return '{}'; };
  const out = await tl.executeToolCall({ name: 'memory.search', arguments: { query: 'x' } }, {}, [], 'ask-ai');
  assert.equal(fetched, false);
  assert.match(out.payload, /not offered/);
});

test('no vendor identity in the dropped-call log line', async () => {
  const lines = [];
  const { r, req } = routerWith({ message: { role: 'assistant', content: LIVE_RAW } });
  const capture = (level) => (msg, meta) => lines.push({ level, msg, meta });
  r.logger = { info: capture('info'), warn: capture('warn'), error: capture('error') };
  await r.handleOllamaChat(req);
  const dropped = lines.find((l) => /not offered/.test(l.msg));
  assert.ok(dropped, 'the drop is logged');
  assert.deepEqual(dropped.meta.dropped_names, ['bash']);
  for (const l of lines.filter((x) => x.level === 'info')) {
    assert.doesNotMatch(JSON.stringify(l.meta || {}), /stub|minimax|pi\b/i);
  }
});
