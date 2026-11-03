'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// The concierge must answer from the memory bank of the person talking to it,
// never from the router operator's. Confirmed leak, 2026-11-03: the router
// added its own MEMORY_API_KEY to every Bearer-authenticated call, the memory
// API resolves X-API-Key first, and so every Slack user searched the service
// key owner's (admin's) memories. See core/memory-auth.js.

const { callerMemoryHeaders, warnIfRetiredFallbackConfigured, NO_CALLER_CREDENTIAL_PAYLOAD } = require('../core/memory-auth');
const { ToolLoop } = require('../core/tool-loop');
const { MemoryPrefetch } = require('../core/memory-prefetch');
const AIServiceRouter = require('../core/ai-service-router');

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const SERVICE_KEY = 'lano_service_owner_key';

function withServiceCredsInEnv(fn) {
  return async (t) => {
    const saved = { k: process.env.MEMORY_API_KEY, b: process.env.MEMORY_AUTH_BEARER };
    process.env.MEMORY_API_KEY = SERVICE_KEY;
    process.env.MEMORY_AUTH_BEARER = 'service-bearer';
    try { await fn(t); } finally {
      if (saved.k === undefined) delete process.env.MEMORY_API_KEY; else process.env.MEMORY_API_KEY = saved.k;
      if (saved.b === undefined) delete process.env.MEMORY_AUTH_BEARER; else process.env.MEMORY_AUTH_BEARER = saved.b;
    }
  };
}

const conciergeReq = {
  headers: { authorization: 'Bearer linked-slack-user-token' },
  uai: { authId: '2b8f3916-45d6-4667-b48d-4a4e7acd96fd', organizationId: 'ba2c1b22', authMethod: 'concierge' },
};

test('a concierge (Bearer) caller is NEVER given the service X-API-Key', withServiceCredsInEnv(() => {
  const r = new AIServiceRouter({});
  const headers = r.buildAuthHeaders(conciergeReq);
  assert.equal(headers.Authorization, 'Bearer linked-slack-user-token');
  assert.equal(headers['X-API-Key'], undefined, 'service key would win and expose the owner\'s memories');
  assert.equal(headers['X-UAI-Auth-Id'], conciergeReq.uai.authId);
}));

test('an API-key caller is never given the service Bearer', withServiceCredsInEnv(() => {
  const r = new AIServiceRouter({});
  const headers = r.buildAuthHeaders({ headers: { 'x-api-key': 'lano_caller' }, uai: { authId: 'c' } });
  assert.equal(headers['X-API-Key'], 'lano_caller');
  assert.equal(headers.Authorization, undefined);
}));

test('no caller credential → no credential at all (not the service one)', withServiceCredsInEnv(() => {
  const { headers, hasCredential } = callerMemoryHeaders({ headers: {} });
  assert.equal(hasCredential, false);
  assert.deepEqual(headers, {});
}));

test('end to end: the memory API receives only the linked user\'s token on every memory tool', withServiceCredsInEnv(async (t) => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    seen.push({ url: String(url), headers: init.headers });
    if (String(url).includes('/list')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'm1', title: 't' }] }) };
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'm1', title: 't', content: 'c' }] }) };
  });
  const r = new AIServiceRouter({});
  const offered = r._toolLoop.getToolDefinitionsForUseCase('memory-analysis');
  for (const name of ['memory.search', 'memory.list', 'memory.get']) {
    await r._toolLoop.executeToolCall({ name, arguments: { query: 'q', ids: ['m1'], limit: 1 } }, conciergeReq, offered, 'memory-analysis');
  }
  assert.ok(seen.length >= 3);
  for (const call of seen) {
    assert.equal(call.headers['X-API-Key'], undefined, `${call.url} carried a service key`);
    assert.equal(call.headers.Authorization, 'Bearer linked-slack-user-token');
  }
}));

test('memory tools refuse a request with no caller credential, without calling the API', async (t) => {
  let called = false;
  t.mock.method(globalThis, 'fetch', async () => { called = true; return { ok: true, json: async () => ({}) }; });
  const loop = new ToolLoop({ apiBaseUrl: 'http://x', logger: quiet, buildAuthHeaders: () => ({}) });
  const offered = loop.getToolDefinitionsForUseCase('memory-analysis');
  const out = await loop.executeToolCall({ name: 'memory.search', arguments: { query: 'q' } }, { headers: {} }, offered, 'memory-analysis');
  assert.equal(out.payload, NO_CALLER_CREDENTIAL_PAYLOAD);
  assert.equal(called, false);
});

test('prefetch skips a request with no caller credential', async (t) => {
  let called = false;
  t.mock.method(globalThis, 'fetch', async () => { called = true; return { ok: true, json: async () => ({ data: [] }) }; });
  const p = new MemoryPrefetch({ apiBaseUrl: 'http://x', memorySearchPath: '/s', topK: 3, timeoutMs: 100,
    enabled: true, maxChars: 1000, buildAuthHeaders: () => ({}), logger: quiet });
  assert.equal(await p.brief({ headers: {}, uai: { authId: 'u' } }, [{ role: 'user', content: 'my notes?' }], {}), '');
  assert.equal(called, false);
});

test('a configured retired fallback is reported once at boot', () => {
  const warnings = [];
  const ignored = warnIfRetiredFallbackConfigured({ warn: (m, d) => warnings.push(d) }, { MEMORY_API_KEY: 'x' });
  assert.deepEqual(ignored, ['MEMORY_API_KEY']);
  assert.deepEqual(warnings[0].ignored, ['MEMORY_API_KEY']);
});
