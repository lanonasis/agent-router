# @lanonasis/agent-runtime

**LanguageModelV2 adapter that wraps the Onasis AI router, enabling VoltAgent's Agent class to run on the production vendor chain.**

## Architecture

```
VoltAgent / AI SDK v6 harness
       │
       ▼  LanguageModelV2CallOptions
┌─────────────────────┐
│     LangAdapter     │  ← thin translation layer (~350 lines)
│  doGenerate/doStream│
└────────┬────────────┘
         │
         ▼  ChainExecutor.run()
┌─────────────────────────────────┐
│   Onasis AI Router (existing)   │  ← vendor chain, fallback, circuit-breaker
│   · scoreboards · retry logic   │
│   · tool execution (memory.*)   │
│   · synthesis pass              │
│   · 9 vendor adapters           │
└─────────────────────────────────┘
```

**Key design rule:** The adapter is a protocol translator only. It does NOT replicate vendor chain logic — it delegates to the existing `ChainExecutor` which handles vendor selection, fallback, circuit-breaker, tool execution, and synthesis.

## Installation

```bash
npm install @lanonasis/agent-runtime
# or
bun add @lanonasis/agent-runtime
```

Peer dependencies (optional):
- `@voltagent/core` — for VoltAgent integration
- `@ai-sdk/provider` — LanguageModelV2 types

## Usage with VoltAgent

```javascript
const { createLangAdapter } = require('@lanonasis/agent-runtime');
const { Agent } = require('@voltagent/core');

// Create the adapter
const model = createLangAdapter({
  modelId: 'lzero',          // Exposed model ID
  provider: 'onasis',         // Provider name
  useCase: 'dashboard-assistant',  // Router use-case lane
  maxTokens: 2000,            // Override (optional)
  temperature: 0.75,          // Override (optional)
});

// Use with VoltAgent
const agent = new Agent({ model });

// Run!
const result = await agent.run({
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello!' }] }],
});
```

## Usage with AI SDK v6

```javascript
const { createLangAdapter } = require('@lanonasis/agent-runtime');
const { streamText, generateText } = require('ai');

const model = createLangAdapter();

// Non-streaming
const result = await generateText({
  model,
  prompt: 'Explain quantum computing',
  maxTokens: 500,
});

// Streaming
const { textStream } = await streamText({
  model,
  prompt: 'Write a haiku',
});

for await (const chunk of textStream) {
  process.stdout.write(chunk);
}
```

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `modelId` | `'lzero'` | Model ID exposed to SDK callers |
| `provider` | `'onasis'` | Provider name for SDK metadata |
| `useCase` | `'dashboard-assistant'` | Router use-case lane |
| `maxTokens` | `lane default` | Override max output tokens |
| `temperature` | `lane default` | Override temperature |
| `apiBaseUrl` | env/API default | Memory service base URL |
| `authGatewayUrl` | env/API default | Auth gateway URL |
| `promptsRoot` | bundled | Path to prompt model files |

## Supported Use Cases

The adapter supports all router use cases:
- `dashboard-assistant` (default) — full conversational assistant
- `ask-ai` — quick answers
- `landing-guide` — onboarding guide
- `support-chat` — customer support
- `content-generation` — marketing/content
- `code-assist` — developer assistance
- `memory-analysis` — memory intelligence
- `memory-analysis-json` — JSON memory tasks
- `repl-nlp` — REPL natural language

## Vendor Chain

Each use case has an ordered fallback chain:

| Use Case | Vendor Order |
|----------|-------------|
| dashboard-assistant | pi → minimax → openclaw → openai → anthropic → lmstudio |
| ask-ai | pi → minimax → openai → anthropic → lmstudio |
| code-assist | minimax → pi → openclaw → openai → anthropic → lmstudio |

## API Reference

### `createLangAdapter(options?)` → `LangAdapter`

Factory function. Preferred over direct `new LangAdapter()`.

### `LangAdapter.doGenerate(options)` → `Promise<LanguageModelV2GenerateResult>`

Generate a single response. Calls the router's chain executor and returns a
LanguageModelV2-compatible result with:
- `content`: array of text, tool-call, and reasoning parts
- `finishReason`: `'stop'`, `'length'`, `'tool-calls'`, etc.
- `usage`: `{ inputTokens, outputTokens, totalTokens }`
- `providerMetadata`: `{ selectedVendor, selectedModel, vendorChain }`

### `LangAdapter.doStream(options)` → `Promise<LanguageModelV2StreamResult>`

Stream a response. Since the router doesn't natively support streaming, this
buffers the full response and emits it as a sequence of
`LanguageModelV2StreamPart` objects.

### `LangAdapter.hasAvailableVendors()` → `boolean`

Check if at least one active vendor is available for the configured use-case.

## Limitations

1. **Streaming is simulated** — the router does not support native SSE streaming.
   `doStream()` buffers and replays as stream parts.
2. **Image/audio/file inputs** — not yet supported by the router.
3. **Structured output** (`output: { type: 'json' }`) — forwarded as `tools` to the router.
4. **Provider metadata** — `selectedVendor` and `selectedModel` are available on the `providerMetadata` field.

## Development

```bash
# Run tests
npm test
# or
node test/lang-adapter.test.js
```

## Files

```
packages/agent-runtime/
├── package.json
├── src/
│   ├── index.js          # Entry point (exports LangAdapter, createLangAdapter)
│   ├── lang-adapter.js   # Main adapter implementation (~400 lines)
│   └── types.ts          # TypeScript type definitions
└── test/
    └── lang-adapter.test.js  # 93 assertions across 10 test categories
```
