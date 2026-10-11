'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summariseHealth } = require('../core/health-status');

// The live shape observed on 2026-09-01, when openclaw's gateway was down and
// /health returned 503 while authenticated chat requests were being served
// normally by minimax.
const LIVE = {
  openclaw:  { status: 'unhealthy', response_time: 2 },
  ollama:    { status: 'healthy',   response_time: 14 },
  anthropic: { status: 'healthy',   response_time: 312 },
  openai:    { status: 'healthy',   response_time: 745 },
  minimax:   { status: 'healthy',   response_time: 1278 },
};

test('one dead vendor is degraded, not an outage', () => {
  const s = summariseHealth(LIVE);
  assert.equal(s.status, 'degraded');
  assert.equal(s.httpStatus, 200, 'the router can still serve; 503 would be a lie');
  assert.equal(s.healthy, 4);
  assert.equal(s.total, 5);
});

test('all vendors healthy is healthy', () => {
  const s = summariseHealth({ a: { status: 'healthy' }, b: { status: 'healthy' } });
  assert.equal(s.status, 'healthy');
  assert.equal(s.httpStatus, 200);
});

test('no vendor healthy is a real outage', () => {
  const s = summariseHealth({ a: { status: 'unhealthy' }, b: { status: 'unhealthy' } });
  assert.equal(s.status, 'unavailable');
  assert.equal(s.httpStatus, 503);
});

test('an empty vendor set is a misconfiguration, not health', () => {
  const s = summariseHealth({});
  assert.equal(s.status, 'unavailable');
  assert.equal(s.httpStatus, 503);
});

test('tolerates missing or malformed vendor entries', () => {
  const s = summariseHealth({ a: { status: 'healthy' }, b: null, c: undefined });
  assert.equal(s.status, 'degraded');
  assert.equal(s.httpStatus, 200);
  assert.equal(s.healthy, 1);
});
