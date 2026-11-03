#!/usr/bin/env node
// Asserts the client-side lane aggregation math (src/lib/laneStats.ts).
//   node scripts/check-lane-stats.mjs
import assert from 'node:assert/strict';
import { aggregateLaneStats, laneHealth, percentile, worstLanes } from '../src/lib/laneStats.ts';

const e = (useCase, status, durationMs, startedAt = '2026-01-01T00:00:00Z') => ({ useCase, status, durationMs, startedAt });

// 20 finished "chat" requests: 17 completed, 2 recovered, 1 failed; durations 100..2000.
const chat = [];
for (let i = 1; i <= 17; i++) chat.push(e('chat', 'completed', i * 100, `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`));
chat.push(e('chat', 'recovered', 1800), e('chat', 'recovered', 1900), e('chat', 'failed', 2000));
const entries = [
  ...chat,
  e('chat', 'in_progress', null, '2026-01-02T00:00:00Z'), // excluded from rate and latency, but counted in total and lastSeen
  e(null, 'completed', 50),
  e(null, 'failed', 150),
  e('idle', 'in_progress', null),
  e('bad-dur', 'completed', null),
];

const lanes = aggregateLaneStats(entries);
const by = Object.fromEntries(lanes.map((l) => [l.useCase, l]));

const c = by.chat;
assert.equal(c.total, 21);
assert.equal(c.completed, 17);
assert.equal(c.recovered, 2);
assert.equal(c.failed, 1);
assert.equal(c.inProgress, 1);
assert.equal(c.successRate, 19 / 20, 'success = (completed+recovered)/finished, in-progress excluded');
// durations: 100..1700 (17), 1800, 1900, 2000 -> sum = 100*153 + 5700 = 21000, n=20
assert.equal(c.avgLatencyMs, 1050);
assert.equal(c.p95LatencyMs, 1900, 'nearest-rank p95 of 20 samples is the 19th');
assert.equal(c.lastSeenAt, '2026-01-02T00:00:00.000Z');

// null use case -> "unknown" bucket
assert.ok(by.unknown, 'null useCase bucketed as unknown');
assert.equal(by.unknown.total, 2);
assert.equal(by.unknown.successRate, 0.5);
assert.equal(by.unknown.avgLatencyMs, 100);
assert.equal(by.null, undefined);

// zero finished -> null rate and null latency, never 0
assert.equal(by.idle.successRate, null);
assert.equal(by.idle.avgLatencyMs, null);
assert.equal(by.idle.p95LatencyMs, null);
assert.equal(by.idle.inProgress, 1);

// finished but no numeric duration -> rate yes, latency null
assert.equal(by['bad-dur'].successRate, 1);
assert.equal(by['bad-dur'].avgLatencyMs, null);

// sorted by total desc
assert.deepEqual(lanes.map((l) => l.useCase), ['chat', 'unknown', 'bad-dur', 'idle']);
assert.deepEqual(aggregateLaneStats([]), []);

// percentile edge cases
assert.equal(percentile([], 95), null);
assert.equal(percentile([7], 95), 7);
assert.equal(percentile([1, 2, 3, 4], 50), 2);

// thresholds: >=95 healthy, 80-95 warn, <80 failing, null no-traffic
assert.equal(laneHealth(0.95), 'healthy');
assert.equal(laneHealth(0.9499), 'warn');
assert.equal(laneHealth(0.8), 'warn');
assert.equal(laneHealth(0.7999), 'failing');
assert.equal(laneHealth(0), 'failing');
assert.equal(laneHealth(null), 'no-traffic');

// worst lanes: ascending rate, no-traffic lanes excluded, capped
const w = worstLanes(lanes, 2).map((l) => l.useCase);
assert.deepEqual(w, ['unknown', 'chat']);

console.log('check-lane-stats: ok');
