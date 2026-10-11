'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { VendorScoreboard } = require('../core/vendor-scoreboard');

test('circuit opens after threshold consecutive failures', () => {
  let clock = 1000;
  const sb = new VendorScoreboard({ now: () => clock });
  assert.equal(sb.isOpen('openclaw'), false);
  sb.recordFailure('openclaw');
  sb.recordFailure('openclaw');
  assert.equal(sb.isOpen('openclaw'), false, 'below threshold of 3');
  sb.recordFailure('openclaw');
  assert.equal(sb.isOpen('openclaw'), true, 'at threshold of 3');
});

test('circuit closes after the cooldown elapses', () => {
  let clock = 1000;
  const sb = new VendorScoreboard({ now: () => clock });
  sb.recordFailure('x'); sb.recordFailure('x'); sb.recordFailure('x');
  assert.equal(sb.isOpen('x'), true);
  clock += 30001;
  assert.equal(sb.isOpen('x'), false, 'past the 30s cooldown');
});

test('success decays the failure count by 2', () => {
  let clock = 1000;
  const sb = new VendorScoreboard({ now: () => clock });
  sb.recordFailure('y'); sb.recordFailure('y'); sb.recordFailure('y');
  assert.equal(sb.isOpen('y'), true);
  sb.recordSuccess('y');
  assert.equal(sb.isOpen('y'), false, 'failCount decayed 3 -> 1');
});

// ── Task 9: failure classification ──────────────────────────────────────────
const { classifyFailure } = require('../core/vendor-scoreboard');
const { VendorContractError } = require('../vendors/_shared/response-contract');

test('classifies real billing failures observed on this host', () => {
  // Verbatim from live probes, 2026-08-26.
  assert.equal(classifyFailure(new Error(
    'OpenAI adapter: upstream returned 429 — { "error": { "message": "You have no credits remaining."')), 'billing');
  assert.equal(classifyFailure(new Error(
    'Anthropic adapter: upstream returned 400 — {"error":{"message":"Your credit balance is too low to access the Anthropic API."')), 'billing');
});

test('classifies auth failures', () => {
  assert.equal(classifyFailure(new Error('adapter: upstream returned 401 — unauthorized')), 'auth');
  assert.equal(classifyFailure(new Error('adapter: upstream returned 403 — forbidden')), 'auth');
});

test('classifies contract violations', () => {
  assert.equal(
    classifyFailure(new VendorContractError('unusable', { vendorId: 'openclaw', reason: 'error_sentinel' })),
    'contract');
});

test('classifies everything else as transient', () => {
  assert.equal(classifyFailure(new Error('upstream returned 503 — service unavailable')), 'transient');
  assert.equal(classifyFailure(new Error('The operation was aborted due to timeout')), 'transient');
  assert.equal(classifyFailure(new Error('ECONNRESET')), 'transient');
});

test('a 429 that is NOT a credit problem is transient, not billing', () => {
  // MiniMax plan-exhaustion vs ordinary rate limiting must not be conflated:
  // one deserves an hours-long cooldown, the other seconds.
  assert.equal(classifyFailure(new Error('upstream returned 429 — Too Many Requests, slow down')), 'transient');
});

// ── Task 10: proportionate cooldowns ────────────────────────────────────────

test('a billing failure opens the circuit immediately and holds it for an hour', () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });
  sb.recordFailure('openai', new Error('upstream returned 429 — You have no credits remaining.'));
  assert.equal(sb.isOpen('openai'), true, 'one billing failure is enough — no threshold');
  clock += 59 * 60 * 1000;
  assert.equal(sb.isOpen('openai'), true, 'still open at 59 minutes');
  clock += 2 * 60 * 1000;
  assert.equal(sb.isOpen('openai'), false, 'closed just past the 1h base cooldown');
});

test('repeat billing failures back off exponentially, capped at 12h', () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });
  const billing = () => new Error('insufficient_quota');
  for (let i = 0; i < 10; i++) { sb.recordFailure('openai', billing()); }
  clock += 11 * 3600 * 1000;
  assert.equal(sb.isOpen('openai'), true, 'still open at 11h');
  clock += 2 * 3600 * 1000;
  assert.equal(sb.isOpen('openai'), false, 'capped at 12h, not longer');
});

test('a contract failure counts AGAINST the vendor (D4 regression guard)', () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });
  const contract = () => new VendorContractError('unusable', { vendorId: 'openclaw', reason: 'error_sentinel' });
  sb.recordFailure('openclaw', contract());
  sb.recordFailure('openclaw', contract());
  assert.equal(sb.isOpen('openclaw'), true, 'two contract violations open the circuit');
});

