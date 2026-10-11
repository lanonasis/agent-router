'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolLoop } = require('../core/tool-loop');

// memory.write used to dispatch whenever a model named it; withholding the
// definition was the only control. These pin the execution-time gate: the
// tool must have been offered AND the use case must permit writes.

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const offered = (...names) => names.map((name) => ({ type: 'function', function: { name } }));
const call = { name: 'memory.write', arguments: JSON.stringify({ content: 'x' }) };

function loopWithSpy() {
  const tl = new ToolLoop({ logger: quiet });
  const writes = [];
  tl.toolMemoryWrite = async (args) => {
    writes.push(args);
    return JSON.stringify({ ok: true });
  };
  return { tl, writes };
}

test('memory-analysis refuses memory.write even when the caller offered it', async () => {
  const { tl, writes } = loopWithSpy();
  const result = await tl.executeToolCall(call, {}, offered('memory.search', 'memory.write'), 'memory-analysis');
  assert.equal(writes.length, 0, 'no write may reach the memory API');
  assert.match(JSON.parse(result.payload).error, /not permitted on the memory-analysis use case/);
});

test('an unoffered memory.write is refused on any use case', async () => {
  const { tl, writes } = loopWithSpy();
  const result = await tl.executeToolCall(call, {}, offered('memory.search', 'memory.get'), 'repl-nlp');
  assert.equal(writes.length, 0);
  assert.equal(JSON.parse(result.payload).error, 'Tool was not offered for this request');
});

test('repl-nlp still writes when memory.write was offered', async () => {
  const { tl, writes } = loopWithSpy();
  await tl.executeToolCall(call, {}, offered('memory.write'), 'repl-nlp');
  assert.equal(writes.length, 1);
});

test('MEMORY_WRITE_USE_CASES opts a use case in at execution too', async (t) => {
  const prev = process.env.MEMORY_WRITE_USE_CASES;
  process.env.MEMORY_WRITE_USE_CASES = 'repl-nlp,memory-analysis';
  t.after(() => {
    if (prev === undefined) delete process.env.MEMORY_WRITE_USE_CASES;
    else process.env.MEMORY_WRITE_USE_CASES = prev;
  });
  const { tl, writes } = loopWithSpy();
  await tl.executeToolCall(call, {}, offered('memory.write'), 'memory-analysis');
  assert.equal(writes.length, 1);
});

test('the use case is threaded through executeToolCalls', async () => {
  const { tl, writes } = loopWithSpy();
  const [result] = await tl.executeToolCalls([call], {}, offered('memory.write'), 'memory-analysis');
  assert.equal(writes.length, 0);
  assert.match(JSON.parse(result.payload).error, /not permitted/);
});
