'use strict';

/**
 * R1 + R2 regression tests — memory tools must check response.ok AND throw on 5xx.
 *
 * R1: Without response.ok check, a memory API returning HTTP 500
 *     is passed as a successful tool result, and the model summarises an error object
 *     as though it were the user's memories.
 *
 * R2: Memory tools THROW on transport/5xx failures so that the
 *     executeToolCallWithRetry wrapper catches and retries once.
 *     On 4xx (client errors), they return an error payload (not retryable).
 *
 * Run: node --test services/onasis-ai-router/test/tool-loop-r1.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolLoop } = require('../core/tool-loop');

const silent = { warn() {}, info() {}, error() {} };

function makeToolLoop() {
  return new ToolLoop({
    apiBaseUrl: 'http://127.0.0.1:1',
    memorySearchPath: '/api/v1/memory/search',
    memoryGetPath: '/api/v1/memory',
    memoryWritePath: '/api/v1/memory',
    memoryPrefetchTopK: 3,
    routerTimeoutMs: 50,
    maxToolResultChars: 6000,
    toolSummarizeEnabled: false,
    buildAuthHeaders: () => ({}),
    logger: silent,
  });
}

function fakeFetch(status, body) {
  const b = typeof body === 'string' ? body : JSON.stringify(body);
  return () =>
    new Promise((resolve) =>
      setTimeout(() =>
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: () => Promise.resolve(JSON.parse(b)),
          text: () => Promise.resolve(b),
        }),
        0,
      ),
    );
}

// The retry wrapper calls executeToolCall, which calls toolMemorySearch.
// On 5xx the tool throws; the wrapper catches and retries once.
// On retry exhaustion, the wrapper returns a final error string.
async function callThroughRetryWrapper(tl, methodName) {
  // simulate: executeToolCallWithRetry -> executeToolCall -> toolMemorySearch
  // We call toolMemorySearch directly, then wrap with the retry logic.
  const attempt = async () => tl[methodName]({ query: 'deploy credentials' }, {});
  try {
    return await attempt();
  } catch (error) {
    // First failure — retry
    try {
      return await attempt();
    } catch (finalError) {
      return JSON.stringify({
        error: `${methodName} failed after retry`,
        message: finalError.message,
        statusCode: finalError.statusCode
      });
    }
  }
}

// ---- R1: 5xx must NOT be treated as success ----

test('R1: toolMemorySearch on 5xx returns error string (not treated as success)', async () => {
  globalThis.fetch = fakeFetch(500, { error: 'service unavailable' });
  const tl = makeToolLoop();
  const result = await callThroughRetryWrapper(tl, 'toolMemorySearch');
  const parsed = JSON.parse(result);
  assert.ok(parsed.error, 'must carry an error field after retry exhaustion');
  assert.equal(parsed.statusCode, 500, 'must include the HTTP status');
});

test('R1: toolMemorySearch returns client_error payload on HTTP 403', async () => {
  globalThis.fetch = fakeFetch(403, { error: 'forbidden' });
  const tl = makeToolLoop();
  const result = await tl.toolMemorySearch({ query: 'q' }, {});
  const parsed = JSON.parse(result);
  assert.equal(parsed.category, 'client_error');
  assert.equal(parsed.status, 403);
});

test('R1: toolMemoryGet returns error on HTTP 500', async () => {
  globalThis.fetch = fakeFetch(500, { error: 'db down' });
  const tl = makeToolLoop();
  const result = await tl.toolMemoryGet({ ids: ['mem-1'] }, {});
  const parsed = JSON.parse(result);
  // The throw in the inner fetch causes Promise.all to reject, outer catch returns error
  assert.ok(parsed.error, 'must carry an error field');
  assert.ok(parsed.message.includes('db down'));
});

test('R1: toolMemoryWrite returns client_error on HTTP 401', async () => {
  globalThis.fetch = fakeFetch(401, { error: 'unauthorized' });
  const tl = makeToolLoop();
  const result = await tl.toolMemoryWrite({ title: 't', content: 'c' }, {});
  const parsed = JSON.parse(result);
  assert.equal(parsed.category, 'client_error');
  assert.equal(parsed.status, 401);
});

test('R1: toolMemorySearch passes through 200 result unchanged', async () => {
  globalThis.fetch = fakeFetch(200, { data: [{ id: 'm1', content: 'hello' }] });
  const tl = makeToolLoop();
  const result = await tl.toolMemorySearch({ query: 'q' }, {});
  const parsed = JSON.parse(result);
  assert.equal(parsed.data.length, 1, 'should pass through the data array');
});

// ---- R2: 5xx throws so retry wrapper fires ----

test('R2: retry wrapper fires twice on 5xx', async () => {
  let attempts = 0;
  globalThis.fetch = () => {
    attempts++;
    return fakeFetch(500, { error: 'server error' })();
  };
  const tl = makeToolLoop();
  const result = await callThroughRetryWrapper(tl, 'toolMemorySearch');
  assert.equal(attempts, 2, `retry wrapper should fire — expected 2 attempts, got ${attempts}`);
  const parsed = JSON.parse(result);
  assert.ok(parsed.error, 'final result should carry error after retry exhaustion');
});

// Clean up
test.after(() => {
  delete globalThis.fetch;
});
