'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolLoop } = require('../core/tool-loop');

// `allowedTools` was in every profile manifest and read by nothing but the
// schema validator, so a manifest permitting two tools could still have any
// tool offered under it. The manifest is a CEILING: it may narrow what the
// use case (or the caller) asked for, never widen it — otherwise a profile
// could grant itself capability the lane never had.

const defs = (...names) => names.map((name) => ({ type: 'function', function: { name } }));
const names = (list) => list.map((t) => t.function.name);

test('no profile leaves the offered set untouched', () => {
  const requested = defs('memory.search', 'memory.get');
  assert.deepEqual(names(ToolLoop.constrainToAllowed(requested, null)), ['memory.search', 'memory.get']);
  assert.deepEqual(names(ToolLoop.constrainToAllowed(requested, undefined)), ['memory.search', 'memory.get']);
});

test('a profile narrows the offered set to its manifest', () => {
  const requested = defs('memory.search', 'memory.get', 'memory.write');
  assert.deepEqual(
    names(ToolLoop.constrainToAllowed(requested, ['memory.search', 'memory.get'])),
    ['memory.search', 'memory.get'],
  );
});

test('a profile cannot widen beyond what was requested', () => {
  // allowedTools names a tool the lane never offered; it must not appear.
  const requested = defs('memory.search');
  assert.deepEqual(
    names(ToolLoop.constrainToAllowed(requested, ['memory.search', 'memory.write', 'code.run_command'])),
    ['memory.search'],
  );
});

test('caller-supplied tools are constrained too — this is the replace-vs-intersect hole', () => {
  // Before this change a caller could send its own `tools` array and it
  // REPLACED the defaults wholesale, profile or not.
  const callerSupplied = defs('code.run_command', 'memory.search');
  assert.deepEqual(
    names(ToolLoop.constrainToAllowed(callerSupplied, ['memory.search', 'memory.get'])),
    ['memory.search'],
  );
});

test('an empty allowlist offers nothing, and is not confused with "no profile"', () => {
  assert.deepEqual(ToolLoop.constrainToAllowed(defs('memory.search'), []), []);
});

test('malformed entries are dropped rather than throwing', () => {
  const requested = [null, { type: 'function' }, ...defs('memory.search')];
  assert.deepEqual(names(ToolLoop.constrainToAllowed(requested, ['memory.search'])), ['memory.search']);
});

test('a non-array requested set yields an empty offer', () => {
  assert.deepEqual(ToolLoop.constrainToAllowed(undefined, ['memory.search']), []);
});
