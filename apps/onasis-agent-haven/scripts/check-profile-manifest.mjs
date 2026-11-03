#!/usr/bin/env node
// Checks the profile-manifest generator against the AI router's real contract.
//
//   node scripts/check-profile-manifest.mjs
//
// Imports src/lib/profileManifest.ts directly (Node type stripping) and the
// router's own profile-resolver.js, so a drift in REQUIRED_MANIFEST_FIELDS or
// validateManifest fails here instead of at the router's startup.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateManifest, validateManifestLocally, REQUIRED_MANIFEST_FIELDS as OUR_REQUIRED } from '../src/lib/profileManifest.ts';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const routerDir = resolve(here, '../../../services/onasis-ai-router');
const resolverPath = join(routerDir, 'core/profile-resolver.js');
const { validateManifest } = require(resolverPath);

const problems = [];

// The router does not export REQUIRED_MANIFEST_FIELDS, so read the list from its
// source and require our copy to match it exactly.
const block = readFileSync(resolverPath, 'utf8').match(/REQUIRED_MANIFEST_FIELDS\s*=\s*\[([\s\S]*?)\]/);
const REQUIRED_MANIFEST_FIELDS = block ? [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
if (!REQUIRED_MANIFEST_FIELDS.length) problems.push('could not read REQUIRED_MANIFEST_FIELDS from the router source');
if (JSON.stringify([...OUR_REQUIRED].sort()) !== JSON.stringify([...REQUIRED_MANIFEST_FIELDS].sort())) {
  problems.push(`REQUIRED_MANIFEST_FIELDS drifted: router [${REQUIRED_MANIFEST_FIELDS}] vs ours [${OUR_REQUIRED}]`);
}

// Every case: a task, the lane we expect, and whether the task is a read-only one.
const CASES = [
  ['Recall my saved notes and summarise what I decided last week', 'memory-analysis'],
  ['Refactor TypeScript code and find bugs in pull requests', 'code-assist'],
  ['Write blog posts and marketing copy for our launch', 'content-generation'],
  ['Answer customer support questions about billing', 'support-chat'],
  ['Show the dashboard metrics and explain usage trends', 'dashboard-assistant'],
  ['Translate what I type into terminal commands for the CLI', 'repl-nlp'],
  ['Onboarding guide for first-time landing page visitors', 'landing-guide'],
  ['Tell me a joke', 'ask-ai'],
];

const tmp = mkdtempSync(join(tmpdir(), 'profile-manifest-'));

for (const [task, expected] of CASES) {
  const { manifest, rationale } = generateManifest(task);
  if (manifest.boundUseCase !== expected) problems.push(`"${task}" -> ${manifest.boundUseCase}, expected ${expected}`);
  const missing = REQUIRED_MANIFEST_FIELDS.filter((f) => manifest[f] === undefined);
  if (missing.length) problems.push(`"${task}" is missing router-required fields: ${missing.join(', ')}`);
  if (manifest.allowedTools.includes('memory.write')) problems.push(`"${task}" includes memory.write but asks for no save`);
  if (!rationale.length) problems.push(`"${task}" returned no rationale`);
  if (!/^[a-z0-9-]{3,48}$/.test(manifest.profileId)) problems.push(`"${task}" produced invalid slug ${manifest.profileId}`);

  const local = validateManifestLocally(manifest);
  if (!local.valid) problems.push(`"${task}" fails local validation: ${local.errors.join(' ')}`);

  // The router's real validator, on a manifest read back from disk like the router does.
  const file = join(tmp, `${manifest.profileId}.json`);
  writeFileSync(file, JSON.stringify(manifest, null, 2));
  try {
    validateManifest(JSON.parse(readFileSync(file, 'utf8')), file);
  } catch (e) {
    problems.push(`router validateManifest rejected "${task}": ${e.message}`);
  }
}

// memory.write is allowed only for an explicit save request on repl-nlp.
const save = generateManifest('Turn my natural language into terminal commands and save the useful ones to memory').manifest;
if (save.boundUseCase !== 'repl-nlp' || !save.allowedTools.includes('memory.write')) {
  problems.push('a repl-nlp task that asks to save should include memory.write');
}
const saveElsewhere = generateManifest('Write a blog post and save it to memory').manifest;
if (saveElsewhere.allowedTools.includes('memory.write')) problems.push('memory.write granted outside repl-nlp');

// Negative cases the validator must catch.
const base = generateManifest('Recall my notes').manifest;
const mustFail = [
  ['system role', { ...base, allowedMessageRoles: ['user', 'system'] }],
  ['bad slug', { ...base, profileId: 'Not A Slug' }],
  ['unknown use case', { ...base, boundUseCase: 'no-such-lane' }],
  ['missing field', { ...base, limits: undefined }],
];
for (const [name, m] of mustFail) {
  if (validateManifestLocally(m).valid) problems.push(`local validator accepted a manifest with ${name}`);
}

// The shipped profile must be valid.
const shipped = JSON.parse(readFileSync(join(routerDir, 'profiles/l0-concierge.json'), 'utf8'));
const shippedResult = validateManifestLocally(shipped);
if (!shippedResult.valid) problems.push(`l0-concierge.json fails local validation: ${shippedResult.errors.join(' ')}`);

if (problems.length) {
  console.error('\n✖ Profile manifest check failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`✓ Profile manifest check passed (${CASES.length} tasks, router validateManifest agrees)`);
