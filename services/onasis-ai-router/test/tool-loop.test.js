'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolLoop } = require('../core/tool-loop');

// Regression guard for the Phase 1 extraction: two static class properties were
// referenced as AIServiceRouter.* from inside tool-loop.js, where that class is
// out of scope. Live symptom was a 500 "AIServiceRouter is not defined" on the
// memory-analysis lane — the lane the Slack/Discord concierges use. npm test
// missed it because nothing exercised the tool-definitions path.

test('getToolDefinitionsForUseCase resolves without a ReferenceError', () => {
  const tl = new ToolLoop({ logger: console });
  const tools = tl.getToolDefinitionsForUseCase('memory-analysis');
  assert.ok(Array.isArray(tools), 'must return an array');
});

test('read-only memory tools are offered on a non-write use case', () => {
  const tl = new ToolLoop({ logger: console });
  const names = tl.getToolDefinitionsForUseCase('ask-ai').map((t) => t?.function?.name);
  assert.ok(names.includes('memory.search'), 'memory.search must be offered');
  assert.ok(names.includes('memory.get'), 'memory.get must be offered');
});

test('the secret-filename guard still matches sensitive files', () => {
  const tl = new ToolLoop({ logger: console });
  for (const f of ['/x/.env', '/x/id_rsa', '/x/server.key', '/x/.npmrc']) {
    assert.equal(tl._isSecretFilename(f), true, `${f} must be treated as secret`);
  }
  assert.equal(tl._isSecretFilename('/x/index.js'), false);
});

// ── PR #1 review (Copilot, 2026-09-03): code.find_related sandbox escape ─────
// toolCodeFindRelated ran `rg -l <feature>` and a `grep -r -l <feature> .`
// fallback with neither a path argument nor a cwd, so both inherited the router
// process's working directory. On this host that directory is the router's own
// source tree, which holds .env, .env.production and .env.keys (the dotenvx
// PRIVATE key) — outside CODE_BASE_DIR, which is correctly set to
// /opt/lanonasis/mcp-core. Every sibling code.* tool routes through
// _resolveRestrictedPath; this one did not.
//
// `rg` also treats the term as a regex by default and the metacharacter filter
// blocks ;&|`$<>\ but not ^ . * [ ] ( ) + ? — so `rg -l "^DOTENV_PRIVATE"`
// against that directory was a working oracle over secret file contents.

const path = require('path');
const os = require('os');
const fs = require('fs');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolloop-'));
  fs.writeFileSync(path.join(dir, 'feature-a.js'), 'const NEEDLE_TOKEN = 1;\n');
  fs.writeFileSync(path.join(dir, '.env.production'), 'NEEDLE_TOKEN=supersecret\n');
  return dir;
}

test('code.find_related is blocked when CODE_BASE_DIR is unset', async () => {
  const prev = process.env.CODE_BASE_DIR;
  delete process.env.CODE_BASE_DIR;
  try {
    const tl = new ToolLoop({ logger: { warn() {}, info() {}, error() {} } });
    const out = JSON.parse(await tl.toolCodeFindRelated({ feature: 'NEEDLE_TOKEN' }));
    assert.ok(out.error, 'must fail closed, not search the process cwd');
    assert.ok(!out.files, 'must not return any file list');
  } finally {
    if (prev === undefined) delete process.env.CODE_BASE_DIR; else process.env.CODE_BASE_DIR = prev;
  }
});

test('code.find_related searches only inside CODE_BASE_DIR', async () => {
  const dir = sandbox();
  const prev = process.env.CODE_BASE_DIR;
  process.env.CODE_BASE_DIR = dir;
  try {
    const tl = new ToolLoop({ logger: { warn() {}, info() {}, error() {} } });
    const out = JSON.parse(await tl.toolCodeFindRelated({ feature: 'NEEDLE_TOKEN' }));
    assert.ok(out.success, `expected success, got ${JSON.stringify(out)}`);
    assert.ok(out.files.some((f) => f.includes('feature-a.js')), 'finds the in-sandbox match');
    for (const f of out.files) {
      assert.ok(!path.isAbsolute(f) || f.startsWith(dir),
        `result escaped the sandbox: ${f}`);
    }
  } finally {
    if (prev === undefined) delete process.env.CODE_BASE_DIR; else process.env.CODE_BASE_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('code.find_related never lists secret-shaped filenames', async () => {
  const dir = sandbox();
  const prev = process.env.CODE_BASE_DIR;
  process.env.CODE_BASE_DIR = dir;
  try {
    const tl = new ToolLoop({ logger: { warn() {}, info() {}, error() {} } });
    const out = JSON.parse(await tl.toolCodeFindRelated({ feature: 'NEEDLE_TOKEN' }));
    assert.ok(out.success);
    for (const f of out.files) {
      assert.equal(tl._isSecretFilename(f), false, `secret file leaked in results: ${f}`);
    }
  } finally {
    if (prev === undefined) delete process.env.CODE_BASE_DIR; else process.env.CODE_BASE_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('code.find_related refuses to escape via a ../ directory argument', async () => {
  const dir = sandbox();
  const prev = process.env.CODE_BASE_DIR;
  process.env.CODE_BASE_DIR = dir;
  try {
    const tl = new ToolLoop({ logger: { warn() {}, info() {}, error() {} } });
    const out = JSON.parse(await tl.toolCodeFindRelated({
      feature: 'NEEDLE_TOKEN', directory: '../../..',
    }));
    assert.ok(out.error, 'traversal must be rejected');
  } finally {
    if (prev === undefined) delete process.env.CODE_BASE_DIR; else process.env.CODE_BASE_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
