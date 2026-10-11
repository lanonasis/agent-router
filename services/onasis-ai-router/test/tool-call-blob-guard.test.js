'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const AIServiceRouter = require('../core/ai-service-router');

// Observed live 2026-09-04 on dashboard-assistant, 7.3s, HTTP 200 — the user
// asked a memory question and got back the raw schema of the tool the model
// meant to call:
//
//   {"name": "memory.search", "arguments": {"memory_type":{"type":"string"},
//    "query":{"type":"string"},"tags":{"type":"array"…
//
// Both extractors require JSON.parse to succeed, so a model that hits its token
// ceiling mid-emission produces a blob that satisfies neither guard. It was
// therefore treated as prose. Shape, not parseability, is what identifies it.

const router = new AIServiceRouter({});
const looksLikeBlob = (t) => router._looksLikeToolCallBlob(t);

test('the exact blob observed in production is caught', () => {
  assert.equal(looksLikeBlob(
    '{"name": "memory.search", "arguments": {"memory_type":{"type":"string"},'
    + '"query":{"type":"string"},"tags":{"type":"array"'), true);
});

test('a well-formed tool call is caught too', () => {
  assert.equal(looksLikeBlob('{"name":"memory.write","arguments":{"content":"x"}}'), true);
  assert.equal(looksLikeBlob('{"tool_calls":[{"name":"memory.search"}]}'), true);
  assert.equal(looksLikeBlob('{"tool":"memory.get","parameters":{"id":"1"}}'), true);
});

test('a fenced blob is caught', () => {
  assert.equal(looksLikeBlob('```json\n{"name":"memory.search","arguments":{}}'), true);
});

test('prose that merely mentions a tool is left alone', () => {
  assert.equal(looksLikeBlob('I ran memory.search and found 3 results.'), false);
  assert.equal(looksLikeBlob('The "name" field and its "arguments" are documented above.'), false);
});

test('a legitimate JSON answer is left alone', () => {
  // cleanAssistantText() preserves valid JSON on purpose — a caller may have
  // asked for it. Only the tool-call SHAPE is refused.
  assert.equal(looksLikeBlob('{"status":"ok","count":3}'), false);
  assert.equal(looksLikeBlob('{"name":"Derick","role":"owner"}'), false,
    'name without arguments is just data');
});

test('non-strings and empty input are safe', () => {
  for (const v of ['', '   ', null, undefined, 42, {}, []]) {
    assert.equal(looksLikeBlob(v), false, `unexpected true for ${JSON.stringify(v)}`);
  }
});

test('the giveaway keys are only looked for at the head of the object', () => {
  // Bounded so a large payload cannot make this scan expensive; a real tool
  // call declares its name immediately.
  const buried = `{"data":"${'x'.repeat(500)}","name":"t","arguments":{}}`;
  assert.equal(looksLikeBlob(buried), false);
});
