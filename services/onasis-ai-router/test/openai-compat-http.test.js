'use strict';

// These tests exercise the Express routes rather than only the pure translator.
// They are deliberately offline: a tiny local UAI resolver stands in for the
// auth gateway and no vendor, memory service, Redis, or public endpoint is used.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const AIServiceRouter = require('../core/ai-service-router');

let authServer;
let routerServer;
let authUrl;
let routerUrl;
let authCalls = [];
let localListenersUnavailable = false;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => {
    if (!error || error.code === 'ERR_SERVER_NOT_RUNNING') return resolve();
    return reject(error);
  }));
}

function skipIfLocalListenersUnavailable(t) {
  if (!localListenersUnavailable) return false;
  t.skip('local listeners are prohibited by this test environment');
  return true;
}

async function request(path, options = {}) {
  const response = await fetch(`${routerUrl}${path}`, options);
  return { status: response.status, body: await response.json() };
}

test.before(async () => {
  authServer = http.createServer((req, res) => {
    authCalls.push({ authorization: req.headers.authorization, apiKey: req.headers['x-api-key'] });
    if (req.headers['x-api-key'] === 'lano_http_contract' || req.headers.authorization === 'Bearer jwt_http_contract') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        authId: 'auth-http-contract',
        organizationId: 'org-http-contract',
        authMethod: req.headers['x-api-key'] ? 'api_key' : 'jwt',
      }));
    }
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'invalid credential' }));
  });
  let authAddress;
  try {
    authAddress = await listen(authServer);
  } catch (error) {
    // Some sandboxed test runners prohibit all local listener creation. The
    // route harness remains mandatory in CI and normal development; skip only
    // in that explicitly constrained environment rather than masking another
    // setup failure as a passing test.
    if (error?.code === 'EPERM') {
      localListenersUnavailable = true;
      return;
    }
    throw error;
  }
  authUrl = `http://127.0.0.1:${authAddress.port}`;

  const app = express();
  app.use(express.json());
  const aiRouter = new AIServiceRouter({ authGatewayUrl: authUrl, authTimeoutMs: 500 });
  app.use(aiRouter.getRoutes());
  routerServer = http.createServer(app);
  const routerAddress = await listen(routerServer);
  routerUrl = `http://127.0.0.1:${routerAddress.port}`;
});

test.after(async () => {
  await Promise.all([close(routerServer), close(authServer)]);
});

test('GET /v1/models is authenticated and exposes exactly lzero', async (t) => {
  if (skipIfLocalListenersUnavailable(t)) return;
  const unauthenticated = await request('/v1/models');
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.error.code, 'AUTH_REQUIRED');

  const authenticated = await request('/v1/models', {
    headers: { 'X-API-Key': 'lano_http_contract' },
  });
  assert.equal(authenticated.status, 200);
  assert.deepEqual(authenticated.body, {
    object: 'list',
    data: [{ id: 'lzero', object: 'model', created: 1756684800, owned_by: 'Onasis' }],
  });
});

test('the OpenAI Bearer convention is translated only for lano_ keys', async (t) => {
  if (skipIfLocalListenersUnavailable(t)) return;
  authCalls = [];
  const result = await request('/v1/models', {
    headers: { Authorization: 'Bearer lano_http_contract' },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(authCalls.at(-1), { authorization: undefined, apiKey: 'lano_http_contract' });
});

test('JWT Bearer credentials stay on the Bearer UAI path', async (t) => {
  if (skipIfLocalListenersUnavailable(t)) return;
  authCalls = [];
  const result = await request('/v1/models', {
    headers: { Authorization: 'Bearer jwt_http_contract' },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(authCalls.at(-1), { authorization: 'Bearer jwt_http_contract', apiKey: undefined });
});

test('MaaS-scoped credentials receive a precise OpenAI-shaped error before UAI', async (t) => {
  if (skipIfLocalListenersUnavailable(t)) return;
  authCalls = [];
  const result = await request('/v1/models', {
    headers: { Authorization: 'Bearer lms_not_router_scoped' },
  });

  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'invalid_api_key');
  assert.match(result.body.error.message, /memory API/i);
  assert.equal(authCalls.length, 0, 'unsupported credentials must not be forwarded as opaque auth failures');
});

test('POST /v1/chat/completions rejects a malformed body before vendor routing', async (t) => {
  if (skipIfLocalListenersUnavailable(t)) return;
  // `stream: true` is SUPPORTED since the SSE pipeline landed (PR #17) — it
  // routes to the streaming path. The old assertion (`stream_unsupported`)
  // encoded the pre-streaming contract and is stale.
  //
  // What must still hold is that a malformed request is rejected with an
  // OpenAI-shaped error BEFORE any vendor is contacted.
  const result = await request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'lano_http_contract' },
    body: JSON.stringify({ model: 'lzero', messages: [] }),
  });

  assert.equal(result.status, 400);
  assert.ok(result.body.error, 'expected an OpenAI-shaped error body');
  assert.equal(typeof result.body.error.code, 'string');
  assert.equal(typeof result.body.error.message, 'string');
});

test('unknown OpenAI model is never silently substituted', async (t) => {
  if (skipIfLocalListenersUnavailable(t)) return;
  const result = await request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'lano_http_contract' },
    body: JSON.stringify({ model: 'other-model', messages: [{ role: 'user', content: 'hello' }] }),
  });

  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'model_not_found');
  assert.equal(result.body.error.param, 'model');
});
