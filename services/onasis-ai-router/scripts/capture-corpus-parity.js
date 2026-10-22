#!/usr/bin/env node
'use strict';

/**
 * Record the relationship between the two model-file corpora, and fail when it
 * moves without review.
 *
 * There are two:
 *
 *   packages/agent-model-files                      (Agent Heaven, canonical,
 *                                                    flat, created by 30be88c)
 *   services/onasis-ai-router/agent_model_files     (what the router actually
 *                                                    composes from, nested,
 *                                                    untouched since 2026-03-11)
 *
 * capture-prompt-baseline.js already pins the router side: change a file there
 * and the effective prompt moves and the baseline fails. Nothing pinned the
 * package side, so Agent Heaven could edit the canonical corpus and every check
 * in this repo would still pass while the two drifted further apart. That is
 * the specific hole this closes.
 *
 * This does NOT assert the corpora are equal. They are not — every shared file
 * differs, and adopting the package wholesale would shrink the effective prompt
 * by 24-36% per lane (measured 2026-09-11, see `--report`). Asserting equality
 * would just fail forever and get skipped. It records the divergence as it
 * stands today so that any *new* movement on either side has to be looked at.
 *
 * Usage:
 *   node scripts/capture-corpus-parity.js            # record current state
 *   node scripts/capture-corpus-parity.js --check    # fail if either side moved
 *   node scripts/capture-corpus-parity.js --report   # human-readable delta
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROUTER_CORPUS = path.resolve(__dirname, '..', 'agent_model_files');
const PACKAGE_CORPUS = path.resolve(__dirname, '..', '..', '..', 'packages', 'agent-model-files');
const OUT = path.resolve(__dirname, '..', 'test', '__baselines__', 'corpus-parity.json');

// Logical file -> its path in each corpus. The package is flat; the router
// groups by kind. Same documents, different shelving.
const PAIRS = Object.freeze({
  'SOUL.md': ['SOUL.md', 'SOUL.md'],
  'IDENTITY-LAYER.md': ['IDENTITY-LAYER.md', 'IDENTITY-LAYER.md'],
  'SOURCE-OF-TRUTH.md': ['SOURCE-OF-TRUTH.md', 'SOURCE-OF-TRUTH.md'],
  'base.md': ['base.md', 'orchestrator/base.md'],
  'policies.md': ['policies.md', 'orchestrator/policies.md'],
  'tools.md': ['tools.md', 'orchestrator/tools.md'],
  'generic.md': ['generic.md', 'frameworks/generic.md'],
  'coder.md': ['coder.md', 'subagents/coder.md'],
  'researcher.md': ['researcher.md', 'subagents/researcher.md'],
  'reviewer.md': ['reviewer.md', 'subagents/reviewer.md'],
  'architect.md': ['architect.md', 'subagents/architect.md'],
  'tester.md': ['tester.md', 'subagents/tester.md'],
});

// Present in one corpus only. Listed rather than ignored, so that a file
// appearing or vanishing is itself drift.
// `lanes/` arrived on 2026-09-11 when the lane prompts moved out of
// vendors/index.js. Router-only for now: the canonical package has role
// prompts but no lanes, so pointing PROMPTS_ROOT at it falls back to the
// bundled copies. Merging the corpora means giving the package a lanes/ too,
// at which point these become PAIRS entries.
const ROUTER_ONLY = Object.freeze([
  'subagents/coder-ts.md',
  'build-source-of-truth.py',
  'sync-source-of-truth.py',
  'lanes/onboarding.md',
  'lanes/concise-helper.md',
  'lanes/full-assistant.md',
  'lanes/support.md',
  'lanes/creative.md',
  'lanes/technical.md',
  'lanes/memory-intelligence.md',
  'lanes/repl-assistant.md',
]);
const PACKAGE_ONLY = Object.freeze(['package.json', 'sync-source-of-truth.py']);

const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);
const sha = (p) => {
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8').split(CRLF).join(LF);
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
};

const lines = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').length : null);

function snapshot() {
  const files = {};
  for (const [logical, [pkgRel, routerRel]] of Object.entries(PAIRS)) {
    const pkgPath = path.join(PACKAGE_CORPUS, pkgRel);
    const routerPath = path.join(ROUTER_CORPUS, routerRel);
    files[logical] = {
      package: { path: pkgRel, sha: sha(pkgPath), lines: lines(pkgPath) },
      router: { path: routerRel, sha: sha(routerPath), lines: lines(routerPath) },
      identical: sha(pkgPath) !== null && sha(pkgPath) === sha(routerPath),
    };
  }
  const only = (root, list) => list.map((rel) => ({ path: rel, present: fs.existsSync(path.join(root, rel)) }));
  return {
    note: 'Divergence recorded as-is. See scripts/capture-corpus-parity.js for why this is not an equality assertion.',
    files,
    routerOnly: only(ROUTER_CORPUS, ROUTER_ONLY),
    packageOnly: only(PACKAGE_CORPUS, PACKAGE_ONLY),
  };
}

function main() {
  const mode = process.argv[2];
  const current = snapshot();

  if (mode === '--report') {
    const rows = Object.entries(current.files);
    console.log('logical file'.padEnd(22), 'package'.padEnd(9), 'router'.padEnd(9), 'state');
    console.log('-'.repeat(60));
    for (const [name, f] of rows) {
      const state = f.identical ? 'identical'
        : (f.package.sha === null ? 'missing in package'
          : f.router.sha === null ? 'missing in router' : 'DIFFERS');
      console.log(name.padEnd(22), String(f.package.lines).padEnd(9), String(f.router.lines).padEnd(9), state);
    }
    const differing = rows.filter(([, f]) => !f.identical).length;
    console.log(`\n${differing}/${rows.length} shared files differ.`);
    return;
  }

  if (mode === '--check') {
    if (!fs.existsSync(OUT)) {
      console.error(`No parity baseline at ${OUT}. Run without --check to record one.`);
      process.exit(1);
    }
    const recorded = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const a = JSON.stringify(recorded, null, 2);
    const b = JSON.stringify(current, null, 2);
    if (a !== b) {
      const moved = Object.entries(current.files)
        .filter(([n, f]) => JSON.stringify(f) !== JSON.stringify(recorded.files?.[n]))
        .map(([n]) => n);
      console.error('Model-file corpus drift.');
      if (moved.length) console.error('  moved: ' + moved.join(', '));
      console.error('\nOne of the two corpora changed. Neither is authoritative yet, so this');
      console.error('is not automatically wrong — but it must be a decision, not a side effect.');
      console.error('If intended: re-run scripts/capture-corpus-parity.js and review the diff.');
      process.exit(1);
    }
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(current, null, 2) + '\n');
  console.log(`Recorded corpus parity for ${Object.keys(current.files).length} shared files -> ${path.relative(process.cwd(), OUT)}`);
}

main();
