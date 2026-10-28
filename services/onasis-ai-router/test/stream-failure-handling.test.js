'use strict';

// Streaming-path regression tests for ChainExecutor.stream().
//
// These cover the failure modes that a buffered-path test cannot see:
//
//   1. A vendor that throws BEFORE any content — fallback to the next vendor
//      must still work. (The `gotContent`/`gotChunk`/`streamStart` flags used
//      to be declared inside `try {}`, so every failure threw a
//      ReferenceError from inside the `catch` and fallback was dead.)
//   2. A vendor that throws AFTER content — the chain must stop, never
//      re-stream from the next vendor, because SSE has no retract primitive.
//   3. Every streaming failure must reach the scoreboard, including the
//      mid-content case. A vendor that reliably dies mid-answer must be
//      demoted, not left at the head of the chain forever.
//   4. The client-facing error must not name the vendor.
//   5. The recorded latency must be real, not 0 — a 0ms failure scores as the
//      fastest vendor and gets promoted.
//
// No network, no real timers, no live vendors.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ChainExecutor } = require('../core/chain-executor');

const silentLogger = { warn() {}, error() {}, info() {} };

/** A scoreboard that records what it was told. */
function recordingScoreboard() {
  const failures = [];
  const successes = [];
  return {
    failures,
    successes,
    orderChain(chain) { return chain; },
    recordSuccess(vendorId, durationMs) { successes.push({ vendorId, durationMs }); },
    recordFailure(vendorId, err, durationMs) { failures.push({ vendorId, err, durationMs }); },
  };
}

/** A vendor whose chatStream yields the given chunks, then optionally throws. */
function stubVendor(vendorId, chunks, { throwAfter = null, delayMs = 0 } = {}) {
  return {
    _vendorId: vendorId,
    _model: `test-model-${vendorId}`,
    _adapter: {
      async *chatStream() {
        // Delay before the first chunk so a failure has a measurable elapsed time.
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        for (const chunk of chunks) {
          yield chunk;
        }
        if (throwAfter) throw throwAfter;
      },
    },
  };
}

/** Minimal prompt bundle — the executor only needs systemPromptForVendor. */
const promptBundle = {
  systemPromptForVendor() { return 'system prompt'; },
};

