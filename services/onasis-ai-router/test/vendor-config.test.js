'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NEVER_ENABLE,
  envSuffix,
  parseList,
  pickModel,
  resolveVendorOrder,
  resolveVendorStatus,
} = require('../vendors/vendor-config');

// Which vendor is tried first is an operational decision — it changes when a
// provider runs out of credit, when a token expires, or when one turns out to
// be wrong for a lane. Every one of those was a literal in vendors/index.js, so
// reacting meant editing code and redeploying a live router.
//
// The case that prompted this: repl-nlp led with ollama. The local 3B CPU model
// decides to call a tool well enough and reads a long tool result back poorly,
// so the synthesis pass timed out and every REPL search degraded to a raw
// record dump. Nothing was broken; the order was wrong for that lane.

const KNOWN = new Set(['minimax', 'openclaw', 'openai', 'anthropic', 'ollama', 'deepseek']);
const DEFAULT_ORDER = ['minimax', 'openclaw', 'openai', 'anthropic', 'ollama'];

const withEnv = (vars, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

const order = (useCase = 'repl-nlp', opts = {}) =>
  resolveVendorOrder(useCase, DEFAULT_ORDER, { knownVendorIds: KNOWN, ...opts });

test('with nothing set, the code default stands', () => {
  withEnv({ AI_VENDOR_ORDER: undefined, AI_VENDOR_ORDER_REPL_NLP: undefined }, () => {
    assert.deepEqual(order(), DEFAULT_ORDER);
  });
});

test('a global override replaces the order', () => {
  withEnv({ AI_VENDOR_ORDER: 'ollama, minimax', AI_VENDOR_ORDER_REPL_NLP: undefined }, () => {
    assert.deepEqual(order(), ['ollama', 'minimax'], 'whitespace around entries is tolerated');
  });
});

test('a use-case override beats the global one', () => {
  // The narrower statement is the more deliberate one.
  withEnv({ AI_VENDOR_ORDER: 'ollama', AI_VENDOR_ORDER_REPL_NLP: 'anthropic,minimax' }, () => {
    assert.deepEqual(order('repl-nlp'), ['anthropic', 'minimax']);
    assert.deepEqual(order('ask-ai'), ['ollama'], 'other lanes still take the global');
  });
});

test('the use-case env key is derived from the use case name', () => {
  assert.equal(envSuffix('repl-nlp'), 'REPL_NLP');
  assert.equal(envSuffix('dashboard-assistant'), 'DASHBOARD_ASSISTANT');
  assert.equal(envSuffix('ask-ai'), 'ASK_AI');
});

test('an unknown vendor is dropped and reported, not fatal', () => {
  // A typo in an env var must not take the router down.
  const warnings = [];
  withEnv({ AI_VENDOR_ORDER: 'minimax,nope', AI_VENDOR_ORDER_REPL_NLP: undefined }, () => {
    assert.deepEqual(order('repl-nlp', { onWarn: (m) => warnings.push(m) }), ['minimax']);
  });
  assert.match(warnings.join(' '), /unknown vendors: nope/);
});

test('an override that matches nothing falls back rather than serving nothing', () => {
  // An empty chain is a mistake, not an instruction to refuse every request.
  const warnings = [];
  withEnv({ AI_VENDOR_ORDER: 'nope,bogus', AI_VENDOR_ORDER_REPL_NLP: undefined }, () => {
    assert.deepEqual(order('repl-nlp', { onWarn: (m) => warnings.push(m) }), DEFAULT_ORDER);
  });
  assert.match(warnings.join(' '), /falling back to the built-in order/);
});

test('an empty override is treated as unset', () => {
  withEnv({ AI_VENDOR_ORDER: '   ,  ,', AI_VENDOR_ORDER_REPL_NLP: undefined }, () => {
    assert.deepEqual(order(), DEFAULT_ORDER);
  });
});

// ── status toggles ──────────────────────────────────────────────────────────

test('a vendor can be taken out of every chain from the environment', () => {
  withEnv({ AI_VENDOR_DISABLED: 'minimax,openclaw', AI_VENDOR_ENABLED: undefined }, () => {
    assert.equal(resolveVendorStatus('minimax', 'active'), 'disabled');
    assert.equal(resolveVendorStatus('openai', 'active'), 'active');
  });
});

test('a stub can be promoted to active from the environment', () => {
  withEnv({ AI_VENDOR_ENABLED: 'deepseek', AI_VENDOR_DISABLED: undefined }, () => {
    assert.equal(resolveVendorStatus('deepseek', 'stub'), 'active');
  });
});

test('disable beats enable', () => {
  // Naming a vendor in both is contradictory; the safe reading of a
  // contradiction is the one that serves less traffic.
  withEnv({ AI_VENDOR_ENABLED: 'deepseek', AI_VENDOR_DISABLED: 'deepseek' }, () => {
    assert.equal(resolveVendorStatus('deepseek', 'stub'), 'disabled');
  });
});

test('supabase-edge cannot be enabled by configuration', () => {
  // It targets VortexCore's own AI router — a consuming application of THIS
  // router, so enabling it creates a cycle — and hardcodes a product persona
  // no caller payload can override. A config flag is exactly the wrong way to
  // bring either back.
  const warnings = [];
  withEnv({ AI_VENDOR_ENABLED: 'supabase-edge', AI_VENDOR_DISABLED: undefined }, () => {
    const status = resolveVendorStatus('supabase-edge', 'deprecated', { onWarn: (m) => warnings.push(m) });
    assert.equal(status, 'deprecated');
  });
  assert.match(warnings.join(' '), /cannot enable supabase-edge/);
  assert.ok(NEVER_ENABLE.get('supabase-edge'), 'the reason must be recorded, not just the rule');
});

test('an untouched vendor keeps its declared status', () => {
  withEnv({ AI_VENDOR_ENABLED: undefined, AI_VENDOR_DISABLED: undefined }, () => {
    assert.equal(resolveVendorStatus('hermes', 'stub'), 'stub');
    assert.equal(resolveVendorStatus('ollama', 'active'), 'active');
  });
});

// ── model selection ─────────────────────────────────────────────────────────

test('an empty model env var reads as unset, not as an empty model', () => {
  // `process.env.X || 'literal'` already does this; pickModel also trims, so a
  // stray space in a .env line cannot become the model name.
  assert.equal(pickModel('', 'fallback'), 'fallback');
  assert.equal(pickModel('   ', 'fallback'), 'fallback');
  assert.equal(pickModel(undefined, 'fallback'), 'fallback');
  assert.equal(pickModel('  MiniMax-M3  ', 'fallback'), 'MiniMax-M3');
});

test('parseList tolerates the shapes a .env line actually takes', () => {
  assert.deepEqual(parseList('a,b'), ['a', 'b']);
  assert.deepEqual(parseList(' a , b '), ['a', 'b']);
  assert.deepEqual(parseList('a,,b'), ['a', 'b']);
  assert.deepEqual(parseList(''), []);
  assert.deepEqual(parseList(undefined), []);
});
