'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { fetchWithRetry } = require('../vendors/_shared/http-client');
const {
  createAuthMiddleware,
  DEFAULT_AUTH_TIMEOUT_MS,
  DEFAULT_AUTH_BUDGET_MS,
} = require('../core/middleware');

// Measured live 2026-09-26 against auth-gateway on this host (uncached -> cached):
//
//   JWT            3.2s -> 0.3s
//   lano_ API key 10.1s -> 1.0s
//
// The router aborted the resolve at 3000ms with no retry, so every cache miss
// came back as 503 AUTH_SERVICE_UNAVAILABLE (8.8s and 23.0s end to end). A
// caller-side retry then worked only because the aborted first attempt had
// warmed the gateway cache. These tests pin the router-side fix: a default that
// covers a cold lookup, one retry on timeout/5xx (never 401/403), and a bounded
// total that counts against the request deadline.

const silentLogger = { info() {}, warn() {}, error() {} };

/**
 * A scripted auth gateway. `script` is called with the 1-based hit number and
 * returns { delayMs, status, body }. Records every request it saw.
 */
async function startGateway(script) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const n = hits.length + 1;
    hits.push({ url: req.url, method: req.method, headers: { ...req.headers } });
    const { delayMs = 0, status = 200, body = {} } = script(n) || {};
    const timer = setTimeout(() => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    }, delayMs);
    res.on('close', () => clearTimeout(timer));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}

const fakeRes = () => {
  const res = { statusCode: null, body: null, headers: {} };
  res.set = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const memoryCache = () => {
  const store = new Map();
  const writes = [];
  return {
    store,
    writes,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async set(key, value, ttl) { writes.push({ key, value, ttl }); store.set(key, value); },
  };
};

async function runAuth(middlewareOpts, reqOverrides = {}) {
  const authenticateRequest = createAuthMiddleware({
    logger: silentLogger,
    authCache: memoryCache(),
    ...middlewareOpts,
  });
  const req = { headers: { 'x-api-key': 'lano_test' }, ...reqOverrides };
  const res = fakeRes();
  let nexted = false;
  const t0 = Date.now();
  await authenticateRequest(req, res, () => { nexted = true; });
  return { req, res, nexted, elapsedMs: Date.now() - t0 };
}

const OK_BODY = { authId: 'auth-1', organizationId: 'org-1', authMethod: 'api_key', email: 'a@b.c' };

// ── fetchWithRetry: the opt-in transport behaviour ───────────────────────────

test('fetchWithRetry: retryOnTimeout retries once after our own timeout fires', async () => {
  // Generous timings: this host runs at a load average above its core count,
  // and a sub-second local round trip is not guaranteed there.
  const gw = await startGateway((n) => (n === 1 ? { delayMs: 10000 } : { status: 200, body: { ok: true } }));
  try {
    const res = await fetchWithRetry(`${gw.url}/`, { timeoutMs: 2000, retries: 1, retryOnTimeout: true });
    assert.equal(res.status, 200);
    assert.equal(gw.hits.length, 2);
  } finally {
    await gw.close();
  }
});

test('fetchWithRetry: without retryOnTimeout a timeout is still not retried (default unchanged)', async () => {
  const gw = await startGateway(() => ({ delayMs: 4000 }));
  try {
    await assert.rejects(
      fetchWithRetry(`${gw.url}/`, { timeoutMs: 800, retries: 1 }),
      (err) => err.name === 'AbortError',
    );
    // <= 1: under load the first request may not reach the server before the
    // abort. The contract is only that no second attempt is made.
    assert.ok(gw.hits.length <= 1, 'vendor callers must not pay a timeout twice');
  } finally {
    await gw.close();
  }
});

test('fetchWithRetry: deadlineAt clamps the attempt timeout', async () => {
  const gw = await startGateway(() => ({ delayMs: 3000 }));
  try {
    const t0 = Date.now();
    await assert.rejects(fetchWithRetry(`${gw.url}/`, {
      timeoutMs: 5000, retries: 1, retryOnTimeout: true, deadlineAt: Date.now() + 300,
    }));
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 1500, `expected the 300ms deadline to bound the call, took ${elapsed}ms`);
    // <= 1, not === 1: on a loaded host the first request may not even reach
    // the server inside 300ms. What matters is that no second attempt is made.
    assert.ok(gw.hits.length <= 1, 'no retry fits inside an exhausted deadline');
  } finally {
    await gw.close();
  }
});

