'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');

// Convergence plan phase 2: "Preserve the router's effective prompt behavior as
// a regression baseline" before reconciling the router's corpus into Agent
// Heaven's canonical package. The two corpora differ in every shared file
// (SOUL.md 206 lines, SOURCE-OF-TRUTH.md 3109, tester.md 520, measured
// 2026-09-03), so the merge changes live persona if anything slips.
//
// This runs in the suite rather than only as a manual script on purpose:
// scripts/verify-circuit-eject.js sat broken and unnoticed because nothing
// executed it (PR #1 review, 5293685). A guard nothing runs is documentation.

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'capture-prompt-baseline.js');

test('the effective prompt for every use case matches the recorded baseline', () => {
  // Covers 54 combinations: 9 use cases x 3 prompt modes x ollama/other, since
  // systemPromptForVendor branches on both mode and vendor class.
  try {
    execFileSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    assert.fail(
      'Effective prompt drift:\n' + (err.stderr || err.stdout || err.message)
      + '\nIf intended, re-run scripts/capture-prompt-baseline.js and review the diff.',
    );
  }
});

test('the baseline actually detects drift', () => {
  // Guards the guard. A baseline that cannot fail gives false assurance
  // through the whole prompt migration.
  const fs = require('fs');
  const soul = path.resolve(__dirname, '..', 'agent_model_files', 'SOUL.md');
  const original = fs.readFileSync(soul);
  try {
    fs.appendFileSync(soul, '\nDRIFT PROBE\n');
    assert.throws(
      () => execFileSync(process.execPath, [SCRIPT, '--check'], { stdio: 'pipe' }),
      'a modified corpus must fail --check',
    );
  } finally {
    fs.writeFileSync(soul, original);
  }
  // And the corpus is restored, so the suite stays order-independent.
  execFileSync(process.execPath, [SCRIPT, '--check'], { stdio: 'pipe' });
});
