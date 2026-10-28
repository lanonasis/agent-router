#!/usr/bin/env node
// Fails the build when a secret could reach, or has reached, the public bundle.
//
//   node scripts/check-bundle-secrets.mjs --env    before `vite build`
//   node scripts/check-bundle-secrets.mjs --dist   after `vite build`
//
// --env:  every VITE_* variable is shipped to browsers. Refuse names that look
//         like secrets, and values that are secret credentials.
// --dist: scan the built files for secret credentials, and for the literal
//         value of any non-VITE secret-looking build variable (catches a
//         server secret inlined through `define`, `import.meta.env` or similar).
//
// Only variable names and file paths are printed, never values.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SECRET_NAME = /(SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|JWT|DATABASE_URL)/i;
const SERVER_SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PRIVATE|DATABASE_URL)/i;
const ALLOWED_PUBLIC_ROLES = new Set(['anon', 'authenticated']);

const CREDENTIAL_PATTERNS = [
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{10,}/g],
  ['Lanonasis API key', /\blano_[A-Za-z0-9_-]{24,}/g],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  ['GitHub token', /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g;

function jwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.role === 'string' ? payload.role : '(none)';
  } catch {
    return null; // not a decodable JWT, ignore
  }
}

function findCredentials(text) {
  const hits = [];
  for (const [label, re] of CREDENTIAL_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) hits.push(label);
  }
  for (const token of text.match(JWT) ?? []) {
    const role = jwtRole(token);
    if (role !== null && !ALLOWED_PUBLIC_ROLES.has(role)) hits.push(`JWT with role "${role}"`);
  }
  return [...new Set(hits)];
}

function checkEnv() {
  const problems = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith('VITE_') || !value) continue;
    if (SECRET_NAME.test(name)) problems.push(`${name}: name marks it as a secret, but VITE_* is public`);
    const hits = findCredentials(value);
    if (hits.length) problems.push(`${name}: value is a ${hits.join(', ')}`);
  }
  return problems;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(js|mjs|cjs|html|css|json|map|txt|webmanifest)$/.test(entry)) out.push(path);
  }
  return out;
}

// Values that are public by construction may legitimately appear in the bundle,
// even when a server-side variable holds the same value (for example the
// Netlify↔Supabase integration's SUPABASE_ANON_KEY).
function isPublicValue(value, publicValues) {
  if (publicValues.has(value)) return true;
  if (value.startsWith('sb_publishable_')) return true;
  if (/^eyJ[^.]+\.eyJ[^.]+\.[^.]+$/.test(value)) return ALLOWED_PUBLIC_ROLES.has(jwtRole(value));
  return false;
}

function checkDist(distDir) {
  const publicValues = new Set(
    Object.entries(process.env).filter(([name, value]) => name.startsWith('VITE_') && value).map(([, value]) => value),
  );
  const serverSecrets = Object.entries(process.env)
    .filter(([name, value]) => !name.startsWith('VITE_') && SERVER_SECRET_NAME.test(name) && value && value.length >= 20)
    .filter(([, value]) => !isPublicValue(value, publicValues));
  const problems = [];
  for (const file of walk(distDir)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(process.cwd(), file);
    for (const hit of findCredentials(text)) problems.push(`${rel}: contains a ${hit}`);
    for (const [name, value] of serverSecrets) {
      if (text.includes(value)) problems.push(`${rel}: contains the value of build variable ${name}`);
    }
  }
  return problems;
}

const mode = process.argv[2];
let problems;
if (mode === '--env') problems = checkEnv();
else if (mode === '--dist') problems = checkDist(process.argv[3] ?? 'dist');
else {
  console.error('usage: check-bundle-secrets.mjs --env | --dist [dir]');
  process.exit(2);
}

if (problems.length) {
  console.error(`\n✖ Secret check (${mode}) failed — the public bundle must not carry secrets:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nMove the value to a server-side variable (no VITE_ prefix) or remove it.\n');
  process.exit(1);
}
console.log(`✓ Secret check (${mode}) passed`);
