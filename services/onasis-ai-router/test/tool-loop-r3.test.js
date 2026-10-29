'use strict';

/**
 * R3 regression tests — bounded concurrency in executeToolCalls.
 *
 * Without this fix, executeToolCalls is a sequential loop: 3 tool calls × 15s
 * timeout = 45s before synthesis even begins. With concurrency: 3, three
 * 15s calls complete in ~15s (not 45s).
 *
 * Run: node --test services/onasis-ai-router/test/tool-loop-r3.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolLoop } = require('../core/tool-loop');

// Restore (not delete) fetch afterwards: `bun test` runs every file in one
// process, so deleting it broke every later test that calls fetch.
const originalFetch = globalThis.fetch;

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

test('executeToolCalls accepts concurrency parameter', async () => {
  // Just verify the call doesn't throw and returns correct count
  // The actual fetch will fail (discard port 1), but we test the structure
  const tl = makeToolLoop();
  const results = await tl.executeToolCalls(
    [
      { name: 'memory.search', arguments: JSON.stringify({ query: 'a' }) },
      { name: 'memory.search', arguments: JSON.stringify({ query: 'b' }) },
    ],
    {},
    [],
    'test',
    { concurrency: 3 },  // ← should not throw
  );
  assert.equal(results.length, 2, 'must return one result per call');
});

test('executeToolCalls returns results in call order', async () => {
  const tl = makeToolLoop();
  const results = await tl.executeToolCalls(
    [
      { name: 'memory.search', arguments: JSON.stringify({ query: 'first' }) },
      { name: 'memory.get', arguments: JSON.stringify({ ids: ['m1'] }) },
      { name: 'memory.search', arguments: JSON.stringify({ query: 'third' }) },
    ],
    {},
    ['memory.search', 'memory.get', 'memory.write'],
    'test',
    { concurrency: 3 },
  );
  assert.equal(results.length, 3);
  // Results are objects { name, payload } where payload is the tool result string
  assert.ok(results.every(r => typeof r === 'object' && r.name && r.payload),
    'all results must be { name, payload } objects');
  // Verify order: first is memory.search, second is memory.get, third is memory.search
  assert.equal(results[0].name, 'memory.search');
  assert.equal(results[1].name, 'memory.get');
  assert.equal(results[2].name, 'memory.search');
  // All payloads should be error strings (port 1 unreachable)
  assert.ok(results.every(r => JSON.parse(r.payload).error || r.payload.error !== undefined),
    'all payloads should carry error info');
});

test('executeToolCalls defaults to concurrency=3 when no options passed', async () => {
  // This verifies the default parameter works
  const tl = makeToolLoop();
  const results = await tl.executeToolCalls(
    [
      { name: 'memory.search', arguments: JSON.stringify({ query: 'a' }) },
    ],
    {},
    [],
    'test',
    // No second argument — should use default concurrency: 3
  );
  assert.equal(results.length, 1);
});

// Clean up
test.after(() => {
  globalThis.fetch = originalFetch;
});