test('transient failures keep the original forgiving behaviour', () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });
  const t = () => new Error('upstream returned 503');
  sb.recordFailure('minimax', t());
  sb.recordFailure('minimax', t());
  assert.equal(sb.isOpen('minimax'), false, 'below the threshold of 3');
  sb.recordFailure('minimax', t());
  assert.equal(sb.isOpen('minimax'), true);
  clock += 30_001;
  assert.equal(sb.isOpen('minimax'), false, '30s cooldown, unchanged');
});

// ── Task 11: latency tracking and tail demotion ─────────────────────────────
const link = (id) => ({ _vendorId: id });

test('orderChain drops vendors whose circuit is open', () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });
  sb.recordFailure('openai', new Error('insufficient_quota'));
  const out = sb.orderChain([link('openai'), link('minimax')]);
  assert.deepEqual(out.map((v) => v._vendorId), ['minimax']);
});

test('orderChain preserves declared order when nothing is degraded', () => {
  const sb = new VendorScoreboard({ now: () => 1 });
  const out = sb.orderChain([link('openclaw'), link('minimax'), link('ollama')]);
  assert.deepEqual(out.map((v) => v._vendorId), ['openclaw', 'minimax', 'ollama']);
});

test('a vendor with a slow tail is demoted below a healthy alternative', () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });
  // openclaw: measured p50 ~3.4s but a 41.5s tail (live, 2026-08-26).
  for (const ms of [3000, 3200, 3400, 3600, 3800, 4000, 10000, 16000, 41500, 41500]) {
    sb.recordSuccess('openclaw', ms);
  }
  for (const ms of [1000, 2000, 2100, 2200, 2300, 3500, 4500]) {
    sb.recordSuccess('minimax', ms);
  }
  const out = sb.orderChain([link('openclaw'), link('minimax')]);
  assert.deepEqual(out.map((v) => v._vendorId), ['minimax', 'openclaw'],
    'openclaw p95 exceeds 15s while minimax stays below it');
});

test('demotion needs a healthy alternative — a lone slow vendor still runs', () => {
  const sb = new VendorScoreboard({ now: () => 1 });
  for (let i = 0; i < 10; i++) sb.recordSuccess('openclaw', 41500);
  const out = sb.orderChain([link('openclaw')]);
  assert.deepEqual(out.map((v) => v._vendorId), ['openclaw'],
    'a slow vendor beats no vendor');
});

// ── Finding #6: transient escalation and timeout-aware tail demotion ────────
// Both gaps were observed live on the `memory-analysis` lane (2026-08-27):
// OpenClaw timed out at 30s repeatedly, and roughly every 30s one request paid
// the full timeout again to re-probe a vendor already known to be dead.

test('transient cooldown escalates beyond the base interval', () => {
  let clock = 1000;
  const sb = new VendorScoreboard({ now: () => clock });
  // Threshold is 3; each failure past it doubles the cooldown.
  sb.recordFailure('openclaw'); sb.recordFailure('openclaw'); sb.recordFailure('openclaw');
  clock += 30001;
  assert.equal(sb.isOpen('openclaw'), false, 'first cooldown is still the 30s base');

  // A fourth failure must buy more than another flat 30s, otherwise the vendor
  // is re-probed at a fixed interval forever.
  sb.recordFailure('openclaw');
  clock += 30001;
  assert.equal(sb.isOpen('openclaw'), true, 'second cooldown must exceed the 30s base');
});

test('transient cooldown is capped so a vendor can always recover', () => {
  let clock = 1000;
  const sb = new VendorScoreboard({ now: () => clock });
  for (let i = 0; i < 40; i += 1) sb.recordFailure('openclaw');
  clock += 5 * 60 * 1000 + 1;
  assert.equal(sb.isOpen('openclaw'), false, 'capped at 5 minutes, not unbounded');
});

test('a transient failure records its latency so tail demotion can see it', () => {
  const sb = new VendorScoreboard({ now: () => 1000 });
  // Five 30s timeouts: the vendor never succeeds, so success-only sampling
  // would leave p95 at null and orderChain would never demote it.
  for (let i = 0; i < 5; i += 1) sb.recordFailure('openclaw', new Error('This operation was aborted'), 30000);
  assert.equal(sb.p95('openclaw'), 30000, 'timeout duration is real user-visible wait');
});

test('a fast auth failure is not recorded as a latency sample', () => {
  const sb = new VendorScoreboard({ now: () => 1000 });
  // A 50ms 401 says nothing about how fast the vendor answers; counting it
  // would make a dead vendor look like the fastest option in the chain.
  for (let i = 0; i < 5; i += 1) sb.recordFailure('openai', new Error('upstream returned 401 unauthorized'), 50);
  assert.equal(sb.p95('openai'), null, 'no latency samples from non-transient failures');
});

