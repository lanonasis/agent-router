#!/usr/bin/env node
// Self-check for the documented-vs-live persona reconciliation.
//
//   node scripts/check-persona-sync.mjs
//
// Imports the real pure `reconcile` (Node strips the types) and asserts the
// three sync states.

import { reconcile, summarise } from '../src/lib/personaSync.ts';

const agent = (id, role) => ({ id, name: id, role, description: '', type: 'Sub-Agent', status: 'active', createdAt: '' });
const persona = (useCase, role) => ({
  useCase, description: 'd', role, laneKey: null, tools: [], streamable: false,
  status: 'active', servingCapacity: { available: 1, declared: 2 },
});
const profile = (profileId) => ({
  profileId, applicationId: profileId, version: '1', status: 'active', boundUseCase: 'x', allowedTools: [], memoryMode: 'off',
});

const docs = [agent('coder', 'Coder'), agent('researcher', 'Researcher'), agent('tester', 'Tester')];
const catalog = {
  personas: [persona('memory-analysis', 'RESEARCHER'), persona('chat', null)],
  profiles: [profile('coder'), profile('mystery')],
  knownTools: [],
  generatedAt: '',
};

const problems = [];
const entries = reconcile(docs, catalog);
const stateOf = (id) => entries.find((e) => e.kind === 'agent' && e.agent.id === id)?.state;

if (stateOf('researcher') !== 'synced') problems.push('researcher should be synced via case-insensitive role match');
if (stateOf('coder') !== 'synced') problems.push('coder should be synced via live profile');
if (stateOf('tester') !== 'doc-only') problems.push('tester should be doc-only');
if (!entries.some((e) => e.kind === 'persona' && e.persona.useCase === 'chat' && e.state === 'live-only')) problems.push('chat persona should be live-only');
if (entries.some((e) => e.kind === 'persona' && e.persona.useCase === 'memory-analysis')) problems.push('matched persona must not be live-only');
if (!entries.some((e) => e.kind === 'profile' && e.profile.profileId === 'mystery')) problems.push('unmatched profile should be live-only');
if (entries.some((e) => e.kind === 'profile' && e.profile.profileId === 'coder')) problems.push('matched profile must not be live-only');
const sum = summarise(entries);
if (sum.documentedNotServed !== 1 || sum.documentedSynced !== 2 || sum.liveOnly !== 2) problems.push(`bad summary ${JSON.stringify(sum)}`);

const none = reconcile(docs, null);
if (!none.every((e) => e.state === 'doc-only')) problems.push('with no catalog every documented agent should be doc-only');

if (problems.length) {
  console.error('Persona sync check failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('Persona sync check passed.');
