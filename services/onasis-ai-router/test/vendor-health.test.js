'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { VendorHealthMonitor } = require('../core/vendor-health');

// Measured live 2026-09-04: /health reported "healthy", vendors 5/5 while every
// vendor was failing real requests — two out of credits, one on an expired
// upstream token, one timing out, one pointed at a model not installed on the
// host. Every probe but MiniMax's asked whether the vendor was REACHABLE, which
// stayed true throughout. The service could not tell anyone it was broken.

const silentLogger = { warn() {}, info() {}, error() {} };

const vendor = (impl, models = { lana: 'm' }) => ({
  status: 'active',
  models,
  adapter: { chat: impl },
});

const okVendor = () => vendor(async () => ({ message: { role: 'assistant', content: 'pong' } }));
const deadVendor = (msg) => vendor(async () => { throw new Error(msg); });

const monitor = (registry, over = {}) => new VendorHealthMonitor({
  registry, logger: silentLogger, ...over,
});

test('a vendor that cannot complete a request is unhealthy', async () => {
  const m = monitor({
    openai: deadVendor('OpenAI adapter: upstream returned 429 — You have no credits remaining.'),
  });
  const snap = await m.snapshot();
  assert.equal(snap.openai.status, 'unhealthy');
});

test('the reason survives to the operator', async () => {
  // Vendor identity stays internal, but someone reading /health at 3am needs to
  // know it is billing and not a network blip.
  const m = monitor({ openai: deadVendor('upstream returned 429 — You have no credits remaining.') });
  const snap = await m.snapshot();
  assert.match(snap.openai.reason, /no credits remaining/);
});

test('a working vendor is healthy and timed', async () => {
  const m = monitor({ ollama: okVendor() });
  const snap = await m.snapshot();
  assert.equal(snap.ollama.status, 'healthy');
  assert.equal(typeof snap.ollama.response_time, 'number');
});

test('the probe uses the model a real request would get', async () => {
  // Naming a model the host does not have is the exact misconfiguration this
  // must surface (OLLAMA_MODEL=coda, 2026-09-04). Probing some other model
  // would sail straight through it.
  let seenModel;
  const m = monitor({
    ollama: vendor(async (_req, model) => { seenModel = model; return { message: {} }; },
      { lana: 'qwen2.5-coder-ops:latest' }),
  });
  await m.snapshot();
  assert.equal(seenModel, 'qwen2.5-coder-ops:latest');
});

test('the probe goes through chat(), the path real traffic uses', async () => {
  // A probe against a different endpoint can only ever proxy for the truth.
  let seenReq;
  const m = monitor({ ollama: vendor(async (req) => { seenReq = req; return { message: {} }; }) });
  await m.snapshot();
  assert.ok(Array.isArray(seenReq.messages) && seenReq.messages.length > 0);
  // The ceiling must clear a reasoning model's preamble. Measured against
  // MiniMax on 2026-09-04: 16 tokens returned incomplete_turn, 64 returned
  // "ok". A probe that fails on a WORKING vendor breaks trust just as badly as
  // one that passes on a broken one.
  assert.ok(seenReq.maxTokens >= 64 && seenReq.maxTokens <= 512,
    'probe must be able to finish a turn, and stay cheap');
  assert.ok(Number.isFinite(seenReq.timeoutOverrideMs), 'a probe must not hang');
});

test('an open circuit overrides a passing probe', async () => {
  // The probe is synthetic; the circuit reflects what real traffic got. When
  // they disagree, real traffic wins — otherwise the outage hides again.
  const scoreboard = { isOpen: (id) => id === 'openclaw' };
  const m = monitor({ openclaw: okVendor(), ollama: okVendor() }, { scoreboard });
  const snap = await m.snapshot();
  assert.equal(snap.openclaw.status, 'unhealthy');
  assert.equal(snap.openclaw.circuit, 'open');
  assert.ok(snap.openclaw.reason, 'an open circuit must explain itself');
  assert.equal(snap.ollama.status, 'healthy');
});

test('results are cached rather than re-probed per call', async () => {
  let calls = 0;
  const m = monitor({ ollama: vendor(async () => { calls++; return { message: {} }; }) });
  await m.snapshot();
  await m.snapshot();
  await m.snapshot();
  assert.equal(calls, 1, 'a monitoring poll must not bill a paid vendor every time');
});

test('a stale cache is served immediately while it refreshes', async () => {
  // A health endpoint that blocks on a slow vendor becomes its own outage.
  let clock = 1000;
  let release;
  const gate = new Promise((r) => { release = r; });
  let calls = 0;
  const m = monitor(
    { slow: vendor(async () => { calls++; if (calls > 1) await gate; return { message: {} }; }) },
    { now: () => clock },
  );
  await m.snapshot();
  clock += 120000;                       // past the TTL
  const snap = await m.snapshot();       // must not wait on the hanging refresh
  assert.equal(snap.slow.status, 'healthy');
  assert.equal(snap.slow.stale, true, 'staleness is disclosed, not hidden');
  release();
});

test('concurrent refreshes collapse into one', async () => {
  let calls = 0;
  const m = monitor({ ollama: vendor(async () => { calls++; return { message: {} }; }) });
  await Promise.all([m.refresh(), m.refresh(), m.refresh()]);
  assert.equal(calls, 1);
});

test('a vendor dropped from the registry stops being reported', async () => {
  const registry = { ollama: okVendor(), openai: okVendor() };
  const m = monitor(registry);
  await m.refresh();
  delete registry.openai;
  const snap = await m.refresh();
  assert.deepEqual(Object.keys(snap), ['ollama'],
    'a removed vendor must not be reported healthy forever');
});

test('inactive vendors are not probed', async () => {
  let calls = 0;
  const m = monitor({
    retired: { status: 'inactive', models: { lana: 'm' }, adapter: { chat: async () => { calls++; } } },
  });
  const snap = await m.snapshot();
  assert.equal(calls, 0);
  assert.deepEqual(snap, {});
});

test('a cold cache that cannot refresh degrades to empty, not a throw', async () => {
  // summariseHealth() reads no vendors as "unavailable" -> 503, which is the
  // honest answer. Throwing here would take the health endpoint itself down.
  const m = new VendorHealthMonitor({
    registry: null, logger: silentLogger,
  });
  m.refresh = async () => { throw new Error('exploded'); };
  assert.deepEqual(await m.snapshot(), {});
});
