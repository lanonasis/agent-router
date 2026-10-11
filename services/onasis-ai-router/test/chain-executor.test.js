'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertUsableCompletion } = require('../vendors/_shared/response-contract');

const SENTINELS = [/^⚠️\s*Agent couldn't generate a response/i];

// Minimal stand-ins for the two vendors that matter. Each mimics its real
// adapter: normalise the upstream body, then assert the contract.
const fakeOpenclaw = {
  _vendorId: 'openclaw',
  _adapter: {
    async chat() {
      return assertUsableCompletion(
        { message: { role: 'assistant', content: "⚠️ Agent couldn't generate a response. Please try again." },
          done_reason: 'stop', tool_calls: [] },
        { vendorId: 'openclaw', sentinels: SENTINELS },
      );
    },
  },
};

const fakeMinimax = {
  _vendorId: 'minimax',
  _adapter: {
    async chat() {
      return assertUsableCompletion(
        { message: { role: 'assistant', content: 'Paris.' }, done_reason: 'stop', tool_calls: [] },
        { vendorId: 'minimax', sentinels: undefined },
      );
    },
  },
};

// The chain contract under test: try each vendor, stop at the first that does
// not throw. This mirrors ChainExecutor.run()'s loop.
async function walk(chain) {
  let lastError;
  for (const vendor of chain) {
    try {
      return { content: (await vendor._adapter.chat()).message.content, vendorId: vendor._vendorId };
    } catch (err) { lastError = err; }
  }
  throw lastError;
}

test('a sentinel response does not end the chain — the next vendor answers', async () => {
  const out = await walk([fakeOpenclaw, fakeMinimax]);
  assert.equal(out.vendorId, 'minimax');
  assert.equal(out.content, 'Paris.');
  assert.equal(/Agent couldn't generate/.test(out.content), false,
    'the gateway error string must never reach the caller');
});

test('when every vendor violates the contract, the chain throws', async () => {
  await assert.rejects(() => walk([fakeOpenclaw]), /unusable|gateway error/i);
});

// ── Task 12: the executor reports outcomes to the scoreboard ────────────────
const { VendorScoreboard } = require('../core/vendor-scoreboard');

test('the executor records latency on success and the error on failure', async () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });

  // Simulate what ChainExecutor.run() must do around each attempt.
  const attempt = async (vendorId, fn) => {
    const t0 = clock;
    try { const r = await fn(); sb.recordSuccess(vendorId, clock - t0); return r; }
    catch (err) { sb.recordFailure(vendorId, err); throw err; }
  };

  await assert.rejects(() => attempt('openai', async () => {
    clock += 1000;
    throw new Error('upstream returned 429 — You have no credits remaining.');
  }));
  assert.equal(sb.isOpen('openai'), true, 'a billing failure must open the circuit immediately');

  for (let i = 0; i < 6; i++) {
    await attempt('minimax', async () => { clock += 2200; return 'ok'; });
  }
  assert.equal(sb.p95('minimax'), 2200);

  const ordered = sb.orderChain([{ _vendorId: 'openai' }, { _vendorId: 'minimax' }]);
  assert.deepEqual(ordered.map((v) => v._vendorId), ['minimax'],
    'the dead vendor is gone from the chain without any config edit');
});
