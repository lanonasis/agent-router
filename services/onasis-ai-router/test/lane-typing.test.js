// ── Lane-typing validator (Phase 5, spec §7) ──────────────────────────────────
// Validates that every vendor and use case declares a lane, that the pairing
// obeys the completion/agent rules, and that the token floor is enforced.
//
// Uses node:test + node:assert/strict, matching the style of vendor-config.test.js.
// No network, no live vendors, no real timers.

'use strict';

const { test } = require('node:test');

/**
 * Deep-clone the vendor registry.
 *
 * A shallow spread is NOT enough: `delete badRegistry.lmstudio.lane` on a
 * shallow copy deletes the lane from the SHARED registry object, silently
 * poisoning every later test in this file (and any other module holding the
 * same registry instance). Each test that mutates the registry must clone it.
 */
function cloneRegistry() {
  return Object.fromEntries(
    Object.entries(VENDOR_REGISTRY).map(([id, vendor]) => [id, { ...vendor }]),
  );
}
const assert = require('node:assert/strict');

const {
  validateLaneConfiguration,
  resolveAgentLaneMinTokens,
} = require('../vendors/vendor-config');
const {
  USE_CASES,
  VENDOR_REGISTRY,
  KNOWN_VENDOR_IDS,
} = require('../vendors');

/* ------------------------------------------------------------------ helpers */

/**
 * Temporarily set environment variables for a test, then restore them.
 * Matches the pattern used in test/vendor-config.test.js.
 */