test('fetchWithRetry: a retry is skipped when less than minRetryWindowMs would remain', async () => {
  const gw = await startGateway(() => ({ status: 503 }));
  try {
    const res = await fetchWithRetry(`${gw.url}/`, {
      timeoutMs: 5000, retries: 1, deadlineAt: Date.now() + 4000, minRetryWindowMs: 10000,
    });
    assert.equal(res.status, 503);
    assert.equal(gw.hits.length, 1);
  } finally {
    await gw.close();
  }
});

test('fetchWithRetry: onRetry reports why it retried', async () => {
  const gw = await startGateway((n) => (n === 1 ? { status: 502 } : { status: 200 }));
  const seen = [];
  try {
    await fetchWithRetry(`${gw.url}/`, { timeoutMs: 8000, retries: 1, onRetry: (i) => seen.push(i) });
    assert.deepEqual(seen, [{ attempt: 1, reason: 'status', status: 502 }]);
  } finally {
    await gw.close();
  }
});

// ── Defaults ─────────────────────────────────────────────────────────────────

test('the default per-attempt auth timeout covers the slowest measured cold lookup', () => {
  // 10.1s measured for an uncached lano_ key; 3.2s for a JWT.
  assert.ok(DEFAULT_AUTH_TIMEOUT_MS >= 10100, `default ${DEFAULT_AUTH_TIMEOUT_MS}ms is below a cold lano_ lookup`);
  assert.ok(DEFAULT_AUTH_TIMEOUT_MS <= 15000, 'but stays well inside the request budget');
});

test('the whole-resolve budget leaves room for a warm retry and most of the request budget', () => {
  // After a first attempt times out, the retry must fit a warm lookup (1.0s measured)...
  assert.ok(DEFAULT_AUTH_BUDGET_MS - DEFAULT_AUTH_TIMEOUT_MS - 600 >= 1000);
  // ...and auth may not consume more than half of the default 55s request budget.
  assert.ok(DEFAULT_AUTH_BUDGET_MS <= 55000 / 2);
});

test('the router uses those defaults when AUTH_GATEWAY_TIMEOUT_MS is unset (as in production)', () => {
  const prevT = process.env.AUTH_GATEWAY_TIMEOUT_MS;
  const prevB = process.env.AUTH_GATEWAY_BUDGET_MS;
  delete process.env.AUTH_GATEWAY_TIMEOUT_MS;
  delete process.env.AUTH_GATEWAY_BUDGET_MS;
  try {
    const AIServiceRouter = require('../core/ai-service-router');
    const r = new AIServiceRouter({});
    assert.equal(r.authTimeoutMs, DEFAULT_AUTH_TIMEOUT_MS);
    assert.equal(r.authBudgetMs, DEFAULT_AUTH_BUDGET_MS);
  } finally {
    if (prevT !== undefined) process.env.AUTH_GATEWAY_TIMEOUT_MS = prevT;
    if (prevB !== undefined) process.env.AUTH_GATEWAY_BUDGET_MS = prevB;
  }
});

// ── Middleware: retry policy ─────────────────────────────────────────────────

test('a cold lookup that times out once is retried and succeeds (the live 503 case)', async () => {
  const gw = await startGateway((n) => (n === 1 ? { delayMs: 10000 } : { status: 200, body: OK_BODY }));
  try {
    const { res, req, nexted } = await runAuth({ authGatewayUrl: gw.url, authTimeoutMs: 2000, authBudgetMs: 6000 });
    assert.equal(nexted, true, `expected success, got ${res.statusCode} ${JSON.stringify(res.body)}`);
    assert.equal(req.uai.authId, 'auth-1');
    assert.equal(gw.hits.length, 2);
  } finally {
    await gw.close();
  }
});

test('a transient 5xx is retried once and succeeds', async () => {
  for (const status of [500, 502, 503, 504]) {
    const gw = await startGateway((n) => (n === 1 ? { status } : { status: 200, body: OK_BODY }));
    try {
      const { nexted } = await runAuth({ authGatewayUrl: gw.url, authTimeoutMs: 8000, authBudgetMs: 20000 });
      assert.equal(nexted, true, `status ${status} should have been retried`);
      assert.equal(gw.hits.length, 2);
    } finally {
      await gw.close();
    }
  }
});

