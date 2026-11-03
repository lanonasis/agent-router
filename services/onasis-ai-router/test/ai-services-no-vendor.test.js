'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const AIServiceRouter = require('../core/ai-service-router');

// Regression guard for the GET /ai-services response.
//
// services/onasis-ai-router/CLAUDE.md states a HARD invariant: vendor
// identifiers, model names and keys must NEVER reach a client response. The
// root `/` route already had `ai_provider: 'Ollama'` removed for exactly this
// reason (server.js, comment above `model:`), but `/ai-services` was the missed
// sibling: it published `ai_provider: 'Ollama'` and, via getServiceMapping(),
// entries carrying `type: 'ollama'` plus descriptions naming "Ollama". It was
// also stale — `ollama` is deprecated and the chains now lead with pi/minimax,
// with lmstudio as the local last-resort fallback (see vendors/index.js).
//
// describeServices() is the PURE, vendor-neutral descriptor the route uses.
// getServiceMapping() stays for INTERNAL dispatch only and is never serialised
// to a client.

const describeServices = AIServiceRouter.describeServices;
const proto = AIServiceRouter.prototype;

// ── the route itself must be exercised ──────────────────────────────────────
// A local object literal asserted against `!('ai_provider' in payload)` can
// never fail: it proves nothing about what the route actually serialises. This
// mounts the REAL Express router and makes a REAL HTTP request, so reverting
// the route (e.g. back to `this.getServiceMapping()` or re-adding
// `ai_provider: 'Ollama'`) makes the assertion fail.

function makeRoutes() {
  const ai = new AIServiceRouter({});
  // Routes capture this.authenticateRequest when getRoutes() runs, so replacing
  // it here stops any auth-gateway call. req.uai is set so the payload is realistic.
  ai.authenticateRequest = (req, res, next) => { req.uai = { authId: 'test-auth-id' }; next(); };
  return ai.getRoutes();
}

async function getJson(path) {
  const app = express();
  app.use('/', makeRoutes());
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test('GET /ai-services returns a vendor-neutral payload from the real route', async () => {
  const { status, body } = await getJson('/ai-services');
  assert.equal(status, 200);
  // The leaked field must not be present at all.
  assert.ok(!('ai_provider' in body), 'ai_provider was removed from the route response');
  // No vendor / upstream model name anywhere in the serialised response.
  const serialised = JSON.stringify(body).toLowerCase();
  assert.doesNotMatch(
    serialised,
    /ollama|minimax|openclaw|lmstudio|anthropic|deepseek|nemotron|qwen|llama|openai|claude|gpt|nvidia/,
    'the /ai-services response must not name a vendor or upstream model',
  );
  // The internal dispatch type must not leak either.
  assert.equal(body.available_services['ai-chat'].type, undefined);
  assert.ok(body.available_services['ai-chat']);
});

test('describeServices is exported as a pure function', () => {
  assert.equal(typeof describeServices, 'function');
});

test('the serialised descriptor discloses no vendor, model or key', () => {
  const serialised = JSON.stringify(describeServices()).toLowerCase();
  assert.doesNotMatch(
    serialised,
    /ollama|minimax|openclaw|lmstudio|anthropic|deepseek|nemotron|qwen|llama/,
    'the /ai-services descriptor must not name a vendor or upstream model',
  );
  // Real vendor brand/model ids must not appear either.
  for (const forbidden of ['openai', 'claude', 'gpt', 'nvidia']) {
    assert.ok(!serialised.includes(forbidden), `must not disclose "${forbidden}"`);
  }
});

test('each entry carries a vendor-neutral model name and a generic description', () => {
  const services = describeServices();
  const keys = Object.keys(services);
  assert.ok(keys.length > 0, 'at least one service is described');
  for (const key of keys) {
    const entry = services[key];
    assert.equal(typeof entry.description, 'string');
    assert.ok(entry.description.length > 0);
    assert.equal(typeof entry.model, 'string');
    assert.ok(entry.model.length > 0);
    assert.ok(!('provider' in entry), 'the field is `model`, matching the root `/` payload');
  }
});

test('the descriptor never leaks the internal dispatch type', () => {
  const services = describeServices();
  for (const key of Object.keys(services)) {
    assert.equal(services[key].type, undefined, `${key} must not expose the internal type`);
  }
});

test('pure: two calls return equal output and do not mutate shared state', () => {
  assert.deepEqual(describeServices(), describeServices());
});

// ── dispatch must survive the fix ───────────────────────────────────────────
// The required change is to the PUBLIC response only. getServiceMapping() still
// names the upstream `type`, and routeToAIService still resolves 'ai-chat' (and
// the legacy 'ollama' alias) to the chat handler.

test('getServiceMapping still keys the internal ollama dispatch type', () => {
  const mapping = proto.getServiceMapping.call({});
  assert.equal(mapping['ai-chat'].type, 'ollama');
  assert.equal(mapping['chat'].type, 'ollama');
  assert.equal(mapping['ollama'].type, 'ollama', 'legacy alias kept for dispatch');
});

test("routeToAIService resolves 'ai-chat' to the chat handler", async () => {
  const calls = [];
  const fakeThis = {
    getServiceMapping: proto.getServiceMapping,
    ollamaModel: 'test-model',
    _activity: { begin() {} },
    _emitOpsEvent: async () => {},
    extractUsageData: () => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, tokens: 0 }),
    addOnasisBranding: (r) => ({ ...r }),
    async handleOllamaChat() { calls.push('handleOllamaChat'); return { response: 'ok' }; },
  };
  const req = { params: { service: 'ai-chat' }, uai: {}, headers: {}, body: {}, path: '/api/ai-chat' };
  let body;
  const res = { json: (b) => { body = b; }, status: () => res };
  await proto.routeToAIService.call(fakeThis, req, res);
  assert.deepEqual(calls, ['handleOllamaChat']);
  assert.equal(body.response, 'ok');
});

test("routeToAIService resolves the legacy 'ollama' alias to the chat handler", async () => {
  const calls = [];
  const fakeThis = {
    getServiceMapping: proto.getServiceMapping,
    ollamaModel: 'test-model',
    _activity: { begin() {} },
    _emitOpsEvent: async () => {},
    extractUsageData: () => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, tokens: 0 }),
    addOnasisBranding: (r) => ({ ...r }),
    async handleOllamaChat() { calls.push('handleOllamaChat'); return { response: 'ok' }; },
  };
  const req = { params: { service: 'ollama' }, uai: {}, headers: {}, body: {}, path: '/api/ollama' };
  const res = { json: () => {}, status: () => res };
  await proto.routeToAIService.call(fakeThis, req, res);
  assert.deepEqual(calls, ['handleOllamaChat']);
});

test('the wildcard 404 advertises only vendor-neutral service names', async () => {
  let body;
  const fakeThis = { getServiceMapping: proto.getServiceMapping };
  const req = { params: { service: 'nope' }, uai: {}, headers: {}, body: {}, path: '/api/nope' };
  const res = { json: (b) => { body = b; }, status: () => res };
  await proto.routeToAIService.call(fakeThis, req, res);
  assert.ok(body.error);
  assert.ok(!JSON.stringify(body).toLowerCase().match(/ollama/));
});