function withEnv(pairs, fn) {
  const saved = new Map();
  for (const [k] of Object.entries(pairs)) {
    saved.set(k, process.env[k]);
  }
  for (const [k, v] of Object.entries(pairs)) {
    if (v === null || v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    fn();
  } finally {
    for (const [k] of Object.entries(pairs)) {
      const orig = saved.get(k);
      if (orig === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = orig;
      }
    }
  }
}

/* ------------------------------------------------------------------ tests */

test('resolveAgentLaneMinTokens reads the default when env is unset', () => {
  withEnv({ AGENT_LANE_MIN_TOKENS: undefined }, () => {
    const val = resolveAgentLaneMinTokens();
    assert.equal(val, 2000);
  });
});

test('resolveAgentLaneMinTokens honours a valid env value', () => {
  withEnv({ AGENT_LANE_MIN_TOKENS: '3000' }, () => {
    const val = resolveAgentLaneMinTokens();
    assert.equal(val, 3000);
  });
});

test('resolveAgentLaneMinTokens warns and keeps default for non-numeric', () => {
  let warned = false;
  withEnv({ AGENT_LANE_MIN_TOKENS: 'abc' }, () => {
    const val = resolveAgentLaneMinTokens({
      onWarn: (msg) => { warned = true; },
    });
    assert.equal(val, 2000);
    assert.equal(warned, true);
  });
});

test('resolveAgentLaneMinTokens warns and keeps default for zero', () => {
  let warned = false;
  withEnv({ AGENT_LANE_MIN_TOKENS: '0' }, () => {
    const val = resolveAgentLaneMinTokens({
      onWarn: (msg) => { warned = true; },
    });
    assert.equal(val, 2000);
    assert.equal(warned, true);
  });
});

test('resolveAgentLaneMinTokens warns and keeps default for negative', () => {
  let warned = false;
  withEnv({ AGENT_LANE_MIN_TOKENS: '-1' }, () => {
    const val = resolveAgentLaneMinTokens({
      onWarn: (msg) => { warned = true; },
    });
    assert.equal(val, 2000);
    assert.equal(warned, true);
  });
});

test('shipped configuration is valid (0 violations)', () => {
  // Isolate from ambient env: any AI_MAX_TOKENS_* or AI_VENDOR_ORDER* set
  // in the operator shell would otherwise cause false violations.
  withEnv({
    AI_MAX_TOKENS: undefined,
    AGENT_LANE_MIN_TOKENS: undefined,
  }, () => {
    const result = validateLaneConfiguration({
      useCases: USE_CASES,
      vendorRegistry: VENDOR_REGISTRY,
      knownVendorIds: KNOWN_VENDOR_IDS,
    });
    assert.equal(result.valid, true);
    assert.equal(result.violations.length, 0);
  });
});


test('AI_VENDOR_ORDER env override: agent vendor in completion lane is rejected', () => {
  // The validator must check the runtime-resolved chain (resolveVendorOrder),
  // not just the declared vendorOrder. This is the highest-value test: it pins
  // the interaction between the two escape hatches.
  withEnv({ AI_VENDOR_ORDER_ASK_AI: 'openclaw' }, () => {
    const result = validateLaneConfiguration({
      useCases: USE_CASES,
      vendorRegistry: VENDOR_REGISTRY,
      knownVendorIds: KNOWN_VENDOR_IDS,
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.violations.some((v) => v.code === 'completion-lane-agent-vendor'),
      'expected completion-lane-agent-vendor violation via AI_VENDOR_ORDER env',
    );
  });
});

test('completion-lane use case with agent vendor is rejected', () => {
  const badUseCases = { ...USE_CASES };
  badUseCases['ask-ai'] = {
    ...badUseCases['ask-ai'],
    lane: 'completion',
    vendorOrder: [...badUseCases['ask-ai'].vendorOrder, 'openclaw'],
  };
  const result = validateLaneConfiguration({
    useCases: badUseCases,
    vendorRegistry: VENDOR_REGISTRY,
    knownVendorIds: KNOWN_VENDOR_IDS,
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.violations.some((v) => v.code === 'completion-lane-agent-vendor'),
    'expected completion-lane-agent-vendor violation',
  );
});

test('agent-lane use case below floor is rejected', () => {
  const badUseCases = { ...USE_CASES };
  badUseCases['dashboard-assistant'] = {
    ...badUseCases['dashboard-assistant'],
    maxTokens: 500,
  };
  const result = validateLaneConfiguration({
    useCases: badUseCases,
    vendorRegistry: VENDOR_REGISTRY,
    knownVendorIds: KNOWN_VENDOR_IDS,
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.violations.some((v) => v.code === 'agent-lane-token-floor'),
    'expected agent-lane-token-floor violation',
  );
});

test('agent-lane floor is enforced against EFFECTIVE maxTokens (env override)', () => {
  // The shipped dashboard-assistant is at 2000 — valid. Lower it via env.
  withEnv({ AI_MAX_TOKENS_DASHBOARD_ASSISTANT: '500' }, () => {
    const result = validateLaneConfiguration({
      useCases: USE_CASES,
      vendorRegistry: VENDOR_REGISTRY,
      knownVendorIds: KNOWN_VENDOR_IDS,
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.violations.some((v) => v.code === 'agent-lane-token-floor'),
      'expected agent-lane-token-floor violation via env override',
    );
  });
});

test('agent-lane floor not triggered when env override raises ceiling', () => {
  // Raise an agent-lane ceiling above floor via env — entire config must be valid.
  withEnv({ AI_MAX_TOKENS_DASHBOARD_ASSISTANT: '5000' }, () => {
    const result = validateLaneConfiguration({
      useCases: USE_CASES,
      vendorRegistry: VENDOR_REGISTRY,
      knownVendorIds: KNOWN_VENDOR_IDS,
    });
    assert.equal(result.valid, true);
  });
});

test('AGENT_LANE_MIN_TOKENS env override lowers the floor', () => {
  // With the shipped dashboard-assistant (agent lane, 2000 tokens),
  // lower the floor to 1000 — the 2000 ceiling should still pass.
  withEnv({ AGENT_LANE_MIN_TOKENS: '1000' }, () => {
    const result = validateLaneConfiguration({
      useCases: USE_CASES,
      vendorRegistry: VENDOR_REGISTRY,
      knownVendorIds: KNOWN_VENDOR_IDS,
    });
    assert.equal(result.valid, true);
    assert.equal(result.violations.length, 0);
  });
});

test('unknown vendor id in a chain is rejected', () => {
  const badUseCases = { ...USE_CASES };
  badUseCases['ask-ai'] = {
    ...badUseCases['ask-ai'],
    vendorOrder: [...badUseCases['ask-ai'].vendorOrder, 'nonexistent'],
  };
  const result = validateLaneConfiguration({
    useCases: badUseCases,
    vendorRegistry: VENDOR_REGISTRY,
    knownVendorIds: KNOWN_VENDOR_IDS,
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.violations.some((v) => v.code === 'unknown-vendor'),
    'expected unknown-vendor violation',
  );
});

test('vendor missing lane declaration is rejected', () => {
  const badRegistry = cloneRegistry();
  delete badRegistry.lmstudio.lane;
  const result = validateLaneConfiguration({
    useCases: USE_CASES,
    vendorRegistry: badRegistry,
    knownVendorIds: KNOWN_VENDOR_IDS,
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.violations.some((v) => v.code === 'registry-vendor-lane-missing'),
    'expected registry-vendor-lane-missing violation',
  );
});

test('a vendor that never appears in any chain must still declare a lane', () => {
  // hermes, ollama, supabase-edge and deepseek never appear in a vendorOrder.
  // Their lane declaration used to be unchecked: deleting hermes.lane would
  // still boot cleanly. The hermes lane is deliberate — it stops a status
  // flip from smuggling an unclassified vendor into a chain — so the guard
  // has to be registry-wide, not chain-scoped.
  const badRegistry = cloneRegistry();
  delete badRegistry.hermes.lane;

  const result = validateLaneConfiguration({
    useCases: USE_CASES,
    vendorRegistry: badRegistry,
    knownVendorIds: KNOWN_VENDOR_IDS,
  });

  assert.equal(result.valid, false, 'an undeclared vendor must fail validation');
  const violation = result.violations.find(
    (v) => v.code === 'registry-vendor-lane-missing' && v.vendor === 'hermes',
  );
  assert.ok(violation, 'expected a registry-wide violation naming hermes');
});

test('every registered vendor declares a valid lane in the shipped config', () => {
  const result = validateLaneConfiguration({
    useCases: USE_CASES,
    vendorRegistry: VENDOR_REGISTRY,
    knownVendorIds: KNOWN_VENDOR_IDS,
  });

  const laneViolations = result.violations.filter(
    (v) => v.code === 'registry-vendor-lane-missing' || v.code === 'registry-vendor-lane-invalid',
  );
  assert.deepEqual(
    laneViolations,
    [],
    'every registered vendor must declare a lane',
  );
});

test('an unknown vendor lane is rejected registry-wide', () => {
  const badRegistry = cloneRegistry();
  badRegistry.hermes = { ...badRegistry.hermes, lane: 'not-a-lane' };
  const result = validateLaneConfiguration({
    useCases: USE_CASES,
    vendorRegistry: badRegistry,
    knownVendorIds: KNOWN_VENDOR_IDS,
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.violations.some(
      (v) => v.code === 'registry-vendor-lane-invalid' && v.vendor === 'hermes',
    ),
    'expected registry-vendor-lane-invalid violation for hermes',
  );
});

test('a registry-wide violation is reported once, not duplicated per use case', () => {
  const badRegistry = cloneRegistry();
  delete badRegistry.hermes.lane;
  const result = validateLaneConfiguration({
    useCases: USE_CASES,
    vendorRegistry: badRegistry,
    knownVendorIds: KNOWN_VENDOR_IDS,
  });

  const hermesViolations = result.violations.filter(
    (v) => v.vendor === 'hermes' && String(v.code).includes('lane-missing'),
  );
  assert.equal(
    hermesViolations.length,
    1,
    `expected exactly one hermes lane violation, got ${hermesViolations.length}`,
  );
});

test('use case missing lane declaration is rejected', () => {
  const badUseCases = { ...USE_CASES };
  delete badUseCases['ask-ai'].lane;
  const result = validateLaneConfiguration({
    useCases: badUseCases,
    vendorRegistry: VENDOR_REGISTRY,
    knownVendorIds: KNOWN_VENDOR_IDS,
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.violations.some((v) => v.code === 'use-case-lane-missing'),
    'expected use-case-lane-missing violation',
  );
});