test('orderChain demotes a vendor that only ever times out', () => {
  let clock = 1000;
  const sb = new VendorScoreboard({ now: () => clock });
  for (let i = 0; i < 5; i += 1) sb.recordSuccess('minimax', 1500);
  for (let i = 0; i < 5; i += 1) sb.recordFailure('openclaw', new Error('This operation was aborted'), 30000);
  // Let the circuit close again: ordering only matters once the vendor is
  // eligible, and without a latency sample it would return at the head of the
  // chain and cost another full timeout.
  clock += 10 * 60 * 1000;
  assert.equal(sb.isOpen('openclaw'), false, 'precondition: circuit reopened');
  const chain = [{ _vendorId: 'openclaw' }, { _vendorId: 'minimax' }];
  assert.deepEqual(sb.orderChain(chain).map((v) => v._vendorId), ['minimax', 'openclaw']);
});

// ── Failures that follow a success in the SAME request ──────────────────────
//
// Measured live 2026-09-04. openclaw's first pass (choose a tool) succeeded in
// seconds on every request; its synthesis pass (read the tool result back) hung
// to the 30s timeout on every request. Recorded at weight 1 that nets -1 per
// request against the success decay, so a vendor failing 100% of the work that
// actually produces the answer stayed at the head of the chain indefinitely.

const { SAME_REQUEST_FAILURE_WEIGHT } = require('../core/vendor-scoreboard');

test('an unweighted failure after a same-request success never opens the circuit', () => {
  // Documents the behaviour that made the live defect invisible.
  const sb = new VendorScoreboard({ now: () => 1000 });
  for (let i = 0; i < 20; i++) {
    sb.recordSuccess('openclaw', 3000);   // first pass: chose a tool
    sb.recordFailure('openclaw', new Error('This operation was aborted'), 30000);
  }
  assert.equal(sb.isOpen('openclaw'), false);
});

test('the same-request weight lets a synthesis-only failure open the circuit', () => {
  const sb = new VendorScoreboard({ now: () => 1000 });
  for (let i = 0; i < 3; i++) {
    sb.recordSuccess('openclaw', 3000);
    sb.recordFailure('openclaw', new Error('This operation was aborted'), 30000,
      { weight: SAME_REQUEST_FAILURE_WEIGHT });
  }
  assert.equal(sb.isOpen('openclaw'), true, 'three failed requests must be enough');
});

test('a vendor that recovers still closes its circuit', () => {
  // The weight must not strand a vendor that starts working again.
  let clock = 1000;
  const sb = new VendorScoreboard({ now: () => clock });
  for (let i = 0; i < 3; i++) {
    sb.recordSuccess('openclaw', 3000);
    sb.recordFailure('openclaw', new Error('This operation was aborted'), 30000,
      { weight: SAME_REQUEST_FAILURE_WEIGHT });
  }
  assert.equal(sb.isOpen('openclaw'), true);
  clock += 300001;
  assert.equal(sb.isOpen('openclaw'), false, 'cooldown must still expire');
  // Two healthy requests (two recorded successes each) clear the residue.
  for (let i = 0; i < 4; i++) sb.recordSuccess('openclaw', 3000);
  assert.equal(sb.isOpen('openclaw'), false);
});

test('the weight is derived from the decay, not hardcoded', () => {
  // If SUCCESS_DECAY changes, a literal here would silently stop compensating.
  assert.ok(SAME_REQUEST_FAILURE_WEIGHT > 2,
    'must exceed the success decay or same-request failures net negative');
});

test('weight never falls below one', () => {
  const sb = new VendorScoreboard({ now: () => 1000 });
  for (let i = 0; i < 3; i++) sb.recordFailure('y', new Error('boom'), 10, { weight: 0 });
  assert.equal(sb.isOpen('y'), true, 'a zero weight must not disable the breaker');
});


test('a chain with every circuit open still returns candidates', () => {
  // Fail open: with no healthy alternative to steer towards, skipping every
  // vendor guarantees a failure where an attempt might still succeed.
  const sb = new VendorScoreboard({ now: () => 1000 });
  const chain = [{ _vendorId: 'a' }, { _vendorId: 'b' }];
  for (const id of ['a', 'b']) {
    for (let i = 0; i < 3; i++) sb.recordFailure(id, new Error('boom'), 10);
  }
  assert.equal(sb.isOpen('a'), true);
  assert.equal(sb.isOpen('b'), true);
  assert.deepEqual(sb.orderChain(chain).map((v) => v._vendorId), ['a', 'b'],
    'declared preference order is preserved');
});

test('one healthy vendor still excludes the open ones', () => {
  // Failing open must not weaken the breaker while an alternative exists.
  const sb = new VendorScoreboard({ now: () => 1000 });
  const chain = [{ _vendorId: 'a' }, { _vendorId: 'b' }];
  for (let i = 0; i < 3; i++) sb.recordFailure('a', new Error('boom'), 10);
  assert.deepEqual(sb.orderChain(chain).map((v) => v._vendorId), ['b']);
});

test('an empty chain stays empty', () => {
  const sb = new VendorScoreboard({ now: () => 1000 });
  assert.deepEqual(sb.orderChain([]), []);
});
