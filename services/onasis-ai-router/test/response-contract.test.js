'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertUsableCompletion,
  VendorContractError,
} = require('../vendors/_shared/response-contract');

const ok = (content, extra = {}) => ({
  message: { role: 'assistant', content },
  done: true, done_reason: 'stop', tool_calls: [], usage: {}, ...extra,
});

test('accepts a normal completion', () => {
  const r = ok('The capital of France is Paris.');
  assert.equal(assertUsableCompletion(r, { vendorId: 'minimax' }), r);
});

test('rejects empty content with no tool calls', () => {
  assert.throws(
    () => assertUsableCompletion(ok('   '), { vendorId: 'minimax' }),
    (e) => e instanceof VendorContractError && e.reason === 'empty_content',
  );
});

test('accepts empty content WHEN tool calls are present', () => {
  const r = ok('', { tool_calls: [{ id: 'c1', function: { name: 'memory_search' } }] });
  assert.equal(assertUsableCompletion(r, { vendorId: 'minimax' }), r);
});

test('rejects an incomplete turn: finish_reason length with no content', () => {
  assert.throws(
    () => assertUsableCompletion(ok('', { done_reason: 'length' }), { vendorId: 'openclaw' }),
    (e) => e instanceof VendorContractError && e.reason === 'incomplete_turn',
  );
});

test("rejects OpenClaw's real gateway error string (regression fixture)", () => {
  const sentinels = [/^⚠️\s*Agent couldn't generate a response/i];
  assert.throws(
    () => assertUsableCompletion(
      ok("⚠️ Agent couldn't generate a response. Please try again."),
      { vendorId: 'openclaw', sentinels },
    ),
    (e) => e instanceof VendorContractError && e.reason === 'error_sentinel',
  );
});

test('a sentinel matching mid-sentence prose does not false-positive', () => {
  const sentinels = [/^⚠️\s*Agent couldn't generate a response/i];
  const r = ok("If the agent couldn't generate a response, retry the request.");
  assert.equal(assertUsableCompletion(r, { vendorId: 'openclaw', sentinels }), r);
});

test('never leaks vendor identity into the error message', () => {
  try {
    assertUsableCompletion(ok(''), { vendorId: 'openclaw' });
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(/openclaw/i.test(e.message), false, 'vendorId belongs on the property, not the message');
    assert.equal(e.vendorId, 'openclaw');
  }
});
