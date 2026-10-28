'use strict';

// The composed system prompt embeds a ${PROMPTS_ROOT}-derived label. That
// label used to be computed with `path.relative(process.cwd(), promptsRoot)`,
// which made the effective prompt — and therefore the recorded baseline —
// depend on the directory the process happened to be started from.
//
// Consequence: the same corpus composed to a different string depending on
// the working directory, so `capture-prompt-baseline.js --check` reported
// phantom drift whenever the suite ran from a different directory than the
// recorder did.
//
// The label must be stable: relative to the service root, not the cwd.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { PromptComposer } = require('../core/prompt-composer');

const SERVICE_ROOT = path.resolve(__dirname, '..');
const BUNDLED_ROOT = path.resolve(SERVICE_ROOT, 'agent_model_files');

test('the prompt label is relative to the service root, not the working directory', () => {
  const composer = new PromptComposer({ promptMode: 'hybrid' });
  assert.equal(
    composer.promptLabel,
    'agent_model_files',
    'label must be service-relative so it does not vary with cwd',
  );
});

test('the prompt label is the same regardless of process.cwd()', () => {
  const originalCwd = process.cwd();
  try {
    process.chdir(SERVICE_ROOT);
    const fromServiceRoot = new PromptComposer({ promptMode: 'hybrid' }).promptLabel;

    process.chdir(path.resolve(SERVICE_ROOT, '..'));
    const fromRepoRoot = new PromptComposer({ promptMode: 'hybrid' }).promptLabel;

    assert.equal(
      fromRepoRoot,
      fromServiceRoot,
      'cwd must not change the composed prompt label',
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('the composed prompt does not embed an absolute filesystem path', () => {
  const composer = new PromptComposer({ promptMode: 'hybrid' });
  const bundle = composer.compose({ useCase: 'ask-ai', runtimePrompt: '[[RUNTIME]]' });
  const effective = bundle.systemPromptForVendor('other');

  assert.ok(effective, 'expected a composed prompt');
  assert.ok(
    !effective.includes(SERVICE_ROOT),
    'the composed prompt must not leak the absolute service root',
  );
  assert.ok(
    effective.includes('agent_model_files/SOUL.md'),
    'the composed prompt should reference the corpus by its service-relative path',
  );
});

test('the bundled corpus path is the default prompts root', () => {
  const composer = new PromptComposer({ promptMode: 'hybrid' });
  assert.equal(
    path.resolve(composer.promptsRoot),
    BUNDLED_ROOT,
    'default prompts root must be the bundled corpus',
  );
});
