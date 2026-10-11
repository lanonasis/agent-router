#!/usr/bin/env node
'use strict';

/**
 * Capture the router's *effective* system prompt for every use case and vendor
 * class, as a regression baseline.
 *
 * Convergence plan phase 2 opens with "Preserve the router's effective prompt
 * behavior as a regression baseline" before reconciling the router's nested
 * corpus (services/onasis-ai-router/agent_model_files) into Agent Heaven's
 * canonical package (packages/agent-model-files). That ordering matters: the
 * two corpora currently differ in every shared file —
 *
 *   SOUL.md 206 differing lines, IDENTITY-LAYER.md 110,
 *   SOURCE-OF-TRUTH.md 3109, coder 211, researcher 324,
 *   reviewer 332, architect 438, tester 520   (measured 2026-09-03)
 *
 * so the migration is a real merge, not a rename, and it changes live persona
 * if anything slips. A hash-only baseline would tell us *that* something moved
 * but not what, so the full text is stored.
 *
 * Usage:
 *   node scripts/capture-prompt-baseline.js           # write baselines
 *   node scripts/capture-prompt-baseline.js --check   # fail if they moved
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PromptComposer } = require('../core/prompt-composer');

const OUT_DIR = path.resolve(__dirname, '..', 'test', '__baselines__');

// Every lane in vendors/index.js USE_CASES, plus the unmapped fallback.
const USE_CASES = [
  'landing-guide', 'ask-ai', 'dashboard-assistant', 'support-chat',
  'content-generation', 'code-assist', 'memory-analysis', 'repl-nlp',
  'unmapped-use-case',
];

// The composer branches on prompt mode and on whether the vendor is ollama, so
// a baseline covering only the default mode would miss two of three paths.
const MODES = ['hybrid', 'runtime', 'embedded'];
const VENDORS = ['ollama', 'other'];

// Fixed, so the baseline captures corpus changes rather than config drift.
const RUNTIME_PROMPT = '[[RUNTIME]]';

function capture() {
  const out = {};
  for (const promptMode of MODES) {
    const composer = new PromptComposer({ promptMode });
    for (const useCase of USE_CASES) {
      const bundle = composer.compose({ useCase, runtimePrompt: RUNTIME_PROMPT });
      for (const vendorId of VENDORS) {
        const effective = bundle.systemPromptForVendor(vendorId);
        out[`${promptMode}/${useCase}/${vendorId}`] = {
          rolePromptPath: bundle.rolePromptPath,
          usesSoul: bundle.usesSoul,
          usesRolePrompt: bundle.usesRolePrompt,
          length: effective ? effective.length : 0,
          sha256: effective
            ? crypto.createHash('sha256').update(effective).digest('hex')
            : null,
          prompt: effective,
        };
      }
    }
  }
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  const file = path.join(OUT_DIR, 'effective-prompts.json');
  const current = capture();
  const serialised = JSON.stringify(current, null, 2) + '\n';

  if (!check) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(file, serialised);
    console.log(`Wrote ${Object.keys(current).length} baselines to ${path.relative(process.cwd(), file)}`);
    return 0;
  }

  if (!fs.existsSync(file)) {
    console.error('No baseline recorded. Run without --check first.');
    return 1;
  }

  const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  const drift = [];
  for (const k of keys) {
    const a = previous[k];
    const b = current[k];
    if (!a) { drift.push(`+ ${k} (new)`); continue; }
    if (!b) { drift.push(`- ${k} (removed)`); continue; }
    if (a.sha256 !== b.sha256) {
      drift.push(`~ ${k} (${a.length} -> ${b.length} chars)`);
    }
  }

  if (drift.length === 0) {
    console.log(`Effective prompts unchanged across ${keys.size} combinations.`);
    return 0;
  }

  console.error('Effective prompt drift detected:\n' + drift.map(d => '  ' + d).join('\n'));
  console.error('\nIf this change is intended, re-run without --check and review the diff.');
  return 1;
}

process.exit(main());
