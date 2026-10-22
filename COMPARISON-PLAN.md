# VoltAgent vs Onasis Agent Haven — Feature Comparison & Replication Plan

> **Superseded 2026-10-22.** The baseline measurements below were re-derived
> against the live tree, and the plan's core recommendation ("copy VoltAgent
> core's `agent.ts`") was rejected. See
> [`docs/2026-10-22-voltagent-adoption-evaluation.md`](docs/2026-10-22-voltagent-adoption-evaluation.md)
> for the decision record: **enhance the router, do not replace it**. This file
> is kept for history; do not execute it as written.

## 1. HEAD-TO-HEAD METRICS

| Metric | VoltAgent | Onasis Agent Haven | Delta |
|--------|-----------|-------------------|-------|
| **TypeScript files** | ~600+ across packages | 21 in apps + 0 TS in router | VoltAgent 28x more |
| **Total lines** | ~243,585 (packages only) | ~1,845 TS + ~20K JS router | VoltAgent 10x more |
| **Packages** | 35 scoped packages | 3 packages (agent-contracts, agent-model-files, memory-client) | Need expansion |
| **Examples** | 79 example apps | 1 (the app itself) | Need examples |
| **Test files** | 205 test/spec files | ~40 JS test files (router only) | Good: router has tests |
| **Package Manager** | pnpm + Lerna + nx | **bun** (bun.lock) | Keep bun |
| **Runtime** | Node 20+ | Node 22 (router) + Bun (app) | Compatible |
| **Version** | 2.11.0 (main), 1.0.0-next (next) | 1.0.0 | Early stage |

## 2. WHAT YOU ALREADY HAVE (AND VOLTAGENT DOESNT HAVE)

You have some things VoltAgent lacks — your production router is genuinely superior:

### A. Production Router Architecture (services/onasis-ai-router/)
| Feature | Your Implementation | VoltAgent Equivalent |
|---------|-------------------|---------------------|
| Multi-vendor failover | Ollama -> MiniMax -> OpenClaw -> LMStudio (vendorOrder per use-case) | @ai-sdk/provider with simple fallback |
| Circuit breaker | Configurable threshold + cooldown per vendor | None built-in |
| Persona leak defense | 3-layer: structural (deprecate), prompt pinning (SOUL.md), text-level regex blocklist | Basic input guardrail |
| Prompt composition | SOUL.md + role prompt + lane prompt (3-file) | Single system prompt string |
| Memory prefetch | Inflight Map dedup + 3s budget, swallowed on failure | ConversationBuffer |
| Tool-loop execution | Soft tool-call extraction + follow-up pass | Basic tool calling |
| Profile resolver | Manifest-based tool/memory/policy configuration | No equivalent |
| Use-case routing | 8 use cases with different vendor chains | No use-case concept |
| Response sanitization | Strips vendor identity, model names, internal paths | None |
| Auth cache | 20s Redis-backed TTL | No caching |

### B. Production Deployment Infrastructure
| Item | Your Setup |
|------|-----------|
| systemd service unit | /etc/systemd/system/onasis-ai-router.service |
| nginx proxy | ai.vortexcore.app -> 127.0.0.1:8000 |
| dotenvx encrypted secrets | AES-256-GCM .env.production |
| Non-root user execution | Dedicated user: onasis-ai-router |
| Structured JSON logging | Winston -> journald |
| Log summarizer | scripts/router-logs.js with HEALTHY/DEGRADED/FAILING verdict |
| Vendor scoreboard | Performance tracking per vendor |

### C. Auth/Security Architecture
| Feature | Your Implementation |
|---------|-------------------|
| UAI resolution | X-API-Key + Bearer via auth-gateway | None |
| CODE_TOOLS_TRUSTED_AUTH_IDS | Allowlist (admin@lanonasis.com) | None |
| CODE_BASE_DIR sandbox | Sandboxed path resolver | None |
| PII redaction | sanitizePersonaLeaks pipeline | None |
| Command injection prevention | execFile + allowlist | None |


## 3. WHAT VOLTAGENT HAS THAT YOURE MISSING

