#!/usr/bin/env node
// Asserts router/vendor/edge status derivation (src/lib/topologyStatus.ts).
//   node scripts/check-topology-status.mjs
import assert from 'node:assert/strict';
import {
  aggregateVendorStates, deriveEdgeStatus, deriveRouterStatus, deriveVendorState,
  lanesSummary, pushBeat, truncate,
} from '../src/lib/topologyStatus.ts';

const beat = (ok, routerStatus = 'healthy', vendorsHealthy = '5/6') =>
  ({ t: 0, ok, latencyMs: ok ? 120 : null, routerStatus: ok ? routerStatus : null, vendorsHealthy: ok ? vendorsHealthy : null });

// router node
assert.equal(deriveRouterStatus([]), 'unknown');
assert.equal(deriveRouterStatus([beat(true)]), 'ok');
assert.equal(deriveRouterStatus([beat(true, 'degraded', '3/6')]), 'warn');
assert.equal(deriveRouterStatus([beat(true, 'unavailable', '0/6')]), 'crit');
assert.equal(deriveRouterStatus([beat(true, 'degraded', '0/6')]), 'crit', '0 healthy vendors is crit');
assert.equal(deriveRouterStatus([beat(true), beat(false)]), 'warn', 'one miss is a blip');
assert.equal(deriveRouterStatus([beat(false)]), 'warn');
assert.equal(deriveRouterStatus([beat(true), beat(false), beat(false)]), 'gap', 'two misses -> unreachable');
assert.equal(deriveRouterStatus([beat(false), beat(false), beat(true)]), 'ok', 'recovers on next answer');

// ring buffer
let h = [];
for (let i = 0; i < 40; i++) h = pushBeat(h, { ...beat(true), t: i });
assert.equal(h.length, 30);
assert.equal(h[0].t, 10);
assert.equal(h[29].t, 39);

// vendor nodes
assert.equal(deriveVendorState({ status: 'healthy', response_time: 1386 }).status, 'ok');
const bad = deriveVendorState({ status: 'unhealthy', reason: 'x'.repeat(300) });
assert.equal(bad.status, 'crit');
assert.equal(bad.note.length, 140, 'reason truncated to 140 chars');
assert.ok(bad.note.endsWith('…'));
const stale = deriveVendorState({ status: 'healthy', stale: true });
assert.equal(stale.status, 'warn');
assert.match(stale.meta, /stale/);
const staleBad = deriveVendorState({ status: 'unhealthy', stale: true, reason: 'no credits' });
assert.equal(staleBad.status, 'crit', 'unhealthy stays crit even when stale');
assert.match(staleBad.meta, /stale/);
assert.equal(deriveVendorState({ status: 'unknown' }).status, 'unknown');
assert.equal(deriveVendorState(undefined).status, 'unknown');
assert.match(deriveVendorState({ status: 'unhealthy', circuit: 'open', reason: 'r' }).meta, /circuit open/);
assert.equal(truncate('a\n  b\tc'), 'a b c', 'whitespace collapsed');

// grouped vendors
const ok = deriveVendorState({ status: 'healthy' });
const nok = deriveVendorState({ status: 'unhealthy', reason: 'down' });
assert.equal(aggregateVendorStates([]).status, 'unknown');
assert.equal(aggregateVendorStates([ok, ok]).status, 'ok');
assert.equal(aggregateVendorStates([ok, nok]).status, 'warn');
assert.equal(aggregateVendorStates([nok, nok]).status, 'crit');
assert.equal(aggregateVendorStates([ok, nok, ok]).meta, '2/3 healthy');
assert.equal(aggregateVendorStates([ok, stale]).status, 'warn');

// edges
assert.equal(deriveEdgeStatus('ok', 'ok'), 'ok');
assert.equal(deriveEdgeStatus('ok', 'crit'), 'crit');
assert.equal(deriveEdgeStatus('crit', 'ok'), 'crit');
assert.equal(deriveEdgeStatus('ok', 'gap'), 'gap');
assert.equal(deriveEdgeStatus('warn', 'ok'), 'warn');
assert.equal(deriveEdgeStatus('crit', 'gap'), 'crit', 'crit outranks gap');
assert.equal(deriveEdgeStatus('gap', 'warn'), 'gap', 'gap outranks warn');
assert.equal(deriveEdgeStatus('ok', 'unknown'), 'unknown', 'unobserved endpoint is not ok');
assert.equal(deriveEdgeStatus('unknown', 'unknown'), 'unknown');
assert.equal(deriveEdgeStatus('warn', 'unknown'), 'warn');
assert.equal(deriveEdgeStatus('ok', 'ok', true), 'gap', 'known wiring gap always gap');

// lanes annotation
assert.equal(lanesSummary(undefined), null);
assert.equal(lanesSummary([]), null);
assert.deepEqual(lanesSummary([{ status: 'active' }, { status: 'degraded' }, { status: 'active' }]), { active: 2, total: 3 });

console.log('check-topology-status: ok');
