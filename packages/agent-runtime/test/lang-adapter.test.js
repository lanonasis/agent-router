#!/usr/bin/env node
'use strict';

/**
 * Tests for LangAdapter — LanguageModelV2 adapter wrapping the Onasis AI router.
 *
 * These tests verify:
 *  1. Adapter instantiation and basic properties
 *  2. Prompt translation (LanguageModelV2 → router message format)
 *  3. Response translation (router response → LanguageModelV2 result)
 *  4. Tool call translation in both directions
 *  5. Error handling when no vendors are available
 *
 * NOTE: These are SPIKE tests — they verify the adapter's translation logic,
 * not full end-to-end vendor calls. For that, a real router instance is needed.
 */

const path = require('path');

// ─── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertEq(actual, expected, message) {
  total++;
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
}

// ─── 1. Adapter instantiation ─────────────────────────────────────────────────

console.log('\n─── 1. Adapter Instantiation ───');

const { LangAdapter } = require('../src/lang-adapter');

try {
  const adapter = new LangAdapter();
  assert(adapter.specificationVersion === 'v2', 'specificationVersion is "v2"');
  assert(adapter.provider === 'onasis', 'provider is "onasis"');
  assert(adapter.modelId === 'lzero', 'modelId is "lzero"');
  assert(typeof adapter.doGenerate === 'function', 'doGenerate is a function');
  assert(typeof adapter.doStream === 'function', 'doStream is a function');
  assert(typeof adapter.hasAvailableVendors === 'function', 'hasAvailableVendors is a function');

  // Custom options
  const customAdapter = new LangAdapter({
    modelId: 'custom-model',
    provider: 'my-provider',
    useCase: 'code-assist',
  });
  assertEq(customAdapter.modelId, 'custom-model', 'custom modelId');
  assertEq(customAdapter.provider, 'my-provider', 'custom provider');
  assertEq(customAdapter.useCase, 'code-assist', 'custom useCase');
} catch (err) {
  console.error(`  ✗ Adapter instantiation failed: ${err.message}`);
  console.error(err.stack);
  failed += 5;
  total += 5;
}

// ─── 2. Prompt translation ────────────────────────────────────────────────────

console.log('\n─── 2. Prompt Translation ───');

try {
  const adapter = new LangAdapter();

  // System + user prompt
  const prompt1 = [
    {
      role: 'system',
      content: [{ type: 'text', text: 'You are a helpful assistant.' }],
    },
    {
      role: 'user',
      content: [{ type: 'text', text: 'Hello!' }],
    },
  ];

  const messages1 = adapter._translatePromptToMessages(prompt1);
  assertEq(messages1.length, 2, 'system + user → 2 messages');
  assertEq(messages1[0].role, 'system', 'system role preserved');
  assertEq(messages1[0].content, 'You are a helpful assistant.', 'system content');
  assertEq(messages1[1].role, 'user', 'user role preserved');
  assertEq(messages1[1].content, 'Hello!', 'user content');

  // Multi-part user message
  const prompt2 = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is ' },
        { type: 'text', text: '2+2?' },
      ],
    },
  ];
  const messages2 = adapter._translatePromptToMessages(prompt2);
  assertEq(messages2.length, 1, 'multi-part user → 1 message');
  assertEq(messages2[0].content, 'What is \n2+2?', 'multi-part user content joined');

  // Empty/null content
  const prompt3 = [
    { role: 'user', content: [] },
    { role: 'user', content: null },
  ];
  const messages3 = adapter._translatePromptToMessages(prompt3);
  assertEq(messages3.length, 0, 'empty/null content → no messages');

  // Tool result message
  const prompt4 = [
    {
      role: 'tool',
      toolCallId: 'call_123',
      toolName: 'memory.search',
      content: [{ type: 'text', text: '{"results": []}' }],
    },
  ];
  const messages4 = adapter._translatePromptToMessages(prompt4);
  assertEq(messages4.length, 1, 'tool result → 1 message');
  assertEq(messages4[0].role, 'tool', 'tool role');
  assertEq(messages4[0].tool_call_id, 'call_123', 'tool_call_id preserved');
  assertEq(messages4[0].tool_name, 'memory.search', 'tool_name preserved');
  assertEq(messages4[0].content, '{"results": []}', 'tool content');

  // Multi-turn conversation
  const prompt5 = [
    { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Hello! How can I help?' }] },
    { role: 'user', content: [{ type: 'text', text: 'What is AI?' }] },
  ];
  const messages5 = adapter._translatePromptToMessages(prompt5);
  assertEq(messages5.length, 3, 'multi-turn → 3 messages');
  assertEq(messages5[0].role, 'user', 'first user');
  assertEq(messages5[1].role, 'assistant', 'assistant preserved');
  assertEq(messages5[2].role, 'user', 'second user');

  // Reasoning parts are stripped
  const prompt6 = [
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Let me think...' },
        { type: 'text', text: 'The answer is 4.' },
      ],
    },
  ];
  const messages6 = adapter._translatePromptToMessages(prompt6);
  assertEq(messages6.length, 1, 'reasoning + text → 1 message');
  assertEq(messages6[0].content, 'The answer is 4.', 'reasoning stripped, text kept');
} catch (err) {
  console.error(`  ✗ Prompt translation failed: ${err.message}`);
  console.error(err.stack);
}

