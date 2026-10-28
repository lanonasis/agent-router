#!/usr/bin/env node
// Fails the build when the agent-draft form can no longer report field errors.
//
//   node scripts/check-agent-draft-schema.mjs
//
// Why this exists. The draft form validates through @hookform/resolvers'
// zodResolver, and those two have to agree on the shape of a schema failure:
//
//   zod v3  ->  ZodError.errors   (an array of issues)
//   zod v4  ->  ZodError.issues   (`.errors` was removed)
//
// @hookform/resolvers v3.x reads `.errors`. Against zod v4 that is `undefined`,
// so the resolver cannot map issues onto fields and rethrows the raw ZodError —
// the form throws instead of showing "Agent name is required".
//
// That combination shipped once: zod was bumped to v4 while the resolver stayed
// on v3.x. Nothing caught it, because the app still BUILDS (zod is only used at
// build time here) and the router's test suite does not touch the form. The
// break only appears when a person opens the Agent create page.
//
// This check imports the real schema and the real resolver, submits an invalid
// draft, and fails if the resolver throws or fails to map a field error. It
// passes for both supported pairings — resolvers v3 + zod v3, and resolvers v5
// + zod v4 — so it pins the contract, not one particular version pair.

import { zodResolver } from '@hookform/resolvers/zod';
import { agentDraftSchema } from '../src/lib/agentDraftUtils.ts';

// The shape react-hook-form actually calls a resolver with. The resolver's
// error mapping reads `criteriaMode` and `shouldUseNativeValidation` out of it,
// and returns no field errors at all when they are missing — which would make
// this check pass vacuously.
const RHF_OPTIONS = { criteriaMode: 'firstError', shouldUseNativeValidation: false, fields: {} };

const VALID_DRAFT = {
  name: 'Ada',
  slug: 'ada',
  role: 'Sub-Agent',
  agentRole: 'Researcher',
  soulSummary: 'A short summary.',
  purpose: 'A purpose.',
  temperature: 0.3,
  risenPrompt: 'A prompt.',
};

async function resolve(values) {
  const resolver = zodResolver(agentDraftSchema);
  // @hookform/resolvers v5 returns a promise; v3 returned a plain object.
  return await resolver(values, {}, RHF_OPTIONS);
}

const problems = [];

// 1. A valid draft must validate cleanly.
try {
  const valid = await resolve({ ...VALID_DRAFT });
  const fields = valid?.errors ? Object.keys(valid.errors) : [];
  if (fields.length) problems.push(`a valid draft reported errors on: ${fields.join(', ')}`);
} catch (error) {
  problems.push(`a valid draft threw ${error?.constructor?.name}: ${error?.message}`);
}

// 2. An invalid draft must come back as field errors, not as an exception.
try {
  const invalid = await resolve({ ...VALID_DRAFT, name: '', slug: 'Not A Slug' });
  const errors = invalid?.errors ?? {};
  if (!errors.name) problems.push('an invalid draft did not report an error on the "name" field');
  if (!errors.slug) problems.push('an invalid draft did not report an error on the "slug" field');
} catch (error) {
  problems.push(
    `an invalid draft threw ${error?.constructor?.name} instead of returning field errors — ` +
      'the resolver and the installed zod major disagree on the error shape ' +
      '(zod v4 removed ZodError.errors, which @hookform/resolvers v3 reads)',
  );
}

if (problems.length) {
  console.error('\n✖ Agent draft schema check failed — the draft form cannot validate:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nKeep zod, @hookform/resolvers and react-hook-form in step.\n' +
      'Supported pairings: @hookform/resolvers v3 + zod v3, or @hookform/resolvers >=5.9 + zod v4.\n',
  );
  process.exit(1);
}
console.log('✓ Agent draft schema check passed');
