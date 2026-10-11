'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthMiddleware } = require('../core/middleware');

// An unreachable auth gateway must never be read as "allow". This asserts the
// fail-closed posture stays fail-closed, and that the caller is told the same
// thing here as on the vendor-outage path in ai-service-router.js — one outage
// contract, handled one way.

const silentLogger = { info() {}, warn() {}, error() {} };

const fakeRes = () => {
  const res = { statusCode: null, body: null, headers: {} };
  res.set = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

// Force the gateway call to fail by pointing it at a closed port.
//
// The URL is passed explicitly: createAuthMiddleware never reads
// AUTH_GATEWAY_URL itself (the router resolves it and passes it in). Before
// 2026-09-26 this test set only the env var, so the middleware fetched
// "undefined/v1/auth/resolve" and passed on a URL-parse error rather than on
// the unreachable gateway it describes. The env var stays set so the test is
// still correct if the middleware ever does read it.
const withUnreachableGateway = async () => {
  const prev = process.env.AUTH_GATEWAY_URL;
  process.env.AUTH_GATEWAY_URL = 'http://127.0.0.1:1';
  try {
    const authenticateRequest = createAuthMiddleware({
      authGatewayUrl: process.env.AUTH_GATEWAY_URL,
      logger: silentLogger,
    });
    const res = fakeRes();
    let nexted = false;
    await authenticateRequest(
      { headers: { 'x-api-key': 'lano_whatever' }, path: '/api/v1/ai-chat', ip: '127.0.0.1' },
      res,
      () => { nexted = true; },
    );
    return { res, nexted };
  } finally {
    if (prev === undefined) delete process.env.AUTH_GATEWAY_URL;
    else process.env.AUTH_GATEWAY_URL = prev;
  }
};

test('an unreachable auth gateway never falls through to the handler', async () => {
  const { nexted } = await withUnreachableGateway();
  assert.equal(nexted, false, 'auth must fail closed');
});

test('it answers 503, not 401', async () => {
  // The credential was never judged. Telling a caller their key is bad when we
  // could not check it sends them to rotate a key that was fine.
  const { res } = await withUnreachableGateway();
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'AUTH_SERVICE_UNAVAILABLE');
});

test('the caller is told when to retry', async () => {
  const { res } = await withUnreachableGateway();
  assert.ok(Number(res.headers['retry-after']) > 0, 'Retry-After must be set');
  assert.ok(Number(res.body.error.retry_after_seconds) > 0);
});

test('no internal detail leaks into the auth-outage response', async () => {
  const { res } = await withUnreachableGateway();
  const serialised = JSON.stringify(res.body);
  for (const leak of ['127.0.0.1', 'ECONNREFUSED', 'lano_', 'auth.lanonasis.com']) {
    assert.doesNotMatch(serialised, new RegExp(leak), `leaked "${leak}"`);
  }
});
