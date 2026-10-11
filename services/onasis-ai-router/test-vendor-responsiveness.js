#!/usr/bin/env node
'use strict';

/**
 * Automated vendor responsiveness test — real assertions, not a print script.
 *
 * Distinct from tmp/vendor-latency.js (a manual console benchmark) and from
 * test-integration.js (a non-asserting wiring smoke check). This asserts:
 *  - every active vendor's healthCheck() resolves within its configured
 *    budget (HEALTHCHECK timeout or a generous default margin over it)
 *
 *    TIMING ONLY. A pass here says nothing about whether a vendor can serve.
 *    Adapter healthCheck()s are reachability probes (openai/anthropic hit
 *    /models, which answers 200 on an account with zero credits), and without
 *    a credential they short-circuit to `false` in <1ms. Until 2026-09-26 that
 *    short-circuit was reported as a pass, so a run with no keys in the
 *    environment read "all good" for vendors live /health reported unhealthy
 *    (openai 429 no credits, anthropic 400 credit balance too low). Those
 *    subtests are now SKIPPED with the reason, and every timed subtest prints
 *    what healthCheck() actually returned. Serving health is
 *    core/vendor-health.js (a real completion probe) — read GET /health.
 *  - a credentialed vendor's chat() completes within its configured timeout
 *    (skipped when no credential is present in the test environment)
 *  - the shared http-client's retry logic retries exactly once on a
 *    transient 503-then-200 and does NOT retry on a 401
 *  - resolveVendorChainForUseCase returns a non-empty chain for every
 *    declared USE_CASES key (regression guard against a registry edit
 *    breaking a use case's fallback chain)
 *
 * Uses Node's built-in test runner — no new test-framework dependency.
 * Run: node --test test-vendor-responsiveness.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { VENDOR_REGISTRY, USE_CASES, resolveVendorChainForUseCase } = require('./vendors');
const { fetchWithRetry, healthCheckTimeoutMs } = require('./vendors/_shared/http-client');

const activeVendors = Object.entries(VENDOR_REGISTRY).filter(([, cfg]) => cfg.status === 'active');

test('resolveVendorChainForUseCase returns a non-empty chain for every declared use case', () => {
  for (const useCase of Object.keys(USE_CASES)) {
    const chain = resolveVendorChainForUseCase(useCase);
    assert.ok(chain.length > 0, `expected a non-empty vendor chain for use case "${useCase}"`);
  }
});

test('every active vendor exports chat() and healthCheck()', () => {
  for (const [vendorId, cfg] of activeVendors) {
    assert.equal(typeof cfg.adapter.chat, 'function', `${vendorId}: missing chat()`);
    assert.equal(typeof cfg.adapter.healthCheck, 'function', `${vendorId}: missing healthCheck()`);
  }
});

test('active vendors: healthCheck() returns within its configured budget (timing only, not serving health)', async (t) => {
  for (const [vendorId] of activeVendors) {
    // Without a credential the adapter returns false before any I/O: there is
    // nothing to time, and a pass would read as "healthy" when it is not.
    // (pi's healthCheck spawns `pi --version` and needs no key, so it is only
    // skipped for adapters whose healthCheck() actually has that guard.)
    const shortCircuits = vendorId !== 'pi' && credentialEnvVar(vendorId) && !hasCredential(vendorId);
    const skip = shortCircuits ? 'no credential in test env — healthCheck() short-circuits to false' : false;
    await t.test(vendorId, { skip }, async (st) => {
      const prefix = vendorId.toUpperCase().replace(/-/g, '_');
      const budgetMs = healthCheckTimeoutMs(prefix);
      const marginMs = 1000; // allow for event-loop/process overhead, not network variance

      const t0 = Date.now();
      const cfg = VENDOR_REGISTRY[vendorId];
      // healthCheck() itself already enforces budgetMs via its own AbortController;
      // this asserts it actually returns (doesn't hang) within budget + margin.
      const result = await cfg.adapter.healthCheck().catch(() => false);
      const elapsed = Date.now() - t0;
      // Surfaced so nobody mistakes this test passing for the vendor being up.
      st.diagnostic(`${vendorId} healthCheck() -> ${result} in ${elapsed}ms (reachability only; serving health is GET /health)`);

      assert.ok(
        elapsed <= budgetMs + marginMs,
        `${vendorId} healthCheck() took ${elapsed}ms, expected <= ${budgetMs + marginMs}ms`
      );
    });
  }
});

test('credentialed vendors: chat() completes within its configured timeout', async (t) => {
  for (const [vendorId] of activeVendors) {
    const skipReason = !hasCredential(vendorId)
      ? 'no credential in test env'
      : (vendorId === 'ollama' && !(await ollamaModelAvailable(VENDOR_REGISTRY.ollama.models.speed)))
        ? 'target model not pulled in local Ollama'
        : false;

    await t.test(vendorId, { skip: skipReason }, async () => {
      const cfg = VENDOR_REGISTRY[vendorId];
      const prefix = vendorId.toUpperCase().replace(/-/g, '_');
      const timeoutMs = parseInt(process.env[`${prefix}_TIMEOUT_MS`] || '30000', 10);
      const marginMs = 2000;

      const internalRequest = {
        messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
        temperature: 0,
        maxTokens: 16,
      };

      // This asserts TIMING, not success — a real upstream rejection (bad
      // credentials, exhausted billing, etc.) is a legitimate, fast outcome
      // and must not fail this test. Only a call that overruns its budget
      // (e.g. hangs past its AbortController timeout) should fail here.
      const t0 = Date.now();
      await cfg.adapter.chat(internalRequest, cfg.models.speed || cfg.models.quality).catch(() => {});
      const elapsed = Date.now() - t0;

      assert.ok(
        elapsed <= timeoutMs + marginMs,
        `${vendorId} chat() took ${elapsed}ms, expected <= ${timeoutMs + marginMs}ms`
      );
    });
  }
});

test('fetchWithRetry retries exactly once on a transient 503-then-200', async () => {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
    if (requestCount === 1) {
      res.writeHead(503);
      res.end('service unavailable');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetchWithRetry(`http://127.0.0.1:${port}/`, { timeoutMs: 8000, retries: 1 });
    assert.equal(response.status, 200);
    assert.equal(requestCount, 2, 'expected exactly one retry (two total requests)');
  } finally {
    server.close();
  }
});

test('fetchWithRetry does not retry on a 401', async () => {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
    res.writeHead(401);
    res.end('unauthorized');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetchWithRetry(`http://127.0.0.1:${port}/`, { timeoutMs: 8000, retries: 1 });
    assert.equal(response.status, 401);
    assert.equal(requestCount, 1, 'expected no retry on a non-retryable 401');
  } finally {
    server.close();
  }
});

// Credential presence check per vendor, matching each adapter's own
// "no API key configured" guard — avoids duplicating adapter internals here.
function credentialEnvVar(vendorId) {
  const envMap = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    minimax: 'MINIMAX_API_KEY',
    // pi runs a local CLI but routes to its provider (minimax by default) with
    // the key inherited from this environment — see vendors/pi/adapter.js.
    pi: process.env.PI_PROVIDER && process.env.PI_PROVIDER !== 'minimax'
      ? `${process.env.PI_PROVIDER.toUpperCase()}_API_KEY` : 'MINIMAX_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    'supabase-edge': 'SUPABASE_ANON_KEY',
    openclaw: 'OPENCLAW_GATEWAY_TOKEN',
    hermes: 'API_SERVER_KEY',
  };
  return envMap[vendorId] || null;
}

function hasCredential(vendorId) {
  if (vendorId === 'ollama') return true; // no credential required
  const key = credentialEnvVar(vendorId);
  return !!(key && process.env[key]);
}

// Ollama requires no credential but does require the target model to
// actually be pulled locally — check /api/tags rather than assuming.
async function ollamaModelAvailable(model) {
  try {
    const base = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    const res = await fetchWithRetry(`${base}/api/tags`, { timeoutMs: 3000, retries: 0 });
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data.models) && data.models.some((m) => m.name === model);
  } catch {
    return false;
  }
}
