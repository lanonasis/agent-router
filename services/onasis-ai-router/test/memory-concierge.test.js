'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Regression suite for the Slack concierge failure, 2026-11-02:
//
//   User:  "please search for the last 10 entries and summarise the content smartly"
//   Agent: "I need access to the memory store ... provide the command or API"
//   User:  "please run lanonasis memory search"
//   Agent: "I can't run that here. Run it locally and paste the output."
//
// Reproduced live the same night (2 of 3 memory-analysis requests). Causes and
// fixes, each pinned below:
//   - Pi served the request with --no-tools and no way to call the router's
//     tools → in-text tool protocol in the per-request guide (core/tool-guide.js)
//   - nothing told the model it could act or which tool fits → tool guide
//   - "last N" had no tool (search is semantic; list returns no content; one
//     tool round) → memory.list with server-side hydration
//   - follow-ups lost context → opt-in session retention (core/session-store.js)
//   - dangling <tool_call> and /tmp/onasis-pi-* leaked to the user

const { buildToolGuide, withToolGuide, buildSessionNote } = require('../core/tool-guide');
const { SessionStore, callerSentHistory } = require('../core/session-store');
const { wantsMemoryTools } = require('../core/tool-affinity');
const { ToolLoop } = require('../core/tool-loop');
const { ChainExecutor } = require('../core/chain-executor');
const { VendorScoreboard } = require('../core/vendor-scoreboard');
const { extractInTextToolCalls } = require('../vendors/_shared/tool-markup');
const { sanitizeVendorResponse } = require('../vendors');
const AIServiceRouter = require('../core/ai-service-router');

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const tl = () => new ToolLoop({
  apiBaseUrl: 'http://mem.test', memoryGetPath: '/api/v1/memories', memorySearchPath: '/api/v1/memories/search',
  memoryWritePath: '/api/v1/memories', memoryPrefetchTopK: 8, routerTimeoutMs: 2000, maxToolResultChars: 6000,
  buildAuthHeaders: () => ({}), logger: quiet,
});
const conciergeTools = () => tl().getToolDefinitionsForUseCase('memory-analysis');
const names = (tools) => tools.map((t) => t.function.name);

// ── Tool set ────────────────────────────────────────────────────────────────

test('concierge lanes offer memory.list alongside search/get, and still no write', () => {
  assert.deepEqual(names(conciergeTools()), ['memory.search', 'memory.list', 'memory.get']);
  assert.ok(names(tl().getToolDefinitionsForUseCase('repl-nlp')).includes('memory.write'));
});

test('memory.list is read-only, so the l0-concierge profile may include it', () => {
  assert.ok(ToolLoop.READ_ONLY_MEMORY_TOOL_NAMES.has('memory.list'));
  const profile = require('../profiles/l0-concierge.json');
  assert.ok(profile.allowedTools.includes('memory.list'));
  assert.ok(!profile.allowedTools.includes('memory.write'));
});

// ── Tool guide ──────────────────────────────────────────────────────────────

test('the guide names exactly the offered tools and forbids asking the user to run commands', () => {
  const guide = buildToolGuide({ tools: conciergeTools(), nativeTools: true });
  for (const n of ['memory.search', 'memory.list', 'memory.get']) assert.match(guide, new RegExp(n.replace('.', '\\.')));
  assert.doesNotMatch(guide, /memory\.write|web_search|search_memory/);
  assert.match(guide, /Never ask the user to run a command/);
  assert.match(guide, /last N.*memory\.list/);
  assert.doesNotMatch(guide, /<tool_call>/, 'native vendors get no text protocol');
});

test('non-native vendors get the in-text call protocol, and it parses as an offered call', () => {
  const guide = buildToolGuide({ tools: conciergeTools(), nativeTools: false });
  const example = guide.match(/<tool_call>[^\n]+<\/tool_call>/)[0];
  const parsed = extractInTextToolCalls(example);
  assert.deepEqual(parsed.calls.map((c) => [c.name, c.complete]), [['memory.list', true]]);
});

test('no tools → no guide (public surface is untouched)', () => {
  assert.equal(buildToolGuide({ tools: [], nativeTools: false }), '');
  const bundle = { systemPromptForVendor: () => 'BASE' };
  assert.equal(withToolGuide(bundle, { tools: [], supportsNativeTools: () => true }), bundle);
});