// ─── 3. Tool call translation ─────────────────────────────────────────────────

console.log('\n─── 3. Tool Call Translation ───');

try {
  const adapter = new LangAdapter();

  // Tool calls from assistant
  const prompt7 = [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me search my memory.' },
      ],
      toolCalls: [
        {
          toolCallId: 'call_abc',
          toolName: 'memory.search',
          args: { query: 'onasis', topK: 5 },
        },
      ],
    },
  ];
  const messages7 = adapter._translatePromptToMessages(prompt7);
  assertEq(messages7.length, 1, 'assistant with tool calls → 1 message');
  assertEq(messages7[0].tool_calls.length, 1, 'tool_calls array present');
  assertEq(messages7[0].tool_calls[0].id, 'call_abc', 'tool call id');
  assertEq(messages7[0].tool_calls[0].name, 'memory.search', 'tool call name');
  assertEq(messages7[0].tool_calls[0].arguments, { query: 'onasis', topK: 5 }, 'tool call args as object');

  // Tools translation: AI SDK format → router format
  const sdkTools = [
    {
      type: 'function',
      function: {
        name: 'memory.search',
        description: 'Search memories',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            topK: { type: 'integer', minimum: 1 },
          },
          required: ['query'],
        },
      },
    },
  ];
  const routerTools = adapter._translateTools(sdkTools);
  assertEq(routerTools.length, 1, 'tools array length preserved');
  assertEq(routerTools[0].type, 'function', 'tool type is function');
  assertEq(routerTools[0].function.name, 'memory.search', 'tool name preserved');
  assertEq(routerTools[0].function.parameters.type, 'object', 'schema converted to parameters');
  assertEq(routerTools[0].function.parameters.properties.query.type, 'string', 'property type preserved');

  // Response with tool calls
  const adapterResponse = {
    message: { role: 'assistant', content: '' },
    done_reason: 'tool_calls',
    tool_calls: [
      { id: 'call_xyz', name: 'memory.search', arguments: { query: 'onasis', topK: 5 } },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };

  const result = adapter._translateResponseToGenerateResult(adapterResponse, {
    tools: sdkTools,
  });

  assertEq(result.finishReason, 'tool-calls', 'finishReason is tool-calls');
  assertEq(result.content.length, 1, 'one tool-call content part');
  assertEq(result.content[0].type, 'tool-call', 'content part type');
  assertEq(result.content[0].toolCallId, 'call_xyz', 'tool call id from response');
  assertEq(result.content[0].toolName, 'memory.search', 'tool name from response');
  assertEq(result.usage.inputTokens, 100, 'input tokens');
  assertEq(result.usage.outputTokens, 50, 'output tokens');
  assertEq(result.usage.totalTokens, 150, 'total tokens');
  // providerMetadata is set in doGenerate after translation, not in translateResponseToGenerateResult

  // Response with soft tool call in text
  const adapterResponseSoft = {
    message: {
      role: 'assistant',
      content: '```json\n{"tool": "memory.get", "arguments": {"ids": ["abc123"]}}\n```',
    },
    done_reason: 'stop',
    tool_calls: [],
    usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
  };

  const resultSoft = adapter._translateResponseToGenerateResult(adapterResponseSoft, {
    tools: [
      {
        type: 'function',
        function: {
          name: 'memory.get',
          description: 'Get memories by id',
          inputSchema: { type: 'object', properties: { ids: { type: 'array' } }, required: ['ids'] },
        },
      },
    ],
  });

  assertEq(resultSoft.finishReason, 'tool-calls', 'soft tool call → finishReason tool-calls');
  // Soft tool call in text creates: 1 text part (prose) + 1 tool-call part
  assertEq(resultSoft.content.length, 2, 'soft tool call: prose + tool-call parts');
  const toolPart = resultSoft.content.find(p => p.type === 'tool-call');
  assertEq(toolPart.toolName, 'memory.get', 'soft tool name');
} catch (err) {
  console.error(`  ✗ Tool call translation failed: ${err.message}`);
  console.error(err.stack);
}

