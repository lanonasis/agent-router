'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertUsableCompletion,
  normalizeDoneReason,
} = require('../vendors/_shared/response-contract');

// The router acts on exactly one spelling of "I hit the ceiling":
// `done_reason === 'length'` in ai-service-router._noteTruncation(). Every
// vendor spells it differently. These tests pin the translation to the one
// place adapters cannot skip.

const completion = (doneReason, content = 'a partial answ') => ({
  message: { role: 'assistant', content },
  done: true,
  done_reason: doneReason,
  tool_calls: [],
  usage: {},
});

test('Anthropic max_tokens is recognised as truncation', () => {
  // Anthropic is an ACTIVE vendor and the only one not using OpenAI's wire
  // format. Its `stop_reason: "max_tokens"` previously passed through
  // untranslated, so a cut-off answer reached the caller with truncated unset.
  const out = assertUsableCompletion(completion('max_tokens'), { vendorId: 'anthropic' });
  assert.equal(out.done_reason, 'length');
});

test('every vendor spelling of the ceiling collapses to one value', () => {
  for (const spelling of ['length', 'max_tokens', 'max_token', 'model_length']) {
    assert.equal(normalizeDoneReason(spelling), 'length', `unmapped: ${spelling}`);
  }
});

test('normal completion spellings collapse to stop', () => {
  for (const spelling of ['stop', 'end_turn', 'stop_sequence', 'eos']) {
    assert.equal(normalizeDoneReason(spelling), 'stop', `unmapped: ${spelling}`);
  }
});

test("Anthropic's tool_use maps onto the shared tool_calls value", () => {
  assert.equal(normalizeDoneReason('tool_use'), 'tool_calls');
  assert.equal(normalizeDoneReason('tool_calls'), 'tool_calls');
});

test('an empty Anthropic completion is classed incomplete, not merely empty', () => {
  // The reason travels to the scoreboard. Before normalisation a truncated
  // Anthropic turn was filed as `empty_content` — a different failure than the
  // one that actually happened.
  try {
    assertUsableCompletion(completion('max_tokens', ''), { vendorId: 'anthropic' });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.reason, 'incomplete_turn');
  }
});

test('an unrecognised reason is passed through, not guessed at', () => {
  // Inventing a mapping would be worse than leaving it visible.
  assert.equal(normalizeDoneReason('content_filter'), 'content_filter');
  assert.equal(normalizeDoneReason('some_new_vendor_reason'), 'some_new_vendor_reason');
});

test('casing and stray whitespace do not defeat the mapping', () => {
  assert.equal(normalizeDoneReason('MAX_TOKENS'), 'length');
  assert.equal(normalizeDoneReason('  End_Turn '), 'stop');
});

test('a missing or non-string reason is left alone', () => {
  assert.equal(normalizeDoneReason(undefined), undefined);
  assert.equal(normalizeDoneReason(null), null);
});

test('normalisation does not disturb the existing contract checks', () => {
  // A gateway error string is still rejected, and a tool call still bypasses
  // the empty-content rule.
  assert.throws(
    () => assertUsableCompletion(completion('end_turn', '⚠️ Agent failed'), {
      vendorId: 'openclaw',
      sentinels: [/^⚠️\s*Agent failed/i],
    }),
    /gateway error string/,
  );

  const withCall = { ...completion('tool_use', ''), tool_calls: [{ id: '1' }] };
  assert.equal(assertUsableCompletion(withCall, { vendorId: 'anthropic' }).done_reason, 'tool_calls');
});
