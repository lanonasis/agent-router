'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const AIServiceRouter = require('../core/ai-service-router');
const { VendorsExhaustedError } = require('../core/chain-executor');

// When no vendor can serve a request the router used to answer 500
// "AI service temporarily unavailable". To a client that is indistinguishable
// from a request that can never succeed, so the sensible reaction — back off
// and retry — looks wrong. It is an outage, and outages are 503.

const fakeRes = () => {
  const res = { statusCode: null, body: null, headers: {} };
  res.set = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const routeWith = async (error) => {
  const router = new AIServiceRouter({});
  router.logger = { info() {}, warn() {}, error() {} };
  router.handleOllamaChat = async () => { throw error; };
  const res = fakeRes();
  await router.routeToAIService({ params: { service: 'ai-chat' }, body: {}, headers: {} }, res);
  return res;
};

test('an exhausted chain answers 503, not 500', async () => {
  const res = await routeWith(new VendorsExhaustedError('All AI vendors exhausted', { attempted: 5 }));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'ALL_VENDORS_UNAVAILABLE');
});

test('the response tells the client when to come back', async () => {
  const res = await routeWith(new VendorsExhaustedError('All AI vendors exhausted', { attempted: 5 }));
  assert.ok(Number(res.headers['retry-after']) > 0, 'Retry-After must be set');
  assert.ok(Number(res.body.error.retry_after_seconds) > 0);
});

test('no vendor identity leaks into the outage response', async () => {
  // The underlying messages name providers and their billing URLs. They are
  // logged; they must not be served.
  const cause = new Error('OpenAI adapter: upstream returned 429 — add credits at platform.openai.com');
  const res = await routeWith(new VendorsExhaustedError('All AI vendors exhausted', { cause, attempted: 5 }));
  const serialised = JSON.stringify(res.body);
  for (const leak of ['openai', 'anthropic', 'openclaw', 'minimax', 'ollama', 'platform.openai.com']) {
    assert.doesNotMatch(serialised.toLowerCase(), new RegExp(leak.toLowerCase()),
      `outage response leaked "${leak}"`);
  }
});

test('an ordinary bug still answers 500', async () => {
  // 503 means "come back later". A genuine defect must not invite a retry loop.
  const res = await routeWith(new TypeError('messages is not iterable'));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'AI_SERVICE_ERROR');
});

test('an unknown service is still a 404', async () => {
  const router = new AIServiceRouter({});
  router.logger = { info() {}, warn() {}, error() {} };
  const res = fakeRes();
  await router.routeToAIService({ params: { service: 'nope' }, body: {}, headers: {} }, res);
  assert.equal(res.statusCode, 404);
});