async function collect(gen) {
  const out = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

test('a vendor that fails before any content falls back to the next vendor', async () => {
  const scoreboard = recordingScoreboard();
  const failing = stubVendor('vendorA', [], { throwAfter: new Error('boom') });
  const healthy = stubVendor('vendorB', [{ content: 'hello' }]);

  const chain = new ChainExecutor({
    scoreboard,
    logger: silentLogger,
    resolveChain: () => [failing, healthy],
  });

  const chunks = await collect(chain.stream({ useCase: 'ask-ai', messages: [], promptBundle }));

  const text = chunks.map((c) => c.content || '').join('');
  assert.equal(text, 'hello', 'the healthy vendor should have answered');
  assert.equal(scoreboard.failures.length, 1, 'the failing vendor must be recorded');
  assert.equal(scoreboard.failures[0].vendorId, 'vendorA');
});

test('a vendor that fails after content stops the chain without re-streaming', async () => {
  const scoreboard = recordingScoreboard();
  const halfWay = stubVendor(
    'vendorA',
    [{ content: 'The capital is Pa' }],
    { throwAfter: new Error('died mid-answer') },
  );
  const second = stubVendor('vendorB', [{ content: 'The capital is Paris.' }]);

  const chain = new ChainExecutor({
    scoreboard,
    logger: silentLogger,
    resolveChain: () => [halfWay, second],
  });

  const chunks = await collect(chain.stream({ useCase: 'ask-ai', messages: [], promptBundle }));

  const text = chunks.map((c) => c.content || '').join('');
  assert.equal(text, 'The capital is Pa', 'only the first vendor content should be emitted');
  assert.ok(
    !text.includes('Paris'),
    'the second vendor must not re-stream — SSE has no retract primitive',
  );
});

test('a mid-content failure is still recorded on the scoreboard', async () => {
  const scoreboard = recordingScoreboard();
  const halfWay = stubVendor(
    'vendorA',
    [{ content: 'partial' }],
    { throwAfter: new Error('died mid-answer') },
  );

  const chain = new ChainExecutor({
    scoreboard,
    logger: silentLogger,
    resolveChain: () => [halfWay],
  });

  await collect(chain.stream({ useCase: 'ask-ai', messages: [], promptBundle }));

  assert.equal(
    scoreboard.failures.length,
    1,
    'a vendor that dies mid-answer must be demoted, not left at the head of the chain',
  );
  assert.equal(scoreboard.failures[0].vendorId, 'vendorA');
});

test('the client-facing error never names the vendor', async () => {
  const scoreboard = recordingScoreboard();
  const halfWay = stubVendor(
    'openclaw',
    [{ content: 'partial' }],
    { throwAfter: new Error('died mid-answer') },
  );

  const chain = new ChainExecutor({
    scoreboard,
    logger: silentLogger,
    resolveChain: () => [halfWay],
  });

  const chunks = await collect(chain.stream({ useCase: 'ask-ai', messages: [], promptBundle }));

  const errorChunk = chunks.find((c) => c.error);
  assert.ok(errorChunk, 'expected an error chunk');
  assert.ok(
    !errorChunk.error.includes('openclaw'),
    `client-facing error leaked the vendor id: ${errorChunk.error}`,
  );
  assert.ok(
    !/vendor|openclaw|anthropic|minimax/i.test(errorChunk.error),
    `client-facing error leaked vendor identity: ${errorChunk.error}`,
  );
});

test('a streaming failure records a real latency, not zero', async () => {
  const scoreboard = recordingScoreboard();
  const failing = stubVendor('vendorA', [{ content: 'partial' }], {
    throwAfter: new Error('boom'),
    delayMs: 25,
  });

  const chain = new ChainExecutor({
    scoreboard,
    logger: silentLogger,
    resolveChain: () => [failing],
  });

  await collect(chain.stream({ useCase: 'ask-ai', messages: [], promptBundle }));

  assert.equal(scoreboard.failures.length, 1);
  const { durationMs } = scoreboard.failures[0];
  assert.ok(
    typeof durationMs === 'number' && durationMs > 0,
    `expected a real latency, got ${durationMs} — a 0ms failure scores as the fastest vendor`,
  );
});

test('budget exhaustion reports finish_reason length, not stop', async () => {
  const scoreboard = recordingScoreboard();
  const vendor = stubVendor('vendorA', [{ content: 'never reached' }]);

  const chain = new ChainExecutor({
    scoreboard,
    logger: silentLogger,
    resolveChain: () => [vendor],
  });

  // A deadline already in the past means there is no budget to attempt a vendor.
  const chunks = await collect(
    chain.stream({
      useCase: 'ask-ai',
      messages: [],
      promptBundle,
      deadlineAt: Date.now() - 1000,
    }),
  );

  const finish = chunks.find((c) => c.finish_reason);
  assert.ok(finish, 'expected a finish marker');
  assert.equal(
    finish.finish_reason,
    'length',
    'a truncated stream must not be reported as a clean finish',
  );
  assert.equal(finish.truncated, true);
});

test('a successful stream reports finish_reason stop', async () => {
  const scoreboard = recordingScoreboard();
  const vendor = stubVendor('vendorA', [{ content: 'complete' }]);

  const chain = new ChainExecutor({
    scoreboard,
    logger: silentLogger,
    resolveChain: () => [vendor],
  });

  const chunks = await collect(chain.stream({ useCase: 'ask-ai', messages: [], promptBundle }));

  const finish = chunks.find((c) => c.finish_reason);
  assert.ok(finish, 'expected a finish marker');
  assert.equal(finish.finish_reason, 'stop');
  assert.equal(scoreboard.successes.length, 1, 'a clean stream must be recorded as a success');
});