// ─── 4. Finish reason mapping ─────────────────────────────────────────────────

console.log('\n─── 4. Finish Reason Mapping ───');

try {
  const adapter = new LangAdapter();

  // 'stop' stays 'stop'
  let r = adapter._translateResponseToGenerateResult(
    { message: { content: 'Hello', role: 'assistant' }, done_reason: 'stop' },
    {}
  );
  assertEq(r.finishReason, 'stop', '"stop" → "stop"');

  // 'length' / 'max_tokens' → 'length'
  r = adapter._translateResponseToGenerateResult(
    { message: { content: 'Hello wo', role: 'assistant' }, done_reason: 'length' },
    {}
  );
  assertEq(r.finishReason, 'length', '"length" → "length"');

  r = adapter._translateResponseToGenerateResult(
    { message: { content: 'Hello wo', role: 'assistant' }, done_reason: 'max_tokens' },
    {}
  );
  assertEq(r.finishReason, 'length', '"max_tokens" → "length"');

  // 'tool_calls' / 'tool_use' → 'tool-calls'
  r = adapter._translateResponseToGenerateResult(
    { message: { content: '', role: 'assistant' }, done_reason: 'tool_calls', tool_calls: [{ id: '1', name: 'x', arguments: {} }] },
    {}
  );
  assertEq(r.finishReason, 'tool-calls', '"tool_calls" → "tool-calls"');

  r = adapter._translateResponseToGenerateResult(
    { message: { content: '', role: 'assistant' }, done_reason: 'tool_use', tool_calls: [{ id: '1', name: 'x', arguments: {} }] },
    {}
  );
  assertEq(r.finishReason, 'tool-calls', '"tool_use" → "tool-calls"');

  // Default to 'stop'
  r = adapter._translateResponseToGenerateResult(
    { message: { content: 'Hello', role: 'assistant' } },
    {}
  );
  assertEq(r.finishReason, 'stop', 'missing done_reason → "stop"');
} catch (err) {
  console.error(`  ✗ Finish reason mapping failed: ${err.message}`);
  console.error(err.stack);
}

// ─── 5. Usage translation ─────────────────────────────────────────────────────

console.log('\n─── 5. Usage Translation ───');

