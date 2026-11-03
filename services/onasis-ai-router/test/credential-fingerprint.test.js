'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fingerprint, describeVendorCredentials } = require('../core/credential-fingerprint');

// "Which account key is the router using?" must be answerable from logs
// without the key ever appearing in them.

const FAKE = 'sk-proj-' + 'A'.repeat(40) + 'tail9';

test('fingerprint is the sha256 prefix and never contains key material', () => {
  const fp = fingerprint(FAKE);
  assert.equal(fp.fp, crypto.createHash('sha256').update(FAKE).digest('hex').slice(0, 10));
  assert.equal(fp.type, 'sk-proj-');
  assert.equal(fp.length, FAKE.length);
  const serialised = JSON.stringify(fp);
  assert.ok(!serialised.includes('AAAA') && !serialised.includes('tail9'));
});

test('unset, blank and quoted keys are reported as such', () => {
  assert.deepEqual(fingerprint(undefined), { set: false });
  assert.deepEqual(fingerprint('   '), { set: false });
  assert.equal(fingerprint(`"${FAKE}"`).suspicious, true);
  assert.equal(fingerprint(`${FAKE}\n`).suspicious, true);
});

test('describeVendorCredentials reads exactly the env vars the adapters read', () => {
  const env = {
    OPENAI_API_KEY: FAKE,
    ANTHROPIC_API_KEY: 'sk-ant-api03-' + 'B'.repeat(30),
    ANTHROPIC_BASE_URL: 'https://proxy.example.com/v1?token=secret',
  };
  const d = describeVendorCredentials(env);
  assert.equal(d.openai.key_var, 'OPENAI_API_KEY');
  assert.equal(d.openai.endpoint, 'https://api.openai.com');
  assert.equal(d.openai.endpoint_source, 'default');
  assert.equal(d.anthropic.type, 'sk-ant-api03-');
  assert.equal(d.anthropic.endpoint, 'https://proxy.example.com', 'query/path never logged');
  assert.equal(d.anthropic.endpoint_source, 'ANTHROPIC_BASE_URL');
  assert.equal(d.minimax.set, false);
  assert.ok(!JSON.stringify(d).includes('BBBB'));
});