### A. Agent Framework Runtime (Missing Entirely)
| Feature | VoltAgent | Onasis | Gap Impact |
|---------|-----------|--------|------------|
| **Agent class** with typed roles, tools, memory | @voltagent/core | NO | Full agent runtime |
| **Workflow engine** (chain, parallel, loops, branches) | createWorkflowChain | NO | Declarative multi-step automation |
| **Sub-agents & supervisors** | andAgent, andThen | NO | Multi-agent orchestration |
| **Tool registry** with Zod schemas | Typed tools with lifecycle hooks | NO | Your router has no tool registry |
| **Memory V2** (ConversationBuffer + persist queue) | ConversationBuffer | NO | Your prefetch is partial |
| **MCP client/server** integration | @voltagent/mcp-server | NO | No MCP support |
| **Guardrails** (15+ built-in) | PII, profanity, prompt injection, HTML | NO | Your manual regex is more thorough |
| **Evals/scorers** | @voltagent/evals | NO | No evaluation framework |
| **Resumable streaming** | In-flight stream recovery | NO | No streaming in router |
| **Voice** (TTS/STT) | @voltagent/voice | NO | — |
| **RAG/Retriever** | Chroma, Pinecone, Qdrant | Partial | No vector search |
| **A2A (Agent-to-Agent)** protocol | @voltagent/a2a-server | NO | — |
| **Triggers** (GitHub, Slack events) | Event-driven agents | NO | — |
| **PlanAgent** (filesystem/workspace) | Sandbox with backends | Partial | Basic CODE_BASE_DIR only |

### B. Observability (Missing Entirely)
| Feature | VoltAgent | Onasis |
|---------|-----------|--------|
| OpenTelemetry tracing (spans, traces) | Full OTel integration | NO (basic JSON logging) |
| WebSocket span processor | Real-time traces | NO |
| Memory persistence for traces | In-memory + local storage | NO |
| Span tree building | Hierarchical visualization | NO |
| Sampling wrappers | Configurable sampling | NO |
| Serverless context manager | AsyncLocalStorage-based | NO |

### C. Server Layer (Missing)
| Feature | VoltAgent | Onasis |
|---------|-----------|--------|
| Server-core (schemas, handlers) | @voltagent/server-core | NO |
| Server-hono (Hono-based API) | @voltagent/server-hono | Express only |
| Auth middleware (JWT, Next.js) | Built-in auth | Basic auth-gateway calls |
| WebSocket support | Full WS | NO |
| Swagger UI | @redocly/swagger | Via volt tunnel only |

### D. Developer Experience
| Feature | VoltAgent | Onasis |
|---------|-----------|--------|
| CLI (create-voltagent-app) | Scaffold projects | NO |
| Examples | 79 covering every integration | 1 (the app) |
| Documentation website | Docusaurus with i18n (4 langs) | NO |
| Changesets for versioning | Automated PRs/changelogs | NO |
| CI/CD | 3 GitHub workflows | 1 workflow |


## 4. REPLICATION STRATEGY — STEP BY STEP

### Phase 1: Agent Runtime Core (Weeks 1-3)
**Goal: Add the agent-runtime package to your monorepo**

Create: `packages/agent-runtime/`

```
packages/
  agent-runtime/          # Agent class, Workflow engine, Tool registry
    src/
      agent/              # Agent, hooks, subagents
      workflow/           # createWorkflowChain, step definitions
      memory/             # Memory class, adapters
      tool/               # Tool registry, Zod schemas
      guardrail/          # Input/output guardrails
      observability/      # OpenTelemetry spans
```

**Action items:**
1. Copy VoltAgent core's agent.ts — the Agent class is the foundation
2. Copy workflow engine — createWorkflowChain gives declarative multi-step automation
3. Copy tool system — Zod-based typed tools with lifecycle hooks
4. Keep your router's auth + vendor chain — it's production-tested and superior
5. Merge: Agent -> Router. Instead of Express routes handling requests, use Agent.run()

### Phase 2: Memory System (Weeks 4-5)
**Goal: Replace memory-prefetch with full Memory V2**

Extend: `packages/memory-client/` -> `packages/memory-store/`

**Merge your existing prefetch into MemoryPrefetch:**
- Your _prefetchInflight Map pattern is exactly what VoltAgent's MemoryPersistQueue does
- Your MemoryPrefetch class merges into VoltAgent's ConversationBuffer
- Keep your memory-prefetch.ts logic — it's well-designed
- Add vector search (your prefetch is semantic but lacks vector similarity)