try {
  const adapter = new LangAdapter();

  // Normal usage
  let u = adapter._translateUsage({
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
  });
  assertEq(u.inputTokens, 100, 'prompt_tokens → inputTokens');
  assertEq(u.outputTokens, 50, 'completion_tokens → outputTokens');
  assertEq(u.totalTokens, 150, 'total_tokens → totalTokens');

  // Partial usage (missing total)
  u = adapter._translateUsage({
    prompt_tokens: 100,
    completion_tokens: 50,
  });
  assertEq(u.totalTokens, 150, 'total inferred from prompt + completion');

  // Empty usage
  u = adapter._translateUsage({});
  assertEq(u.inputTokens, undefined, 'empty → undefined input');
  assertEq(u.outputTokens, undefined, 'empty → undefined output');
  assertEq(u.totalTokens, undefined, 'empty → undefined total');

  // Null usage
  u = adapter._translateUsage(null);
  assertEq(u.inputTokens, undefined, 'null → undefined input');
} catch (err) {
  console.error(`  ✗ Usage translation failed: ${err.message}`);
  console.error(err.stack);
}

// ─── 6. Vendor chain resolution ───────────────────────────────────────────────

console.log('\n─── 6. Vendor Chain Resolution ───');

try {
  const adapter = new LangAdapter({ useCase: 'dashboard-assistant' });
  const chain = adapter._vendorChain;
  assert(Array.isArray(chain), 'vendor chain is an array');

  if (chain.length > 0) {
    assertEq(chain[0]._vendorId, chain[0]._vendorId, 'chain vendors have _vendorId');
    assertEq(typeof chain[0]._adapter, 'object', 'chain vendors have _adapter');

    // Check that pi is first for dashboard-assistant (per VENDOR_REGISTRY)
    assertEq(chain[0]._vendorId, 'pi', 'first vendor for dashboard-assistant is "pi"');
  }

  // hasAvailableVendors
  assert(adapter.hasAvailableVendors() === (chain.length > 0), 'hasAvailableVendors matches chain length');
} catch (err) {
  console.error(`  ✗ Vendor chain resolution failed: ${err.message}`);
  console.error(err.stack);
}

// ─── 7. Stream parts building ─────────────────────────────────────────────────

console.log('\n─── 7. Stream Parts Building ───');

try {
  const adapter = new LangAdapter();

  const generateResult = {
    content: [
      { type: 'text', text: 'Hello, ' },
      { type: 'text', text: 'world!' },
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'memory.search', args: { query: 'test' } },
    ],
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    providerMetadata: { selectedVendor: 'pi' },
    request: { body: {} },
    response: { id: 'msg_1', model: 'lzero' },
    warnings: [],
  };

  const streamParts = adapter._buildStreamParts(generateResult, {});
  const types = streamParts.map(p => p.type);

  assert(types.includes('stream-start'), 'stream-start present');
  assert(types.includes('response-metadata'), 'response-metadata present');
  assert(types.includes('text-start'), 'text-start present');
  assert(types.includes('text-delta'), 'text-delta present');
  assert(types.includes('text-end'), 'text-end present');
  assert(types.includes('finish'), 'finish present');

  // Find finish part
  const finishPart = streamParts.find(p => p.type === 'finish');
  assertEq(finishPart.finishReason, 'stop', 'finish reason in stream');
  assertEq(finishPart.usage.inputTokens, 10, 'usage in stream finish');

  // Count text deltas
  const textDeltas = streamParts.filter(p => p.type === 'text-delta');
  assertEq(textDeltas.length, 2, 'two text deltas for two text parts');
} catch (err) {
  console.error(`  ✗ Stream parts building failed: ${err.message}`);
  console.error(err.stack);
}

// ─── 8. Soft tool call extraction ─────────────────────────────────────────────

console.log('\n─── 8. Soft Tool Call Extraction ───');

