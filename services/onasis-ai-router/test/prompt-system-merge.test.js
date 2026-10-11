'use strict';

/**
 * The router used to carry two prompt systems.
 *
 * The lane prompt ("You are the Onasis onboarding guide...") was a string
 * literal in `vendors/index.js`, keyed by `USE_CASES[uc].systemPromptKey`. The
 * rest of the persona — SOUL.md and the role prompt — was markdown in
 * `agent_model_files/`, keyed by a second map in `core/prompt-composer.js`.
 * Same key space, two tables, two owners, two formats, and only the corpus
 * half was overridable without a redeploy. Nothing compared them, so a use case
 * registered on one side and missed on the other composed against the wrong
 * half and surfaced as persona drift rather than an error.
 *
 * These tests hold the merge to two claims:
 *
 *   1. It moved text without changing it. `lane-prompts.json` is the literals
 *      as they were immediately before the move, captured from the deleted
 *      block. Every lane must still resolve byte-for-byte.
 *   2. It closed the split. Every use case must resolve *both* halves, so the
 *      next one cannot be half-registered.
 *
 * `capture-prompt-baseline.js --check` covers the other side of the refactor:
 * it composes against a `[[RUNTIME]]` placeholder, so it pins SOUL + role and
 * says nothing about lane text. Together the two cover the whole prompt.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  PromptComposer,
  DEFAULT_USE_CASE_PROMPTS,
} = require('../core/prompt-composer');
const {
  USE_CASES,
  DEFAULT_USE_CASE,
  resolveVendorForUseCase,
  resetLaneCorpus,
} = require('../vendors');

const GOLDEN = require('./__baselines__/lane-prompts.json');
const LANES_DIR = path.resolve(__dirname, '..', 'agent_model_files', 'lanes');

test('every lane prompt still resolves byte-for-byte after the move', () => {
  const composer = new PromptComposer();
  for (const [laneKey, expected] of Object.entries(GOLDEN)) {
    assert.strictEqual(
      composer.lanePromptForKey(laneKey),
      expected,
      `lane "${laneKey}" drifted from the literal it replaced`
    );
  }
});

test('the golden fixture covers every lane file, and vice versa', () => {
  const onDisk = fs.readdirSync(LANES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
  assert.deepStrictEqual(
    onDisk,
    Object.keys(GOLDEN).sort(),
    'a lane file was added or removed without updating the baseline'
  );
});

test('every use case resolves both halves of the prompt', () => {
  const composer = new PromptComposer();
  for (const useCase of Object.keys(USE_CASES)) {
    const lane = composer.lanePromptForUseCase(useCase);
    assert.ok(lane, `use case "${useCase}" resolves no lane prompt`);

    const bundle = composer.compose({ useCase, runtimePrompt: lane });
    assert.ok(
      bundle.usesRolePrompt,
      `use case "${useCase}" resolves no role prompt (${bundle.rolePromptPath})`
    );
  }
});

test('the single table and the vendor use-case table agree on key space', () => {
  // DEFAULT_USE_CASE_PROMPTS carries a `default` entry that USE_CASES does not.
  const declared = Object.keys(DEFAULT_USE_CASE_PROMPTS).filter((k) => k !== 'default').sort();
  assert.deepStrictEqual(
    declared,
    Object.keys(USE_CASES).sort(),
    'a use case exists in one table but not the other'
  );
});

test('each use case still gets the lane its systemPromptKey names', () => {
  // The merge kept `systemPromptKey` as the lane key rather than renaming it,
  // so an existing USE_CASES entry keeps pointing at the same text.
  const composer = new PromptComposer();
  for (const [useCase, config] of Object.entries(USE_CASES)) {
    assert.strictEqual(
      composer.resolveLaneKey(useCase),
      config.systemPromptKey,
      `lane map and systemPromptKey disagree for "${useCase}"`
    );
    assert.strictEqual(resolveVendorForUseCase(useCase).systemPrompt, GOLDEN[config.systemPromptKey]);
  }
});

test('an unknown use case falls back to the same lane the literal map did', () => {
  const composer = new PromptComposer();
  assert.strictEqual(
    composer.lanePromptForUseCase('no-such-use-case'),
    GOLDEN['concise-helper']
  );
  // And the vendor path agrees, since that was the old `|| SYSTEM_PROMPTS['concise-helper']`.
  assert.strictEqual(
    resolveVendorForUseCase('no-such-use-case').systemPrompt,
    GOLDEN[USE_CASES[DEFAULT_USE_CASE].systemPromptKey]
  );
});

test('a corpus without lanes/ falls back to the bundled one rather than blanking', () => {
  // capture-corpus-parity.js points PROMPTS_ROOT at packages/agent-model-files,
  // which has role prompts but no lanes. A blank system prompt there would mean
  // a measurement run could ship an unbranded assistant.
  const composer = new PromptComposer({ promptsRoot: path.resolve(__dirname, '..') });
  assert.strictEqual(composer.lanePromptForKey('onboarding'), GOLDEN['onboarding']);
});

test('lane prompts are overridable without a redeploy, like the role map already was', () => {
  // Both forms: the JSON string an env var carries, and the object a caller
  // would naturally pass. The object form used to be accepted and ignored.
  const fromEnv = new PromptComposer({ laneMap: '{"landing-guide":"support"}' });
  assert.strictEqual(fromEnv.lanePromptForUseCase('landing-guide'), GOLDEN['support']);

  const fromObject = new PromptComposer({ laneMap: { 'landing-guide': 'support' } });
  assert.strictEqual(fromObject.lanePromptForUseCase('landing-guide'), GOLDEN['support']);

  // An override names one lane; the rest still resolve.
  assert.strictEqual(fromObject.lanePromptForUseCase('support-chat'), GOLDEN['support']);
  assert.strictEqual(fromObject.lanePromptForUseCase('code-assist'), GOLDEN['technical']);
});

test('a role map passed as an object is honoured, not silently dropped', () => {
  const composer = new PromptComposer({ roleMap: { 'landing-guide': 'subagents/coder.md' } });
  assert.strictEqual(composer.resolveRolePromptPath('landing-guide'), 'subagents/coder.md');
});

test('a malformed override falls back to defaults instead of throwing', () => {
  const composer = new PromptComposer({ laneMap: 'not json{' });
  assert.strictEqual(composer.lanePromptForUseCase('landing-guide'), GOLDEN['onboarding']);
});

test('the vendor path re-reads the corpus after resetLaneCorpus', () => {
  // vendors/index.js caches one composer, and a composer reads PROMPTS_ROOT
  // when it is built. Without the reset seam, a suite that repoints the corpus
  // after requiring vendors keeps resolving against the old root and passes
  // for the wrong reason.
  const before = resolveVendorForUseCase('landing-guide').systemPrompt;
  assert.strictEqual(before, GOLDEN['onboarding']);

  const previous = process.env.PROMPTS_ROOT;
  process.env.PROMPTS_ROOT = path.resolve(__dirname, 'fixtures', 'corpus-override');
  resetLaneCorpus();
  try {
    assert.strictEqual(
      resolveVendorForUseCase('landing-guide').systemPrompt,
      'OVERRIDDEN LANE PROMPT'
    );
  } finally {
    if (previous === undefined) delete process.env.PROMPTS_ROOT;
    else process.env.PROMPTS_ROOT = previous;
    resetLaneCorpus();
  }

  assert.strictEqual(resolveVendorForUseCase('landing-guide').systemPrompt, before);
});

test('the non-disclosure instruction survives on every lane', () => {
  // Every literal carried some form of "never reveal AI provider or model
  // information". It is the one rule in the lane prompts that is a security
  // boundary rather than tone, and sanitizePersonaLeaks is the backstop, not
  // the only line of defence.
  for (const [laneKey, text] of Object.entries(GOLDEN)) {
    assert.match(
      text,
      /never (reveal|mention) (ai provider|internal systems)/i,
      `lane "${laneKey}" lost its non-disclosure instruction`
    );
  }
});