test('401 and 403 are a verdict on the credential: answered 401, never retried', async () => {
  for (const status of [401, 403]) {
    const gw = await startGateway(() => ({ status, body: { error: 'nope' } }));
    try {
      const { res, nexted } = await runAuth({ authGatewayUrl: gw.url, authTimeoutMs: 8000, authBudgetMs: 20000 });
      assert.equal(nexted, false);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error.code, 'AUTH_REQUIRED');
      assert.equal(gw.hits.length, 1, `status ${status} must not be retried`);
    } finally {
      await gw.close();
    }
  }
});

test('a persistent 5xx is 503 AUTH_SERVICE_UNAVAILABLE, not a 401 that blames the key', async () => {
  const gw = await startGateway(() => ({ status: 500 }));
  try {
    const { res, nexted } = await runAuth({ authGatewayUrl: gw.url, authTimeoutMs: 8000, authBudgetMs: 20000 });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error.code, 'AUTH_SERVICE_UNAVAILABLE');
    assert.ok(Number(res.headers['retry-after']) > 0);
    assert.equal(gw.hits.length, 2);
  } finally {
    await gw.close();
  }
});

test('persistent timeouts fail closed within the auth budget', async () => {
  const gw = await startGateway(() => ({ delayMs: 8000 }));
  try {
    const { res, nexted, elapsedMs } = await runAuth({ authGatewayUrl: gw.url, authTimeoutMs: 800, authBudgetMs: 2000 });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 503);
    assert.ok(elapsedMs < 3000, `auth took ${elapsedMs}ms against a 2000ms budget`);
  } finally {
    await gw.close();
  }
});

test('the auth budget is clamped to REQUEST_BUDGET_MS', async () => {
  const prev = process.env.REQUEST_BUDGET_MS;
  process.env.REQUEST_BUDGET_MS = '1500';
  const gw = await startGateway(() => ({ delayMs: 30000 }));
  try {
    // Unclamped, this would wait 10s, retry, and wait up to 10s more.
    const { res, elapsedMs } = await runAuth({ authGatewayUrl: gw.url, authTimeoutMs: 10000, authBudgetMs: 20000 });
    assert.equal(res.statusCode, 503);
    assert.ok(elapsedMs < 5000, `auth ran ${elapsedMs}ms past a 1500ms request budget`);
    assert.ok(gw.hits.length <= 1, 'no retry fits once the request budget is spent');
  } finally {
    if (prev === undefined) delete process.env.REQUEST_BUDGET_MS;
    else process.env.REQUEST_BUDGET_MS = prev;
    await gw.close();
  }
});

// ── Middleware: request clock, headers, cache ────────────────────────────────

test('the request clock starts before auth, so auth time counts against the deadline', async () => {
  const gw = await startGateway(() => ({ delayMs: 200, status: 200, body: OK_BODY }));
  try {
    const before = Date.now();
    const { req } = await runAuth({ authGatewayUrl: gw.url, authTimeoutMs: 2000, authBudgetMs: 5000 });
    assert.ok(Number.isFinite(req.requestStartedAt));
    assert.ok(req.requestStartedAt >= before && req.requestStartedAt <= before + 50,
      'stamped on entry, not after the resolve');
  } finally {
    await gw.close();
  }
});

test('an existing request clock is not overwritten', async () => {
  const gw = await startGateway(() => ({ status: 200, body: OK_BODY }));
  try {
    const startedAt = Date.now() - 4000;
    const { req } = await runAuth({ authGatewayUrl: gw.url }, { requestStartedAt: startedAt });
    assert.equal(req.requestStartedAt, startedAt);
  } finally {
    await gw.close();
  }
});

test('handleOllamaChat measures its deadline from the auth-stamped start', async () => {
  const AIServiceRouter = require('../core/ai-service-router');
  const r = new AIServiceRouter({});
  r._prefetch = { brief: async () => '' };
  let seenDeadline;
  r._chain = {
    run: async ({ deadlineAt }) => {
      seenDeadline = deadlineAt;
      return { adapterResponse: { message: { role: 'assistant', content: 'hi' } },
               selectedVendor: { _vendorId: 'stub' } };
    },
  };
  const startedAt = Date.now() - 9000; // e.g. a 9s cold auth resolve
  await r.handleOllamaChat({
    headers: {}, params: {}, requestStartedAt: startedAt,
    body: { messages: [{ role: 'user', content: 'hello' }], use_case: 'ask-ai' },
  });
  const budget = parseInt(process.env.REQUEST_BUDGET_MS || '55000', 10);
  assert.equal(seenDeadline, startedAt + budget);
});

