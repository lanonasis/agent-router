'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createActivityStore, resolveRetentionDays } = require('../core/activity-store');
const { createActivityLog } = require('../core/activity-log');

const DAY = 24 * 60 * 60 * 1000;
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'activity-store-'));
const entry = (id, org = 'org-a', status = 'completed') => ({
  requestId: id, startedAt: new Date().toISOString(), organizationId: org, status, attempts: [],
});

test('settled entries survive a restart (a new store on the same directory reads them back)', async () => {
  const dir = tmpDir();
  const first = createActivityStore({ dir });
  await first.append(entry('r1'));
  await first.append(entry('r2'));
  await first.flush();

  const afterRestart = createActivityStore({ dir });
  const ids = (await afterRestart.recent({ limit: 10 })).map((e) => e.requestId);
  assert.deepEqual(ids, ['r2', 'r1']);
});

test('retention of 3 days deletes the day file from 3 days ago and keeps the last 3', async () => {
  const dir = tmpDir();
  let clock = Date.parse('2026-10-20T12:00:00Z');
  const store = createActivityStore({ dir, retentionDays: 3, now: () => clock });
  for (let d = 0; d < 4; d += 1) {
    await store.append(entry(`day-${d}`));
    clock += DAY;
  }
  clock -= DAY; // "today" is the day of the last write: 2026-10-23
  const removed = await store.prune();
  assert.equal(removed, 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), [
    'activity-2026-10-21.jsonl', 'activity-2026-10-22.jsonl', 'activity-2026-10-23.jsonl',
  ]);
  const ids = (await store.recent({ limit: 10 })).map((e) => e.requestId);
  assert.deepEqual(ids, ['day-3', 'day-2', 'day-1']);
});

test('entries older than the retention window are hidden even before pruning runs', async () => {
  const dir = tmpDir();
  let clock = Date.parse('2026-10-01T12:00:00Z');
  const store = createActivityStore({ dir, retentionDays: 2, now: () => clock });
  await store.append(entry('old'));
  clock += 5 * DAY;
  await store.append(entry('new'));
  const ids = (await store.recent({ limit: 10 })).map((e) => e.requestId);
  assert.deepEqual(ids, ['new']);
});

test('tenant filter only returns the caller organisation', async () => {
  const dir = tmpDir();
  const store = createActivityStore({ dir });
  await store.append(entry('a1', 'org-a'));
  await store.append(entry('b1', 'org-b'));
  const ids = (await store.recent({ limit: 10, filter: (e) => e.organizationId === 'org-b' })).map((e) => e.requestId);
  assert.deepEqual(ids, ['b1']);
});

test('repeated reads pick up lines appended since the previous read', async () => {
  const dir = tmpDir();
  const store = createActivityStore({ dir });
  await store.append(entry('r1'));
  assert.equal((await store.recent()).length, 1);
  await store.append(entry('r2'));
  assert.deepEqual((await store.recent()).map((e) => e.requestId), ['r2', 'r1']);
});

test('a corrupt line is skipped without losing the others', async () => {
  const dir = tmpDir();
  const store = createActivityStore({ dir });
  await store.append(entry('r1'));
  const [file] = fs.readdirSync(dir);
  fs.appendFileSync(path.join(dir, file), '{not json\n');
  await store.append(entry('r2'));
  assert.deepEqual((await store.recent()).map((e) => e.requestId), ['r2', 'r1']);
});

test('disabled store writes nothing', async () => {
  const dir = tmpDir();
  const store = createActivityStore({ dir, enabled: false });
  await store.append(entry('r1'));
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.deepEqual(await store.info(), { enabled: false, retentionDays: 7 });
});

test('retention defaults to 7 days and is capped at 365', () => {
  assert.equal(resolveRetentionDays(undefined), 7);
  assert.equal(resolveRetentionDays('0'), 7);
  assert.equal(resolveRetentionDays('30'), 30);
  assert.equal(resolveRetentionDays('9999'), 365);
});

test('the activity log hands each request to the store once, when it settles', async () => {
  const dir = tmpDir();
  const store = createActivityStore({ dir });
  const log = createActivityLog({ onSettle: (e) => store.append(e) });
  log.begin('r1', { organizationId: 'org-a', origin: 'slack-bot' });
  log.record({ kind: 'vendor_failure', requestId: 'r1', vendor: 'anthropic', error: 'timeout' });
  assert.equal((await store.recent()).length, 0, 'in-progress requests are not written');
  log.record({ kind: 'request_outcome', requestId: 'r1', vendor: 'minimax', success: true, statusCode: 200, durationMs: 900 });
  await store.flush();
  const [saved] = await store.recent();
  assert.equal(saved.status, 'recovered');
  assert.equal(saved.origin, 'slack-bot');
  assert.ok(saved.finishedAt);
  assert.deepEqual(saved.attempts.map((a) => a.vendor), ['anthropic', 'minimax']);
});