test('withToolGuide picks the guide variant per vendor and respects a null prompt', () => {
  const bundle = { systemPromptForVendor: (v) => (v === 'embedded' ? null : 'BASE') };
  const wrapped = withToolGuide(bundle, {
    tools: conciergeTools(), supportsNativeTools: (v) => v === 'minimax', sessionNote: buildSessionNote(2),
  });
  assert.match(wrapped.systemPromptForVendor('minimax'), /^BASE[\s\S]*Conversation continuity[\s\S]*Tools you can use/);
  assert.doesNotMatch(wrapped.systemPromptForVendor('minimax'), /<tool_call>/);
  assert.match(wrapped.systemPromptForVendor('pi'), /<tool_call>/);
  assert.equal(wrapped.systemPromptForVendor('embedded'), null);
});

// ── memory.list ─────────────────────────────────────────────────────────────

function fakeMemoryApi({ total = 1073, failGetFor = new Set(), listStatus = 200 } = {}) {
  const seen = [];
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`, title: `Entry ${i}`, memory_type: 'project',
    tags: ['t'], created_at: `2026-11-0${(i % 9) + 1}T00:00:00Z`, updated_at: `2026-11-0${(i % 9) + 1}T00:00:00Z`,
    user_id: 'u', organization_id: 'o', owner_id: 'o', access_mode: 'x',
  }));
  const fetchImpl = async (url) => {
    seen.push(String(url));
    const u = new URL(url);
    if (u.pathname === '/api/v1/memories/list') {
      if (listStatus !== 200) return { ok: false, status: listStatus, json: async () => ({ error: 'boom' }) };
      const limit = Number(u.searchParams.get('limit'));
      return { ok: true, status: 200, json: async () => ({ data: rows.slice(0, limit), pagination: { total } }) };
    }
    const id = u.pathname.split('/').pop();
    if (failGetFor.has(id)) return { ok: false, status: 404, json: async () => ({ error: 'nope' }) };
    return { ok: true, status: 200, json: async () => ({ data: { id, content: `Body of ${id} `.repeat(200) } }) };
  };
  return { fetchImpl, seen };
}

test('memory.list returns newest-first entries WITH content, compact, valid JSON, inside budget', async (t) => {
  const api = fakeMemoryApi();
  t.mock.method(globalThis, 'fetch', api.fetchImpl);
  const payload = await tl().toolMemoryList({ limit: 10 }, {});
  assert.ok(payload.length <= 12000, `payload ${payload.length} chars exceeds the list budget`);
  const parsed = JSON.parse(payload); // never cut mid-JSON
  assert.equal(parsed.count, 10);
  assert.equal(parsed.total, 1073);
  assert.equal(parsed.order, 'newest_first');
  for (const row of parsed.data) {
    assert.ok(row.content && row.content.length > 100, 'content hydrated');
    assert.equal(row.content_truncated, true);
    assert.equal(row.user_id, undefined, 'internal ids stripped');
  }
  const listUrl = new URL(api.seen[0]);
  assert.equal(listUrl.searchParams.get('sortBy'), 'updated_at');
  assert.equal(listUrl.searchParams.get('sortOrder'), 'desc');
});

test('memory.list caps limit, maps order/type, and keeps rows whose body failed to load', async (t) => {
  const api = fakeMemoryApi({ failGetFor: new Set(['00000000-0000-4000-8000-000000000003']) });
  t.mock.method(globalThis, 'fetch', api.fetchImpl);
  const parsed = JSON.parse(await tl().toolMemoryList({ limit: 500, order: 'oldest', memory_type: 'project' }, {}));
  const listUrl = new URL(api.seen[0]);
  assert.equal(listUrl.searchParams.get('limit'), String(ToolLoop.MEMORY_LIST_MAX));
  assert.equal(listUrl.searchParams.get('sortOrder'), 'asc');
  assert.equal(listUrl.searchParams.get('type'), 'project');
  const failed = parsed.data.find((r) => r.id.endsWith('3'));
  assert.equal(failed.title, 'Entry 3');
  assert.equal(failed.content_unavailable, true);
});

test('memory.list: 5xx throws (so the retry wrapper fires); 4xx is a client_error payload', async (t) => {
  t.mock.method(globalThis, 'fetch', fakeMemoryApi({ listStatus: 503 }).fetchImpl);
  await assert.rejects(() => tl().toolMemoryList({}, {}), (e) => e.statusCode === 503);
  t.mock.method(globalThis, 'fetch', fakeMemoryApi({ listStatus: 403 }).fetchImpl);
  const parsed = JSON.parse(await tl().toolMemoryList({}, {}));
  assert.equal(parsed.category, 'client_error');
  assert.equal(parsed.status, 403);
});

test('memory.list is dispatched through executeToolCall only when offered', async (t) => {
  t.mock.method(globalThis, 'fetch', fakeMemoryApi().fetchImpl);
  const loop = tl();
  const caller = { headers: { authorization: 'Bearer user-token' } };
  const ok = await loop.executeToolCall({ name: 'memory.list', arguments: '{"limit":2}' }, caller, conciergeTools(), 'memory-analysis');
  assert.equal(JSON.parse(ok.payload).count, 2);
  const refused = await loop.executeToolCall({ name: 'memory.list', arguments: {} }, caller, [], 'memory-analysis');
  assert.match(refused.payload, /not offered/);
});

test('memory.get falls back to per-id fetches when the batch path is refused (template default)', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(`${init?.method || 'GET'} ${new URL(url).pathname}`);
    if (String(url).endsWith('/batch')) return { ok: false, status: 400, json: async () => ({ error: 'Memory ID prefix must be at least 8 characters' }) };
    return { ok: true, status: 200, json: async () => ({ data: { id: 'abc', title: 'T', content: 'hello' } }) };
  });
  const loop = tl();
  loop.memoryBatchGetPath = '/api/v1/memories/batch';
  const parsed = JSON.parse(await loop.toolMemoryGet({ ids: ['abc'] }, {}));
  assert.deepEqual(calls, ['POST /api/v1/memories/batch', 'GET /api/v1/memories/abc']);
  assert.equal(parsed.data[0].content, 'hello');
});

test('search results are compacted: more records fit and the JSON stays parseable', async (t) => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: `id${i}`, title: `T${i}`, content: 'x'.repeat(3000),
    similarity_score: 0.81234, user_id: 'u', organization_id: 'o', metadata: { big: 'y'.repeat(500) } }));
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: async () => ({ data: rows }) }));
  const payload = await tl().toolMemorySearch({ query: 'q' }, {});
  const parsed = JSON.parse(payload);
  assert.equal(parsed.data.length, 8);
  assert.equal(parsed.data[0].similarity, 0.812);
  assert.equal(parsed.data[0].metadata, undefined);
});

// ── Tool affinity ───────────────────────────────────────────────────────────

test('memory intent is detected on the phrasings concierge users actually send', () => {
  const offered = new Set(['memory.search', 'memory.list']);
  for (const text of [
    'please search for the last 10 entries and summarise the content smartly',
    'please run lanonasis memory search',
    'what did I save this week?',
    'show my recent notes',
    'find notes on the router deployment',
  ]) assert.equal(wantsMemoryTools([{ role: 'user', content: text }], offered), true, text);
  for (const text of ['hello', 'who are you?', 'write a haiku about rain']) {
    assert.equal(wantsMemoryTools([{ role: 'user', content: text }], offered), false, text);
  }
  assert.equal(wantsMemoryTools([{ role: 'user', content: 'search my memories' }], new Set()), false,
    'no memory tool offered → no preference');
});

function fakeVendor(id, chat) {
  return { _vendorId: id, _model: 'm', _adapter: { chat } };
}

test('preferNativeTools moves native-tool vendors ahead without dropping the rest', async () => {
  const order = [];
  const chain = new ChainExecutor({
    scoreboard: new VendorScoreboard(), logger: quiet,
    resolveChain: () => [
      fakeVendor('pi', async () => { order.push('pi'); throw new Error('down'); }),
      fakeVendor('minimax', async () => { order.push('minimax'); throw new Error('down'); }),
    ],
  });
  const promptBundle = { systemPromptForVendor: () => 'S' };
  await assert.rejects(() => chain.run({ useCase: 'memory-analysis', messages: [], promptBundle, preferNativeTools: true }));
  assert.deepEqual(order, ['minimax', 'pi']);
  order.length = 0;
  const chain2 = new ChainExecutor({ scoreboard: new VendorScoreboard(), logger: quiet, resolveChain: chain._resolveChain });
  await assert.rejects(() => chain2.run({ useCase: 'memory-analysis', messages: [], promptBundle }));
  assert.deepEqual(order, ['pi', 'minimax'], 'declared order kept when no preference');
});

// ── End to end: a Pi-served concierge request can now use the router's tools ─

function routerWithChain(vendors, { body, uai } = {}) {
  const r = new AIServiceRouter({});
  r._prefetch.brief = async () => '';
  r._chain = new ChainExecutor({ scoreboard: r._scoreboard, logger: quiet, resolveChain: () => vendors });
  const executed = [];
  r._toolLoop.executeToolCallWithRetry = async (call) => {
    executed.push([call.name, r._toolLoop.safeParseArgs(call.arguments)]);
    return { name: call.name, payload: JSON.stringify({ data: [{ id: 'm1', title: 'Router deploy', content: 'Shipped v2' }], count: 1 }) };
  };
  const req = {
    headers: {}, params: {}, requestId: 't', uai: uai || { authId: 'user-1', organizationId: 'org-1' },
    body: body || { use_case: 'memory-analysis', messages: [{ role: 'user', content: 'please search for the last 10 entries and summarise the content smartly' }] },
  };
  return { r, req, executed };
}

test('Pi-style vendor: sees the text protocol, emits <tool_call>, router runs memory.list, user gets a synthesis', async () => {
  const prompts = [];
  let turn = 0;
  const pi = fakeVendor('pi', async (internal) => {
    prompts.push(internal.systemPrompt);
    turn += 1;
    if (turn === 1) {
      return { message: { role: 'assistant', content: '<tool_call>{"name": "memory.list", "arguments": {"limit": 10}}</tool_call>' }, tool_calls: [] };
    }
    const toolMsg = internal.messages.find((m) => m.role === 'tool');
    assert.ok(toolMsg && /Router deploy/.test(toolMsg.content), 'synthesis pass receives the tool result');
    return { message: { role: 'assistant', content: 'Your latest entry: Router deploy — Shipped v2.' }, tool_calls: [] };
  });
  const { r, req, executed } = routerWithChain([pi]);
  const result = await r.handleOllamaChat(req);

  assert.deepEqual(executed, [['memory.list', { limit: 10 }]]);
  assert.match(prompts[0], /How to call a tool/);
  assert.match(prompts[0], /Never ask the user to run a command/);
  assert.doesNotMatch(prompts[1], /How to call a tool/, 'synthesis pass is not re-invited to call tools');
  assert.equal(result.response, 'Your latest entry: Router deploy — Shipped v2.');
});

test('a memory request reaches a native-tool vendor first when one is in the chain', async () => {
  const seen = [];
  const pi = fakeVendor('pi', async () => { seen.push('pi'); return { message: { role: 'assistant', content: 'pi answer' } }; });
  const minimax = fakeVendor('minimax', async (internal) => {
    seen.push('minimax');
    assert.ok(Array.isArray(internal.tools) && internal.tools.length === 3, 'native vendor gets the schemas');
    assert.doesNotMatch(internal.systemPrompt, /How to call a tool/);
    return { message: { role: 'assistant', content: 'native answer' } };
  });
  const { r, req } = routerWithChain([pi, minimax]);
  const result = await r.handleOllamaChat(req);
  assert.deepEqual(seen, ['minimax']);
  assert.equal(result.response, 'native answer');
});

// ── Sessions ────────────────────────────────────────────────────────────────

test('session ids are opt-in, validated, and scoped to the resolved identity', () => {
  assert.equal(SessionStore.sessionIdFrom({ body: {} , headers: {} }), null);
  assert.equal(SessionStore.sessionIdFrom({ body: { session_id: 'short' }, headers: {} }), null);
  assert.equal(SessionStore.sessionIdFrom({ body: { session_id: 'bad id with spaces!' }, headers: {} }), null);
  assert.equal(SessionStore.sessionIdFrom({ body: {}, headers: { 'x-onasis-session': 'slack:T1:C1:1700000000.0001' } }),
    'slack:T1:C1:1700000000.0001');
  const a = SessionStore.keyFor({ uai: { authId: 'A', organizationId: 'O' } }, 'sess-12345');
  const b = SessionStore.keyFor({ uai: { authId: 'B', organizationId: 'O' } }, 'sess-12345');
  assert.notEqual(a, b, 'same session id under another identity is a different bucket');
  assert.equal(SessionStore.keyFor({ uai: {} }, 'sess-12345'), null, 'no identity → no session');
});

test('store retains, trims and expires turns (in-process transport)', async () => {
  let now = 1_000_000;
  const store = new SessionStore({ logger: quiet, redis: null, now: () => now });
  const key = 'k';
  for (let i = 0; i < 10; i += 1) await store.append(key, `q${i}`, `a${i}`);
  const turns = await store.load(key);
  assert.equal(turns.length, store.maxTurns);
  assert.equal(turns[0].role, 'user');
  assert.equal(turns.at(-1).content, 'a9');
  now += (store.ttlSeconds + 1) * 1000;
  assert.deepEqual(await store.load(key), [], 'expired after TTL');
});

test('a failing Redis degrades to the in-process store instead of failing the request', async () => {
  const broken = { get: async () => { throw new Error('ECONNREFUSED'); }, set: async () => { throw new Error('ECONNREFUSED'); }, del: async () => {} };
  const store = new SessionStore({ logger: quiet, redis: broken });
  await store.append('k', 'hello', 'hi there');
  assert.deepEqual((await store.load('k')).map((t) => t.content), ['hello', 'hi there']);
});

test('callerSentHistory: callers that send their own transcript are not double-fed', () => {
  assert.equal(callerSentHistory([{ role: 'user', content: 'x' }]), false);
  assert.equal(callerSentHistory([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }, { role: 'user', content: 'z' }]), true);
});

test('end to end: a follow-up in the same session sees the previous exchange', async () => {
  const seenMessages = [];
  const vendor = fakeVendor('minimax', async (internal) => {
    seenMessages.push(internal.messages.map((m) => `${m.role}:${m.content}`));
    return { message: { role: 'assistant', content: `answer ${seenMessages.length}` } };
  });
  const body1 = { use_case: 'memory-analysis', session_id: 'slack-thread-0001', messages: [{ role: 'user', content: 'hello there' }] };
  const { r, req } = routerWithChain([vendor], { body: body1 });
  r._sessions = new SessionStore({ logger: quiet, redis: null });

  const res = { json(payload) { this.payload = payload; }, status() { return this; } };
  req.params.service = 'ai-chat';
  await r.routeToAIService(req, res);
  assert.equal(res.payload.onasis_metadata.session_id, 'slack-thread-0001');
  assert.equal(res.payload.onasis_metadata.session_turns_restored, 0);
  await new Promise((resolve) => setImmediate(resolve));

  const req2 = { ...req, body: { ...body1, messages: [{ role: 'user', content: 'and again?' }] } };
  await r.routeToAIService(req2, res);
  assert.equal(res.payload.onasis_metadata.session_turns_restored, 2);
  assert.deepEqual(seenMessages[1].slice(-3), ['user:hello there', 'assistant:answer 1', 'user:and again?']);

  // Another identity using the same session id sees nothing.
  const req3 = { ...req2, uai: { authId: 'someone-else', organizationId: 'org-1' } };
  await r.routeToAIService(req3, res);
  assert.equal(res.payload.onasis_metadata.session_turns_restored, 0);
});

// ── Leak fixes ──────────────────────────────────────────────────────────────

test('the live dangling-markup answer is cleaned, prose kept', () => {
  const live = 'I’ll inspect the available memory entries.<tool_call>\n<tool_call>invoke\nI’m unable to access the memory store.';
  const out = extractInTextToolCalls(live);
  assert.equal(out.found, true);
  assert.doesNotMatch(out.text, /tool_call|invoke/);
  assert.match(out.text, /unable to access/);
});

test('the Pi temp dir never reaches a client', () => {
  const clean = sanitizeVendorResponse({ response: 'Permission to inspect the project files in /tmp/onasis-pi-YG57iP' }, 'memory-analysis');
  assert.doesNotMatch(clean.response, /onasis-pi|\/tmp\//);
});