test('forwarded headers are exactly Authorization / X-API-Key / Cookie / User-Agent', async () => {
  const gw = await startGateway(() => ({ status: 200, body: OK_BODY }));
  try {
    await runAuth({ authGatewayUrl: gw.url }, {
      headers: {
        authorization: 'Bearer tok',
        'x-api-key': 'lano_k',
        cookie: 'session=abc',
        'x-use-case': 'repl-nlp',
        'x-forwarded-for': '1.2.3.4',
      },
    });
    const h = gw.hits[0].headers;
    assert.equal(gw.hits[0].url, '/v1/auth/resolve');
    assert.equal(h.authorization, 'Bearer tok');
    assert.equal(h['x-api-key'], 'lano_k');
    assert.equal(h.cookie, 'session=abc');
    assert.equal(h['user-agent'], 'Onasis-CORE/1.0');
    assert.equal(h['x-use-case'], undefined);
    assert.equal(h['x-forwarded-for'], undefined);
  } finally {
    await gw.close();
  }
});

test('a successful resolve is cached for AUTH_CACHE_TTL_SECONDS and a hit skips the gateway', async () => {
  const prev = process.env.AUTH_CACHE_TTL_SECONDS;
  process.env.AUTH_CACHE_TTL_SECONDS = '17';
  const gw = await startGateway(() => ({ status: 200, body: OK_BODY }));
  const cache = memoryCache();
  try {
    const mw = createAuthMiddleware({ authGatewayUrl: gw.url, logger: silentLogger, authCache: cache });
    const first = { headers: { 'x-api-key': 'lano_cache' } };
    await mw(first, fakeRes(), () => {});
    assert.equal(cache.writes.length, 1);
    assert.equal(cache.writes[0].ttl, 17);
    assert.match(cache.writes[0].key, /^airouter:authcache:[0-9a-f]{64}$/);

    const second = { headers: { 'x-api-key': 'lano_cache' } };
    let nexted = false;
    await mw(second, fakeRes(), () => { nexted = true; });
    assert.equal(nexted, true);
    assert.equal(second.uai.fromCache, true);
    assert.equal(gw.hits.length, 1, 'a cache hit must not call the gateway');
  } finally {
    if (prev === undefined) delete process.env.AUTH_CACHE_TTL_SECONDS;
    else process.env.AUTH_CACHE_TTL_SECONDS = prev;
    await gw.close();
  }
});

test('a failed resolve is never cached', async () => {
  const gw = await startGateway(() => ({ status: 401 }));
  const cache = memoryCache();
  try {
    const mw = createAuthMiddleware({ authGatewayUrl: gw.url, logger: silentLogger, authCache: cache });
    await mw({ headers: { 'x-api-key': 'lano_bad' } }, fakeRes(), () => {});
    assert.equal(cache.writes.length, 0);
  } finally {
    await gw.close();
  }
});

test('no internal detail leaks into a 5xx-driven 503', async () => {
  const gw = await startGateway(() => ({ status: 503, body: { error: 'db down at 10.0.0.5' } }));
  try {
    const { res } = await runAuth({ authGatewayUrl: gw.url, authTimeoutMs: 8000, authBudgetMs: 20000 });
    const serialised = JSON.stringify(res.body);
    for (const leak of ['127.0.0.1', '10.0.0.5', 'db down', 'lano_']) {
      assert.doesNotMatch(serialised, new RegExp(leak.replace(/\./g, '\\.')), `leaked "${leak}"`);
    }
  } finally {
    await gw.close();
  }
});

test('resolve declares the router as a concierge audience', async () => {
  const gw = await startGateway(() => ({ status: 200, body: OK_BODY }));
  try {
    const { nexted } = await runAuth(
      { authGatewayUrl: gw.url, authTimeoutMs: 2000, authBudgetMs: 6000 },
      { headers: { authorization: 'Bearer a.b.c' } }
    );
    assert.equal(nexted, true);
    assert.equal(gw.hits[0].headers['x-lanonasis-concierge-audience'], 'router');
  } finally {
    await gw.close();
  }
});
