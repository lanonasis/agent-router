'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const AIServiceRouter = require('../core/ai-service-router');
const { USE_CASES, VENDOR_REGISTRY } = require('../vendors');
const { buildCatalog, validateProfile, aggregateLaneStats } = require('../core/catalog');

const l0 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'profiles', 'l0-concierge.json'), 'utf8'));
const KNOWN = ['memory.search', 'memory.list', 'memory.get', 'memory.write', 'code.read'];
const READ_ONLY = ['memory.search', 'memory.list', 'memory.get'];

function catalogDeps(over = {}) {
  return {
    useCases: USE_CASES,
    laneInfo: (uc) => ({ role: 'researcher', laneKey: USE_CASES[uc].systemPromptKey }),
    toolsForUseCase: (uc) => (uc === 'tool-proxy' ? [] : READ_ONLY),
    declaredVendors: () => ['a', 'b', 'c'],
    eligibleVendors: () => ['a', 'b', 'c'],
    isUnhealthy: () => false,
    profiles: [l0],
    knownTools: KNOWN,
    now: () => new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

const vDeps = () => ({
  useCases: USE_CASES,
  knownTools: KNOWN,
  toolsForUseCase: (uc) => (uc === 'tool-proxy' ? [] : READ_ONLY),
  writesAllowed: (uc) => uc === 'repl-nlp',
});

// ── catalog ─────────────────────────────────────────────────────────────────

test('catalog has one persona per use case, with no tools on tool-proxy', () => {
  const c = buildCatalog(catalogDeps());
  assert.deepEqual(c.personas.map((p) => p.useCase), Object.keys(USE_CASES));
  assert.deepEqual(c.personas.find((p) => p.useCase === 'tool-proxy').tools, []);
  assert.equal(c.generatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(c.profiles[0].profileId, 'l0-concierge');
  assert.deepEqual(Object.keys(c.profiles[0]).sort(),
    ['allowedTools', 'applicationId', 'boundUseCase', 'memoryMode', 'profileId', 'status', 'version']);
});

test('status derives from injected health', () => {
  const st = (over) => buildCatalog(catalogDeps(over)).personas[0];
  assert.equal(st({}).status, 'active');
  assert.deepEqual(st({ isUnhealthy: (id) => id === 'b' }).servingCapacity, { available: 2, declared: 3 });
  assert.equal(st({ isUnhealthy: (id) => id === 'b' }).status, 'degraded');
  assert.equal(st({ eligibleVendors: () => ['a', 'b'] }).status, 'degraded');
  assert.equal(st({ isUnhealthy: () => true }).status, 'unavailable');
  assert.equal(st({ eligibleVendors: () => [] }).status, 'unavailable');
});

test('live catalog JSON never contains a vendor id or model name', () => {
  const router = new AIServiceRouter({ authGatewayUrl: 'http://127.0.0.1:1' });
  const raw = JSON.stringify(router.buildServiceCatalog());
  const json = raw.toLowerCase();
  const forbidden = new Set(Object.keys(VENDOR_REGISTRY));
  const walk = (v) => {
    if (typeof v === 'string') { if (v.length > 3) forbidden.add(v); } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const cfg of Object.values(VENDOR_REGISTRY)) walk(cfg.models);
  for (const f of forbidden) {
    if (/^(ollama|pi)$/.test(f)) continue; // handled below with word boundaries
    assert.ok(!json.includes(f.toLowerCase()), `catalog leaks '${f}'`);
  }
  for (const id of Object.keys(VENDOR_REGISTRY)) {
    assert.ok(!new RegExp(`"${id}"`, 'i').test(json), `catalog has quoted vendor '${id}'`);
  }
  const live = JSON.parse(raw);
  assert.equal(live.personas.length, Object.keys(USE_CASES).length);
  assert.ok(live.knownTools.includes('memory.search'));
  assert.ok(live.knownTools.includes('code.read'));
});

// ── validate ────────────────────────────────────────────────────────────────

test('l0-concierge manifest validates and is returned normalised', () => {
  const { status, result } = validateProfile(l0, vDeps());
  assert.equal(status, 200);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.normalised, l0);
});

test('unknown use case and unknown tool are errors', () => {
  const { result } = validateProfile({ ...l0, boundUseCase: 'nope', allowedTools: ['memory.search', 'bogus.tool'] }, vDeps());
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /boundUseCase/.test(e)));
  assert.ok(result.errors.some((e) => /bogus\.tool/.test(e)));
  assert.equal(result.normalised, undefined);
});

test('tool not offered on the bound lane is a warning, not an error', () => {
  const { result } = validateProfile({ ...l0, allowedTools: ['memory.write'] }, vDeps());
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => /ceiling; memory\.write is not offered on dashboard-assistant/.test(w)));
  assert.ok(result.warnings.some((w) => /does not permit memory writes/.test(w)));
});

test('output-token and public-model warnings', () => {
  const m = { ...l0, publicModel: 'other', limits: { ...l0.limits, maxOutputTokens: USE_CASES['dashboard-assistant'].maxTokens + 1 } };
  const { result } = validateProfile(m, vDeps());
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => /maxOutputTokens/.test(w)));
  assert.ok(result.warnings.some((w) => /publicModel/.test(w)));
});