### Phase 3: Observability (Weeks 6-7)
**Goal: Add OpenTelemetry tracing alongside your Winston logging**

Create: `packages/observability/`

**Use-case:** Your router already logs structured JSON. Add OTel spans alongside it.
- Each vendor call becomes a span
- Each tool execution becomes a child span
- WebSocket processor for real-time trace visualization
- This gives you VoltAgent-level observability WITHOUT changing your existing logging

### Phase 4: Guardrails & Safety (Week 8)
**Goal: Replace manual persona leak fixes with structured guardrails**

**Critical insight:** Your existing persona leak system is actually more sophisticated than VoltAgent's.
VoltAgent has: createInputGuardrail, createOutputGuardrail (composable but basic)
You have: PERSONA_LEAK_BLOCKLIST with model identifier scrubbing, path masking, server-name masking

**Don't replace it — merge it into VoltAgent's guardrail framework.**

### Phase 5: Server Layer (Weeks 9-10)
**Goal: Add API server with auth, WebSocket, Swagger**

Create: `packages/server/`

```
packages/server/src/
  routes/
    chat.ts           # Chat completions
    agents.ts         # Agent management
    memories.ts       # Memory CRUD
    auth.ts           # Auth middleware
  websocket/          # Real-time streaming
  swagger/            # OpenAPI docs
```

### Phase 6: Examples & DX (Weeks 11-12)
**Goal: Create example ecosystem + documentation**

Create: `examples/` with 10 starter examples (dont replicate all 79):
1. with-local-ollama — your current setup
2. with-minimax-cloud — your cloud fallback
3. with-workflow — expense approval style
4. with-memory-postgres — persistent memory
5. with-subagents — orchestrator + worker pattern
6. with-guardrails — PII protection
7. with-streaming — SSE streaming
8. with-mcp — MCP server integration
9. with-tools — custom tool definitions
10. with-evals — agent evaluation


## 5. ARCHITECTURE TARGET STATE

```
onasis-agent-haven/
├── packages/
│   ├── agent-runtime/     # @voltagent/core equivalent
│   ├── memory-store/      # Memory V2 + your prefetch merged in
│   ├── observability/     # OpenTelemetry tracing
│   ├── server/            # Express/Hono server with auth, WS, Swagger
│   ├── agent-contracts/   # KEEP: your L0 platform contract is production-ready
│   ├── agent-model-files/ # KEEP: your prompt system is superior
│   └── memory-client/     # KEEP: merge your prefetch here
├── services/
│   └── onasis-ai-router/  # KEEP: your production router is superior
├── apps/
│   └── onasis-agent-haven/ # KEEP: your Vite/React UI
└── examples/              # NEW: 10+ example apps
```

### Key Design Principle
**Keep your router, extend with VoltAgent framework.** The router is your production asset. VoltAgent's agent runtime should COMPOSE with your router, not replace it.


## 6. BUN COMPATIBILITY NOTES

| Concern | Status |
|---------|--------|
| bun.lock instead of pnpm-lock.yaml | Just change packageManager field |
| tsup bundler | Replace with bun build --entrypoints=src/index.ts --outdir=dist --target=node20 --format=esm,cjs |
| node: imports | Bun supports all node: builtins |
| @ai-sdk/* providers | All work with Bun native fetch |
| winston logging | Works with Bun |
| express | Works with Bun |
| vitest tests | Bun has its own test runner: bun test |
| husky + lint-staged | Use bunx husky |
| changesets | Works with Bun |

**Bun workspace config for package.json:**


```json
{
  "workspaces": ["packages/*", "services/*", "apps/*", "examples/*"],
  "packageManager": "bun@1.1.30"
}
```


## 7. IMMEDIATE PRIORITIES (What to do first)

1. **Keep your router as-is** — it's production-tested and superior to VoltAgent's
2. **Create packages/agent-runtime** — copy VoltAgent core Agent + Workflow classes
3. **Merge memory-prefetch into Memory adapter** — your prefetch logic is excellent
4. **Add OpenTelemetry to the router** — wrap each vendor call in a span
5. **Add structured guardrails** — replace manual regex with composable guardrail system
6. **Create 3-5 examples** — start with: local-ollama, with-workflow, with-memory-postgres

This gives you VoltAgent's framework capabilities while keeping your production router,
prompt system, and deployment infrastructure intact.
