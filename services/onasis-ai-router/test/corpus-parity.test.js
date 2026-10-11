'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'capture-corpus-parity.js');

// capture-prompt-baseline.js pins the router's corpus by way of the effective
// prompt. Nothing pinned the canonical package, so Agent Heaven could edit it
// and every check here would still pass while the two corpora drifted further
// apart. These tests close that side.

test('the two model-file corpora stand where they were recorded', () => {
  try {
    execFileSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    assert.fail(
      'Model-file corpus drift:\n' + (err.stderr || err.stdout || err.message)
      + '\nIf intended, re-run scripts/capture-corpus-parity.js and review the diff.',
    );
  }
});

test('drift in the canonical package is detected', () => {
  // The regression that motivates this file: the package side was unguarded.
  const target = path.resolve(__dirname, '..', '..', '..', 'packages', 'agent-model-files', 'SOUL.md');
  const original = fs.readFileSync(target);
  try {
    fs.appendFileSync(target, '\nDRIFT PROBE\n');
    assert.throws(
      () => execFileSync(process.execPath, [SCRIPT, '--check'], { stdio: 'pipe' }),
      'an edit to the canonical package must fail --check',
    );
  } finally {
    fs.writeFileSync(target, original);
  }
  execFileSync(process.execPath, [SCRIPT, '--check'], { stdio: 'pipe' });
});

test('drift in the router corpus is detected', () => {
  const target = path.resolve(__dirname, '..', 'agent_model_files', 'subagents', 'researcher.md');
  const original = fs.readFileSync(target);
  try {
    fs.appendFileSync(target, '\nDRIFT PROBE\n');
    assert.throws(
      () => execFileSync(process.execPath, [SCRIPT, '--check'], { stdio: 'pipe' }),
      'an edit to the router corpus must fail --check',
    );
  } finally {
    fs.writeFileSync(target, original);
  }
  execFileSync(process.execPath, [SCRIPT, '--check'], { stdio: 'pipe' });
});

test('a file appearing in either corpus is drift, not silently ignored', () => {
  const extra = path.resolve(__dirname, '..', '..', '..', 'packages', 'agent-model-files', 'package.json');
  const original = fs.readFileSync(extra);
  try {
    fs.unlinkSync(extra);
    assert.throws(
      () => execFileSync(process.execPath, [SCRIPT, '--check'], { stdio: 'pipe' }),
      'a corpus-only file vanishing must fail --check',
    );
  } finally {
    fs.writeFileSync(extra, original);
  }
  execFileSync(process.execPath, [SCRIPT, '--check'], { stdio: 'pipe' });
});