test('missing fields and system roles are errors; non-objects are 400', () => {
  const { result } = validateProfile({ boundUseCase: 'ask-ai' }, vDeps());
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /missing/.test(e)));
  assert.equal(validateProfile({ ...l0, allowedMessageRoles: ['system'] }, vDeps()).result.valid, false);
  for (const bad of [null, undefined, 'x', 3, [], [l0]]) {
    const r = validateProfile(bad, vDeps());
    assert.equal(r.status, 400);
    assert.equal(r.result.valid, false);
    assert.equal(r.result.errors.length, 1);
  }
});

// ── lane stats ──────────────────────────────────────────────────────────────

test('lane stats aggregate success rate, avg, p95, unknown bucket, in-progress excluded', () => {
  const e = (useCase, status, durationMs, startedAt) => ({ useCase, status, durationMs, startedAt });
  const entries = [];
  for (let i = 1; i <= 20; i += 1) entries.push(e('ask-ai', 'completed', i * 10, `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`));
  entries.push(e('ask-ai', 'recovered', 500, '2026-01-01T01:00:00Z'));
  entries.push(e('ask-ai', 'failed', null, '2026-01-01T00:30:00Z'));
  entries.push(e('ask-ai', 'in_progress', null, '2026-01-01T02:00:00Z'));
  entries.push(e(null, 'completed', 100, '2026-01-01T00:00:00Z'));
  const lanes = aggregateLaneStats(entries);
  assert.deepEqual(lanes.map((l) => l.useCase), ['ask-ai', 'unknown']);
  const a = lanes[0];
  assert.equal(a.total, 23);
  assert.equal(a.completed, 20);
  assert.equal(a.recovered, 1);
  assert.equal(a.failed, 1);
  assert.equal(a.inProgress, 1);
  assert.equal(a.successRate, 21 / 22);
  // finished latencies: 10..200 step 10 plus 500 -> 21 values, sum 2100+500=2600
  assert.equal(a.avgLatencyMs, Math.round(2600 / 21));
  assert.equal(a.p95LatencyMs, 200); // ceil(.95*21)=20th of sorted => 200
  assert.equal(a.lastSeenAt, '2026-01-01T02:00:00Z');
  assert.equal(lanes[1].successRate, 1);
  const only = aggregateLaneStats([e('x', 'in_progress', null, '2026-01-01T00:00:00Z')])[0];
  assert.equal(only.successRate, null);
  assert.equal(only.avgLatencyMs, null);
  assert.equal(only.p95LatencyMs, null);
});

// ── HTTP ────────────────────────────────────────────────────────────────────

test('HTTP: catalog and validate are public, lane-stats requires auth and is org-scoped', async (t) => {
  const authServer = http.createServer((req, res) => {
    if (req.headers['x-api-key'] === 'lano_catalog') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ authId: 'a1', organizationId: 'org-1', authMethod: 'api_key' }));
    }
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end('{"error":"invalid"}');
  });
  const listen = (s) => new Promise((ok, no) => { s.once('error', no); s.listen(0, '127.0.0.1', () => ok(s.address())); });
  let authAddr;
  try { authAddr = await listen(authServer); } catch (e) {
    if (e && e.code === 'EPERM') return t.skip('local listeners prohibited');
    throw e;
  }
  // Hermetic history: the store defaults to logs/activity in the source tree,
  // which other tests in the suite also write org-1 entries into.
  const savedDir = process.env.ROUTER_ACTIVITY_DIR;
  process.env.ROUTER_ACTIVITY_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'lane-stats-'));
  t.after(() => { if (savedDir === undefined) delete process.env.ROUTER_ACTIVITY_DIR; else process.env.ROUTER_ACTIVITY_DIR = savedDir; });
  const router = new AIServiceRouter({ authGatewayUrl: `http://127.0.0.1:${authAddr.port}`, authTimeoutMs: 500 });
  const app = express();
  app.use(express.json());
  app.use(router.getRoutes());
  const server = http.createServer(app);
  const addr = await listen(server);
  const base = `http://127.0.0.1:${addr.port}`;
  t.after(() => { server.close(); authServer.close(); });

  const cat = await fetch(`${base}/api/v1/catalog`);
  assert.equal(cat.status, 200);
  assert.equal(cat.headers.get('cache-control'), 'public, max-age=15');
  const body = await cat.json();
  assert.ok(body.personas.length > 0);

  const post = (manifest) => fetch(`${base}/api/v1/profiles/validate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manifest }),
  });
  const ok = await post(l0);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).valid, true);
  const bad = await post('nope');
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).valid, false);

  assert.equal((await fetch(`${base}/api/v1/ops/lane-stats`)).status, 401);

  router._activity.record({ kind: 'request_outcome', requestId: 'r1', organizationId: 'org-1', success: true, durationMs: 40 });
  router._activity.record({ kind: 'request_outcome', requestId: 'r2', organizationId: 'org-2', success: true, durationMs: 90 });
  const stats = await fetch(`${base}/api/v1/ops/lane-stats`, { headers: { 'X-API-Key': 'lano_catalog' } });
  assert.equal(stats.status, 200);
  const s = await stats.json();
  assert.equal(s.scope, 'organization');
  assert.equal(s.lanes.length, 1);
  assert.equal(s.lanes[0].useCase, 'unknown');
  assert.equal(s.lanes[0].total, 1);
  assert.ok(['buffer', 'persisted'].includes(s.window.source));
});
