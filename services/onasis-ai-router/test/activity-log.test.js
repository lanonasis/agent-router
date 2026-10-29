'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createActivityLog, classifyError, describeOrigin } = require('../core/activity-log');

test('timeout on vendor 1 then success on vendor 2 reads as a recovered failover', () => {
  const log = createActivityLog();
  log.begin('r1', { origin: 'slack-bot', useCase: 'ask-ai', organizationId: 'org-a', endpoint: '/api/v1/ai-chat' });
  log.record({ kind: 'vendor_failure', requestId: 'r1', vendor: 'anthropic', durationMs: 12000, error: 'The operation was aborted due to timeout' });
  log.record({ kind: 'fallback', requestId: 'r1', vendor: 'anthropic' });
  log.record({ kind: 'request_outcome', requestId: 'r1', vendor: 'minimax', success: true, statusCode: 200, durationMs: 15400 });

  const [entry] = log.list({ organizationId: 'org-a' });
  assert.equal(entry.status, 'recovered');
  assert.equal(entry.finalVendor, 'minimax');
  assert.deepEqual(entry.attempts.map((a) => [a.vendor, a.outcome, a.reason]), [
    ['anthropic', 'failed', 'timeout'],
    ['minimax', 'served', null],
  ]);
  assert.equal(entry.durationMs, 15400);
});

test('a request served by the first vendor is completed with one step', () => {
  const log = createActivityLog();
  log.begin('r2', { organizationId: 'org-a' });
  log.record({ kind: 'request_outcome', requestId: 'r2', vendor: 'pi', success: true, statusCode: 200, durationMs: 800 });
  const [entry] = log.list({ organizationId: 'org-a' });
  assert.equal(entry.status, 'completed');
  assert.equal(entry.attempts.length, 1);
});

test('chain exhaustion is failed and keeps the error', () => {
  const log = createActivityLog();
  log.begin('r3', { organizationId: 'org-a' });
  log.record({ kind: 'vendor_failure', requestId: 'r3', vendor: 'openai', error: 'openai returned 429' });
  log.record({ kind: 'request_outcome', requestId: 'r3', success: false, statusCode: 503, error: 'All vendors in chain failed' });
  const [entry] = log.list({ organizationId: 'org-a' });
  assert.equal(entry.status, 'failed');
  assert.equal(entry.statusCode, 503);
  assert.equal(entry.attempts[0].reason, 'rate_limited');
});

test('a tenant only sees its own requests; operators see all', () => {
  const log = createActivityLog();
  log.begin('a', { organizationId: 'org-a' });
  log.begin('b', { organizationId: 'org-b' });
  log.begin('c', {});
  assert.deepEqual(log.list({ organizationId: 'org-a' }).map((e) => e.requestId), ['a']);
  assert.deepEqual(log.list({ organizationId: null }).map((e) => e.requestId), []);
  assert.deepEqual(log.list({ all: true }).map((e) => e.requestId), ['c', 'b', 'a']);
});

test('the buffer keeps only the newest entries up to capacity', () => {
  const log = createActivityLog({ capacity: 3 });
  for (const id of ['1', '2', '3', '4', '5']) log.begin(id, { organizationId: 'o' });
  assert.equal(log.size(), 3);
  assert.deepEqual(log.list({ all: true }).map((e) => e.requestId), ['5', '4', '3']);
});

test('error classification and origin labels', () => {
  assert.equal(classifyError('status 502 from upstream'), 'upstream_5xx');
  assert.equal(classifyError('OPENAI_API_KEY is not configured — OpenAI vendor unavailable'), 'not_configured');
  assert.equal(classifyError('401 Unauthorized'), 'auth');
  assert.equal(classifyError('connect ECONNREFUSED 127.0.0.1:1234'), 'unreachable');
  assert.equal(describeOrigin({ headers: { origin: 'https://agent-router.lovable.app' } }), 'agent-router.lovable.app');
  assert.equal(describeOrigin({ headers: { 'x-onasis-client': 'slack-memory-concierge' } }), 'slack-memory-concierge');
  assert.equal(describeOrigin({ headers: { 'user-agent': 'curl/8.4.0' } }), 'curl');
  assert.equal(describeOrigin({ headers: {} }), 'api');
});
