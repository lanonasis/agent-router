'use strict';

// The startup lane gate.
//
// `server.js` calls `process.exit(1)` at module scope when the shipped
// configuration violates a lane contract. That makes `server.js`
// unimportable from a test, so the gate is exercised here through the
// exported `assertLaneConfiguration` helper — the same function the server
// calls — rather than by spawning a child process.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { assertLaneConfiguration, LANES } = require('../vendors/vendor-config');
const { USE_CASES, VENDOR_REGISTRY, KNOWN_VENDOR_IDS } = require('../vendors');

function cloneRegistry() {
  return Object.fromEntries(
    Object.entries(VENDOR_REGISTRY).map(([id, vendor]) => [id, { ...vendor }]),
  );
}

test('LANES is the single source of truth for lane names', () => {
  assert.equal(LANES.COMPLETION, 'completion');
  assert.equal(LANES.AGENT, 'agent');
  assert.ok(Object.isFrozen(LANES), 'LANES must be frozen');
});

test('every declared lane in the registry uses a LANES value', () => {
  const valid = new Set(Object.values(LANES));
  for (const [vendorId, vendor] of Object.entries(VENDOR_REGISTRY)) {
    assert.ok(
      valid.has(vendor.lane),
      `vendor "${vendorId}" declares a lane outside LANES: ${vendor.lane}`,
    );
  }
  for (const [useCase, config] of Object.entries(USE_CASES)) {
    assert.ok(
      valid.has(config.lane),
      `use case "${useCase}" declares a lane outside LANES: ${config.lane}`,
    );
  }
});

test('the vendor registry is frozen against runtime reassignment', () => {
  assert.ok(
    Object.isFrozen(VENDOR_REGISTRY),
    'a stray assignment must not be able to replace a vendor definition after the boot gate passed',
  );
});

test('the shipped configuration passes the startup gate', () => {
  const result = assertLaneConfiguration({
    useCases: USE_CASES,
    vendorRegistry: VENDOR_REGISTRY,
    knownVendorIds: KNOWN_VENDOR_IDS,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
});

test('the startup gate throws on a lane violation', () => {
  const badRegistry = cloneRegistry();
  delete badRegistry.hermes.lane;

  assert.throws(
    () => assertLaneConfiguration({
      useCases: USE_CASES,
      vendorRegistry: badRegistry,
      knownVendorIds: KNOWN_VENDOR_IDS,
    }),
    (error) => {
      assert.match(error.message, /lane-typing validation failed at startup/);
      assert.match(error.message, /registry-vendor-lane-missing/);
      assert.match(error.message, /hermes/);
      assert.ok(Array.isArray(error.violations) && error.violations.length > 0);
      return true;
    },
  );
});

test('the startup gate throws on the env-override bypass', () => {
  // AI_VENDOR_ORDER_ASK_AI=openclaw would put an agent-lane vendor into a
  // completion lane. The gate must reject it even though the source config
  // is clean.
  const original = process.env.AI_VENDOR_ORDER_ASK_AI;
  try {
    process.env.AI_VENDOR_ORDER_ASK_AI = 'openclaw';
    assert.throws(
      () => assertLaneConfiguration({
        useCases: USE_CASES,
        vendorRegistry: VENDOR_REGISTRY,
        knownVendorIds: KNOWN_VENDOR_IDS,
      }),
      (error) => {
        assert.match(error.message, /completion-lane-agent-vendor/);
        assert.match(error.message, /openclaw/);
        return true;
      },
    );
  } finally {
    if (original === undefined) delete process.env.AI_VENDOR_ORDER_ASK_AI;
    else process.env.AI_VENDOR_ORDER_ASK_AI = original;
  }
});

test('the startup gate error lists every violation, not just the first', () => {
  const badRegistry = cloneRegistry();
  delete badRegistry.hermes.lane;
  delete badRegistry.ollama.lane;

  try {
    assertLaneConfiguration({
      useCases: USE_CASES,
      vendorRegistry: badRegistry,
      knownVendorIds: KNOWN_VENDOR_IDS,
    });
    assert.fail('expected the gate to throw');
  } catch (error) {
    assert.ok(
      error.violations.some((v) => v.vendor === 'hermes'),
      'expected a hermes violation',
    );
    assert.ok(
      error.violations.some((v) => v.vendor === 'ollama'),
      'expected an ollama violation',
    );
  }
});
