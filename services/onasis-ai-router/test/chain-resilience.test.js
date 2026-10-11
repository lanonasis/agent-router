'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChainExecutor, VendorsExhaustedError } = require('../core/chain-executor');

// Measured live 2026-09-04, with every vendor in the chain failing at once:
// two out of credits, one on an expired upstream token, one timing out, one
// pointed at a model not installed on the host.
//
// Three things that outage exposed, covered here:
//   1. The preferred chain shrinking to one vendor produced a 500 while four
//      ejected vendors were never asked.
//   2. Vendor timeouts are per-CALL, so a chain of individually reasonable
//      waits still overran the caller's deadline.
//   3. "No vendor could serve this" surfaced as a 500 — indistinguishable to a
//      client from a request that can never work.

const silentLogger = { warn() {}, error() {}, info() {} };

// Mirrors VendorScoreboard's contract. orderChain() reproduces its fail-open
// rule — an empty live set yields the whole chain back — so escalation is
// exercised against the same ordering the service itself uses.
const scoreboardStub = ({ open = [], classes = {} } = {}) => ({
  isOpen: (id) => open.includes(id),
  orderChain: (chain) => {
    const live = chain.filter((v) => !open.includes(v._vendorId));
    return live.length > 0 ? live : chain.slice();
  },
  failureClass: (id) => classes[id] || null,
  recordSuccess() {},
  recordFailure() {},
});

// Fake vendors in the real chain's declared order, so ordering behaviour under
// test matches what the service actually does.
const CHAIN_ORDER = ['openclaw', 'minimax', 'openai', 'anthropic', 'ollama'];

const fakeChain = (behaviour) => CHAIN_ORDER.map((id) => ({
  _vendorId: id,
  _model: `${id}-model`,
  _adapter: { chat: (req, model) => behaviour(id, req, model) },
}));

const executorFor = (behaviour, scoreboard) => new ChainExecutor({
  scoreboard,
  logger: silentLogger,
  resolveChain: () => fakeChain(behaviour),
});

const run = (executor, opts = {}) => executor.run({
  useCase: 'ask-ai',
  messages: [{ role: 'user', content: 'q' }],
  promptBundle: { systemPromptForVendor: () => 'P' },
  temperature: 0.7,
  maxTokens: 100,
  ...opts,
});

test('a request that no vendor can serve raises a typed outage, not a generic error', async () => {
  const chain = executorFor(() => { throw new Error('upstream returned 429 — no credits'); }, scoreboardStub());
  await assert.rejects(
    () => run(chain),
    (err) => {
      assert.ok(err instanceof VendorsExhaustedError);
      assert.equal(err.code, 'ALL_VENDORS_UNAVAILABLE');
      assert.equal(err.status, 503, 'an outage is retryable; 500 says otherwise');
      return true;
    },
  );
});

test('the underlying vendor error is carried for the log, not the client', async () => {
  // Vendor messages name providers and their billing URLs. They belong in
  // journalctl, never in a response body.
  const chain = executorFor(() => { throw new Error('OpenAI adapter: platform.openai.com billing'); }, scoreboardStub());
  await assert.rejects(
    () => run(chain),
    (err) => {
      assert.match(err.cause.message, /platform\.openai\.com/);
      assert.doesNotMatch(err.message, /openai/i, 'the outage message itself must stay generic');
      return true;
    },
  );
});

test('an ejected vendor is tried once the preferred chain is exhausted', async () => {
  // The case that produced a 500 on 2026-09-04: one eligible vendor left, it
  // failed, and four ejected vendors were never asked.
  const open = ['openclaw', 'openai', 'anthropic', 'ollama'];
  const tried = [];
  const chain = executorFor((vendorId) => {
    tried.push(vendorId);
    if (vendorId === 'minimax') throw new Error('timed out');
    return { message: { role: 'assistant', content: 'recovered' } };
  }, scoreboardStub({ open }));
  const out = await run(chain);
  assert.equal(tried[0], 'minimax', 'the one live vendor is tried first');
  assert.ok(tried.length > 1, 'ejected vendors must be escalated to');
  assert.equal(out.adapterResponse.message.content, 'recovered');
});

test('a vendor that cannot recover inside this request is not escalated to', async () => {
  // An empty account will not refill mid-request. Retrying it spends the
  // caller's remaining time on a certainty.
  const tried = [];
  const chain = executorFor((vendorId) => {
    tried.push(vendorId);
    throw new Error('nope');
  }, scoreboardStub({
    open: ['openclaw', 'openai', 'anthropic', 'ollama'],
    classes: { openai: 'billing', anthropic: 'billing', openclaw: 'auth', ollama: 'transient' },
  }));
  await assert.rejects(() => run(chain));
  assert.ok(!tried.includes('openai'), 'billing-dead vendors must be skipped');
  assert.ok(!tried.includes('anthropic'), 'billing-dead vendors must be skipped');
  assert.ok(!tried.includes('openclaw'), 'auth-dead vendors must be skipped');
  assert.ok(tried.includes('ollama'), 'a transient failure is worth another attempt');
});

test('vendor attempts stop once the deadline has passed', async () => {
  // Leaving time to return a real error beats having the caller cut the
  // connection mid-flight.
  const tried = [];
  const chain = executorFor((vendorId) => {
    tried.push(vendorId);
    throw new Error('nope');
  }, scoreboardStub());
  await assert.rejects(() => run(chain, { deadlineAt: Date.now() - 1 }));
  assert.equal(tried.length, 0, 'no attempt should start with no time left');
});

test('a vendor call is capped by the remaining budget, not just its own timeout', async () => {
  let seenTimeout;
  const chain = executorFor((_id, req) => {
    seenTimeout = req.timeoutOverrideMs;
    return { message: { role: 'assistant', content: 'ok' } };
  }, scoreboardStub());
  await run(chain, { deadlineAt: Date.now() + 5000 });
  assert.ok(seenTimeout <= 5000,
    `attempt budget ${seenTimeout} must respect the 5s left, not the 30s vendor default`);
});

test('with no deadline the vendor keeps its configured timeout', async () => {
  // The deadline is an upper bound, not a new default.
  let seenTimeout = 'unset';
  const chain = executorFor((_id, req) => {
    seenTimeout = req.timeoutOverrideMs;
    return { message: { role: 'assistant', content: 'ok' } };
  }, scoreboardStub());
  await run(chain);
  assert.equal(seenTimeout, undefined, 'the primary vendor gets its full configured timeout');
});

test('the outage error reports how many vendors were actually attempted', async () => {
  const chain = executorFor(() => { throw new Error('nope'); }, scoreboardStub());
  await assert.rejects(
    () => run(chain),
    (err) => {
      assert.ok(err.attempted >= 5, `expected the whole chain, got ${err.attempted}`);
      return true;
    },
  );
});

test('failed vendor attempts emit failure and fallback events with correlation data', async () => {
  const events = [];
  const chain = executorFor((vendorId) => {
    if (vendorId === 'openclaw') throw new Error('timeout');
    return { message: { role: 'assistant', content: 'recovered' } };
  }, scoreboardStub());
  const out = await run(chain, {
    requestId: 'req-test-1',
    emitEvent: async (event) => events.push(event),
  });
  assert.equal(out.adapterResponse.message.content, 'recovered');
  assert.equal(events[0].kind, 'vendor_failure');
  assert.equal(events[0].requestId, 'req-test-1');
  assert.equal(events[0].vendor, 'openclaw');
  assert.equal(events[1].kind, 'fallback');
});