try {
  const adapter = new LangAdapter();

  // Fenced JSON
  let calls = adapter._extractSoftToolCalls('```json\n{"tool_calls":[{"id":"1","name":"x","arguments":{"a":1}}]}\n```');
  assertEq(calls.length, 1, 'fenced JSON tool_calls parsed');
  assertEq(calls[0].name, 'x', 'tool name from fenced');
  assertEq(JSON.stringify(calls[0].arguments), JSON.stringify({ a: 1 }), 'args from fenced');

  // Bare object
  calls = adapter._extractSoftToolCalls('{"tool":"y","arguments":{"b":2}}');
  assertEq(calls.length, 1, 'bare object parsed');
  assertEq(calls[0].name, 'y', 'tool name from bare');

  // No tool call
  calls = adapter._extractSoftToolCalls('Just some text.');
  assertEq(calls.length, 0, 'no tool call in plain text');

  // Empty
  calls = adapter._extractSoftToolCalls('');
  assertEq(calls.length, 0, 'empty string → no calls');
} catch (err) {
  console.error(`  ✗ Soft tool call extraction failed: ${err.message}`);
  console.error(err.stack);
}

// ─── 9. Schema conversion ─────────────────────────────────────────────────────

console.log('\n─── 9. Schema Conversion ───');

try {
  const adapter = new LangAdapter();

  // Simple object schema
  const schema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      topK: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['query'],
  };

  const params = adapter._schemaToParameters(schema);
  assertEq(params.type, 'object', 'object type preserved');
  assertEq(params.properties.query.type, 'string', 'string property');
  assertEq(params.properties.topK.type, 'integer', 'integer property');
  assertEq(params.properties.query.description, 'Search query', 'property description');
  assertEq(params.required, ['query'], 'required array preserved');

  // Array schema
  const arrSchema = {
    type: 'array',
    items: { type: 'string' },
  };
  const arrParams = adapter._schemaToParameters(arrSchema);
  assertEq(arrParams.type, 'array', 'array type');
  assertEq(arrParams.items.type, 'string', 'array items type');

  // Empty schema
  const emptyParams = adapter._schemaToParameters({});
  assertEq(Object.keys(emptyParams).length, 0, 'empty schema → empty params');
} catch (err) {
  console.error(`  ✗ Schema conversion failed: ${err.message}`);
  console.error(err.stack);
}

// ─── 10. Error handling ───────────────────────────────────────────────────────

console.log('\n─── 10. Error Handling ───');

(async () => {
  try {
    // Adapter with no available vendors (mock a scenario where chain is empty)
    const adapter = new LangAdapter({ useCase: 'nonexistent-lane' });

    // The vendor chain will be empty, so doGenerate should throw
    try {
      await adapter.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
      });
      console.error('  ✗ Expected error for nonexistent lane');
      failed++;
    } catch (err) {
      assert(err.message.includes('No active AI vendor') || err.code === 'VENDOR_UNAVAILABLE',
        'throws VENDOR_UNAVAILABLE for no vendors');
    }
  } catch (err) {
    console.error(`  ✗ Error handling test failed: ${err.message}`);
    console.error(err.stack);
  }
  // Print summary after async test completes
  console.log(`\n═══ Results ═══`);
  console.log(`  Total assertions: ${total}`);
  console.log(`  Passed:           ${passed}`);
  console.log(`  Failed:           ${failed}`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n  All tests passed ✓\n');
    process.exit(0);
  }
})();

// Abort summary if the async block finishes early (error in setup)
setTimeout(() => {
  if (total > 0) {
    console.log(`\n═══ Results ═══`);
    console.log(`  Total assertions: ${total}`);
    console.log(`  Passed:           ${passed}`);
    console.log(`  Failed:           ${failed}`);

    if (failed > 0) {
      process.exit(1);
    } else {
      console.log('\n  All tests passed ✓\n');
      process.exit(0);
    }
  }
}, 3000);
