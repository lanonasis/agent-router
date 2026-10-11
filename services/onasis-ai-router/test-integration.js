#!/usr/bin/env node
'use strict';

// Test integration of DeepSeek vendor with AI router
const vendors = require('./vendors/index');

console.log('Testing AI Router vendor integration...\n');

// Test 1: Check that new use cases are defined
console.log('Test 1: Use case definitions');
const useCases = ['memory-analysis', 'repl-nlp'];
for (const uc of useCases) {
  const config = vendors.USE_CASES[uc];
  if (config) {
    console.log(`  ✓ ${uc}: ${config.description}`);
  } else {
    console.log(`  ✗ ${uc}: NOT FOUND`);
  }
}

// Test 2: Check DeepSeek vendor registration
console.log('\nTest 2: Vendor registry');
const deepseek = vendors.VENDOR_REGISTRY.deepseek;
if (deepseek) {
  console.log(`  ✓ DeepSeek vendor found, status: ${deepseek.status}`);
  console.log(`    Models: speed=${deepseek.models.speed}, quality=${deepseek.models.quality}`);
  console.log(`    Capabilities: ${deepseek.capabilities.join(', ')}`);
  console.log(`    Fallback vendor: ${deepseek.fallbackVendor}`);
} else {
  console.log('  ✗ DeepSeek vendor NOT FOUND');
}

// Test 3: Resolve vendor for memory-analysis use case
console.log('\nTest 3: Resolve vendor for memory-analysis');
try {
  const config = vendors.resolveVendorForUseCase('memory-analysis');
  console.log(`  ✓ Resolved vendor: ${config._vendorId}`);
  console.log(`    Model: ${config._model}`);
  console.log(`    System prompt length: ${config.systemPrompt.length}`);
} catch (err) {
  console.log(`  ✗ Error: ${err.message}`);
}

// Test 4: Resolve vendor chain for repl-nlp
console.log('\nTest 4: Resolve vendor chain for repl-nlp');
try {
  const chain = vendors.resolveVendorChainForUseCase('repl-nlp');
  console.log(`  ✓ Chain length: ${chain.length}`);
  chain.forEach((vendor, idx) => {
    console.log(`    ${idx + 1}. ${vendor._vendorId} (${vendor._model})`);
  });
} catch (err) {
  console.log(`  ✗ Error: ${err.message}`);
}

// Test 5: Load DeepSeek adapter
console.log('\nTest 5: DeepSeek adapter loading');
if (deepseek && deepseek.adapter) {
  try {
    const adapter = deepseek.adapter;
    console.log(`  ✓ Adapter loaded: ${typeof adapter.chat === 'function' ? 'chat function present' : 'missing chat'}`);
    console.log(`    Health check: ${typeof adapter.healthCheck === 'function' ? 'present' : 'missing'}`);
  } catch (err) {
    console.log(`  ✗ Error loading adapter: ${err.message}`);
  }
} else {
  console.log('  ✗ No adapter found');
}

console.log('\n✅ Integration test completed.');