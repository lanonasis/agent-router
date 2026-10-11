'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChainExecutor } = require('../core/chain-executor');

// `exclude` exists so the synthesis pass can retry somewhere other than the
// vendor that just failed it. Without it the retry re-selects the same vendor
// at the head of the chain and pays its timeout again — which, for a vendor
// that is hung rather than slow (openclaw, 2026-09-04), is the entire cost and
// none of the benefit.

const silentLogger = { warn() {}, error() {}, info() {} };

// Captures what orderChain() is handed, then short-circuits so no adapter runs.
const captureScoreboard = () => {
  const seen = [];
  return {
    seen,
    orderChain(chain) { seen.push(chain.map((v) => v._vendorId)); return []; },
    recordSuccess() {}, recordFailure() {},
  };
};

test('the excluded vendor never reaches vendor ordering', async () => {
  const scoreboard = captureScoreboard();
  const chain = new ChainExecutor({ scoreboard, logger: silentLogger });
  await assert.rejects(() => chain.run({ useCase: 'ask-ai', exclude: ['openclaw'] }));
  assert.ok(scoreboard.seen.length === 1, 'orderChain should be called once');
  assert.ok(!scoreboard.seen[0].includes('openclaw'), 'openclaw must be filtered out');
  assert.ok(scoreboard.seen[0].length > 0, 'the rest of the chain must survive');
});

test('no exclusion leaves the declared chain untouched', async () => {
  const scoreboard = captureScoreboard();
  const chain = new ChainExecutor({ scoreboard, logger: silentLogger });
  await assert.rejects(() => chain.run({ useCase: 'ask-ai' }));
  assert.ok(scoreboard.seen[0].includes('openclaw'));
});

test('an exclusion that empties the chain is not reported as a misconfiguration', async () => {
  // "Nothing else to try" has a defined answer upstream (render the tool
  // results). Logging it as an outage would bury real vendor failures.
  // Derived from the live chain rather than hardcoded: a hardcoded list silently
  // stops exhausting the chain the moment a vendor is added, and the test then
  // spawns whatever the new one is instead of asserting on the empty case.
  const { resolveVendorChainForUseCase } = require('../vendors');
  const all = resolveVendorChainForUseCase('ask-ai').map((v) => v._vendorId);
  const levels = [];
  const logger = {
    warn(msg) { levels.push(['warn', msg]); },
    error(msg) { levels.push(['error', msg]); },
    info() {},
  };
  const chain = new ChainExecutor({
    scoreboard: { orderChain: (c) => c, recordSuccess() {}, recordFailure() {} },
    logger,
  });
  await assert.rejects(
    () => chain.run({ useCase: 'ask-ai', exclude: all }),
    /No alternative AI vendor available/,
  );
  assert.deepEqual(levels.map((l) => l[0]), ['warn'], 'must not log at error');
});

test('a genuinely empty configuration is still an error', async () => {
  const levels = [];
  const logger = { warn() {}, error(msg) { levels.push(msg); }, info() {} };
  const chain = new ChainExecutor({
    scoreboard: { orderChain: () => [], recordSuccess() {}, recordFailure() {} },
    logger,
  });
  await assert.rejects(
    () => chain.run({ useCase: 'ask-ai' }),
    /No active AI vendor available/,
  );
  assert.equal(levels.length, 1, 'a real misconfiguration must still log at error');
});
