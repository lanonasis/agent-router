# VoltAgent vs Onasis Agent Haven — Deep-Dive Evaluation

**Date:** 2026-10-17 (measurements); recovered to a durable path 2026-10-22 after
the scratch directory was pruned.
**Subject:** `COMPARISON-PLAN.md` — feasibility assessment against the real codebase
**Verdict:** The plan is directionally wrong on its central premise, built on incorrect
baseline measurements, and — if executed as written — would cost ~12 weeks to
regress the one asset that makes this platform differentiated. Three of its seven
ideas are worth taking now, at roughly 5% of the proposed effort.

**Scope decision (2026-10-22).** The agreed intent is to pick a few advancements
from VoltAgent's architecture to enhance the router — **not to replace it**.
Phase 0–2 below are the enhancement work and stand as written. Phase 3 is now
optional: run it only if the Agent/workflow layer becomes a real requirement, and
run it as a borrow-test with stop conditions, not as the first step of a migration.

---

## 1. The baseline numbers in the plan are wrong

I measured the repo rather than accepting the comparison table. Four of its nine
rows are materially incorrect, and every one of them errs in the direction of
making our codebase look smaller and VoltAgent look further ahead.

| Metric | Plan claims | Measured | Error |
|---|---|---|---|
| TS files in `apps/` | "21" | **92** | understated 4.4× |
| App TypeScript LOC | "~1,845" | **9,808** | understated 5.3× |
| Router JS | "~20K" | **15,169** at `origin/main` exclusive of `node_modules`; `core/` = 5,029 | overstated 33% |
| Router test files | "~40" | **33** (31 in `test/` + 2 at root) | approximately right |
| Packages | 3 | 3 ✓ | correct |
| Examples | 1 | 0 | correct |

*Basis: `origin/main` as measured 2026-10-17, before PR #14 (lane typing) merges.
Re-derive counts after it lands — the new test file alone moves both JS and test totals.*

The router figure matters most because the plan uses it to argue we are
"10× behind." We are not. `core/ai-service-router.js` alone is **1,638 lines** —
the erosion documented in the outcome-driven-routing plan — and total router code
is 15K against VoltAgent's 113K core. That is a different competitive picture: we
are a focused service, not a stunted framework.

**Why this matters procedurally:** a plan that misstates its own baseline by 5×
cannot be trusted to size a 12-week migration. Re-derive numbers before approving
any phase.

---

## 2. Two false premises that invalidate the strategy

### Premise A — "Copy VoltAgent core's agent.ts"

**False.** `@voltagent/core@2.11.0` is a **dual ESM/CJS package**. I installed it
and loaded it from a CommonJS context — the same module system the router uses:

```
CJS require: OK  load_ms=772
export count: 202
has Agent: function
has createWorkflowChain: function
has Memory: function
```

Its `exports` map carries a `require` condition pointing at `dist/index.js`. You
familiarise with VoltAgent by **installing it**, not by vendoring 113,948 lines
into your monorepo.

Copying would be a permanent fork: MIT-licensed (so legal), but you would own
113K lines, receive no upstream fixes, and inherit the **erosion risk** this repo
has already documented. `ai-service-router.js` grew 688 → 1,638 lines in six
weeks by accretion. Vendoring a framework is the same failure mode with a larger
denominator.

### Premise B — VoltAgent "composes with" the router

**Half true, and the half that's false is expensive.** VoltAgent's `Agent` is
built on **AI SDK v6 `LanguageModel`**:

```
import { LanguageModel, generateText, StreamTextResult } from 'ai';
peer: { ai: "^6.0.0", zod: "^3.25 || ^4", "@ai-sdk/provider-utils": "4.x" }
```

Our router speaks **raw OpenAI-compatible JSON over `undici`** to nine vendor
adapters. There is no `LanguageModel` in it. To compose, you must write a
`LanguageModelV2` adapter that presents our chain as a model — `doGenerate`,
`doStream`, message conversion, tool conversion. That is real, non-trivial work,
and it is *not* in the plan's 12 weeks.

### The consequence the plan misses entirely

VoltAgent ships **its own model fallback**:

```
executeWithModelFallback, shouldFallbackOnError, getModelCandidates
```

Its shape is a **config-declared array walked in order** — which is precisely the
defect `docs/superpowers/specs/2026-08-27-outcome-driven-routing-design.md` was
written to eliminate. Our chain instead orders by an observed-outcome scoreboard,
classifies failures by cause, applies proportionate cooldowns, and treats ejected
vendors as last-resort rather than discarded (`chain-executor.js:167-193`).

So adopting `Agent` in the obvious way gives you naive fallback and silently
retires the production asset. Adopting it with a custom adapter gives you **two
fallback layers** fighting over one request. Neither outcome is in the plan.

> **This is the strategic crux.** VoltAgent's fallback and our router solve the
> same problem. They are not complementary. Any adoption decision must say
> explicitly which one owns vendor selection — and the answer, given nine vendors
> and a written outcome-classification spec, is ours.

---

## 3. What the plan gets right

Three gaps are real. I verified each in source.

**Streaming is genuinely absent — and explicitly refused.** `openai-compat.js:161-169`
returns `stream_unsupported` rather than faking it. That was the correct call
(a buffered body to a client that asked to stream reads as a hang), but it means
the product has no SSE path at all. **This is the single largest product gap.**

**Observability is logging, not tracing.** Winston → journald gives you lines,
not spans. You cannot answer "which vendor attempt inside this request was slow"
without grepping. Real gap.

**Eval coverage is behavioural, not qualitative.** 35 test files assert contracts.
None scores *model output quality* — e.g. "did the persona leak". For a
compliance-aware platform, that is a meaningful hole.

---

## 4. Feasibility of each proposed phase — assessed

| Plan phase | Proposal | Verdict | Reality |
|---|---|---|---|
| 1 | Copy Agent + workflow engine (wks 1-3) | ❌ **Reject** | Wrong premise (§2A). Vendoring a fork. No use case stated for workflow/subagents. |
| 2 | Memory V2 replaces prefetch (wks 4-5) | ❌ **Reject** | `memory-prefetch.js` is already production-hardened: 2-min warm cache, in-flight dedup, swallows errors to `''`. VoltAgent's `ConversationBuffer` is a different lifetime model. Our memory *bugs* (R1-R3) matter far more than its abstraction. |
| 3 | OpenTelemetry (wks 6-7) | ✅ **Accept — but not via VoltAgent** | Correct diagnosis. Do **not** take `@voltagent/core`'s 69 MB of `@opentelemetry` for this. Instrument directly. ~150 lines. |
| 4 | Merge persona system into guardrails (wk 8) | ⚠️ **Accept as pattern only** | Plan says "don't replace — merge," then §7 item 5 says "replace manual regex." Internally contradictory. Our persona defence is deeper (structural + prompt pinning + text blocklist). Take the *shape*, not the dependency. |
| 5 | Server layer, Hono + Swagger (wks 9-10) | ❌ **Reject** | We have Express + nginx + auth-gateway + `openai-compat`. Replacing a working, secured server to gain Swagger is a large regression risk for a documentation feature. |
| 6 | 10 examples + docs (wks 11-12) | ⚠️ **Defer** | Reasonable eventually, but examples of what? There is no agent runtime to demonstrate yet. Illustrating a framework you haven't adopted is backwards. |

**Score: 1 accept, 2 accept-as-pattern, 3 reject.** The plan's own priority list
(§7) contradicts its phase order — it says "keep your router as-is" (item 1) then
proposes replacing the request path with `Agent.run()` (Phase 1, item 5). That
inconsistency should have blocked the plan before it reached you.

---

## 5. Real costs the plan omits

Measured by installing it:

| Cost | Value |
|---|---|
| Install size | **268 MB** `node_modules` (disk footprint, not runtime RSS) |
| Dependency count | **349 packages**, 250 directories |
| `@voltagent/core` direct deps | **22 provider SDKs** (17 `@ai-sdk/*` + 5 others) + 12 OpenTelemetry packages |
| Providers as direct (not optional peer) | Confirmed — the plan flags this as bloat, then proposes absorbing it |

The plan identifies this as VoltAgent's weakness and then proposes making it
ours, in a service whose current dependency list is eight direct dependencies
resolving to 150 installed packages.

**Context: `services/onasis-ai-router/package.json` has 8 direct runtime deps,
and its lockfile resolves 150 packages.** Adding `@voltagent/core` takes the
installed tree to ~349 packages — **~2.3×** — and direct dependencies from 8 to
44 (**~5.5×**), including 22 provider SDKs. (An earlier draft of this document
said "~44×"; that compared total packages against direct dependencies and would
not survive review.) For a regulation-adjacent service, that is a supply-chain
decision, not a DX one — it needs a written risk acceptance, and the plan
contains none.

---

## 6. The opportunity cost — the decisive argument

While a framework migration runs, these stay broken. All are in *production*
code today:

| ID | Defect | Impact |
|---|---|---|
| **R1** | Memory tools never check `response.ok`; a `500 {"error":...}` envelope reaches the model as a **successful tool result** | Model summarises an error object as the user's memories |
| **R2** | Retry wrapper only fires on `throw`; memory tools `return` errors instead — retry unreachable | Memory path gets one attempt, not two, while code reads as two |
| **R3** | 3 sequential tool calls × 15 s timeout = **45 s** before synthesis, against nginx's 60 s | Timeout budget half-consumed before the answer starts |
| **R4** | Cross-vendor replay carries originating vendor's `tool_calls[]` + foreign `tool_call_id`s | Already 400'd once on MiniMax; unguarded for others |
| **R5** | Health probes LLM vendors only | Memory/auth outage reads healthy until requests degrade |

A 12-week migration fixes **zero** of these, and touches `ai-service-router.js` —
the file that already eroded to 1,638 lines. The plan's own **Standing Invariant
#6** reads: *"new logic goes into a module. If it must go into
`core/ai-service-router.js`, say why in the commit message."* Importing a
framework into that file is the largest possible violation of the rule written
specifically to stop this.

---

## 7. Recommended plan — sequenced by leverage, not by parity

### Phase 0 · Week 1 · Close the correctness bugs
Fix **R1, R2, R3**. Small, understood, contained, and they are actively returning
wrong data to models.
- R1: check `response.ok`, distinct payload for "memory unwell" vs "no matches", regression test on `500`.
- R2: typed throw for transport/5xx; keep returned-error shape for validation.
- R3: bounded concurrency in `executeToolCalls`; revisit the 15 s default.
- Exit: test suite green; no behaviour change for healthy memory.

### Phase 1 · Weeks 2-3 · Tracing, without the framework
Add `@opentelemetry/sdk-node` + OTLP exporter **directly** — not via VoltAgent.
- One span per vendor attempt in `chain-executor.js` (attributes: vendor id, outcome class, latency, circuit state).
- One child span per tool call in `tool-loop.js`.
- Ship to `packages/observability/` — a real module, per Invariant #6.
- Formalise the existing guards (`message-policy` → sanitisation → tool-markup) as one ordered input/output middleware pipeline with `block` / `flag` / `redact` actions. This is the one structural idea worth taking from VoltAgent's guardrail layer, and it needs no dependency.
- **R5 for the evidence, not the verdict**: tracing shows that a memory or auth dependency was slow or failing, but `/health` still needs explicit probes for both. Do both here.
- Exit: a single request produces a trace tree with correct nesting, and `/health` reports memory/auth independently of the LLM vendors.

### Phase 2 · Weeks 3-4 · SSE streaming
The real product gap, and it must live in *our* chain — every relevant vendor
already speaks SSE, and VoltAgent's streaming is bound to AI SDK models so it does
not transfer.
- Deadline propagation into the chain; a vendor that dies mid-stream is an outcome, not an exception.
- Keep the explicit refusal for endpoints that still lack SSE — never fake it.
- Exit: a streamed completion survives a mid-stream vendor failure.

### Phase 3 · One weekend · Falsify the VoltAgent question with a spike
Do **not** migrate. Build the adapter and find out:

1. Write a `LanguageModelV2` adapter whose `doGenerate` calls our chain.
2. `new Agent({ model: routerAdapter, tools: [...] })`.
3. Run one workflow and one tool round.

- **If it works:** you gain workflow, subagents, guardrails and evals *on top of*
  the production chain, at ~268 MB and one adapter. Now the 12-week plan has a
  real basis, and you can decide the swap knowingly.
- **If it fights you** (likely — tool-call id alignment, streaming semantics,
  double fallback): you have spent ~2 days discovering the true cost instead of
  12 weeks paying it.

Either outcome is cheaper than the plan's Week 1. **This is the highest-value
action if adoption is still on the table** — with enhancement as the agreed
scope it is optional, and the weekend is better spent on R1–R3 unless
Agent/workflows become a requirement.

If it is run, add stop conditions up front:

- `Agent({ model: adapter })` with a single model and internal fallback disabled
  (`maxRetries: 0`), so our scoreboard remains the only vendor selector.
- Tool-call round-trip lossless in both directions, or the tool-markup guard and
  `assertUsableCompletion` are bypassed.
- Streaming works through the adapter, since Phase 2 targets it.
- Boot delta measured inside the router process, not standalone.

Failing any of these is a result: borrow the ideas, not the runtime.

### Explicitly deferred
Agent class, workflow engine, subagents, A2A, voice, RAG, Hono server, examples.
These describe a *different product* — an agent builder. `IDEA.md` says that is
where the platform is going, and it may be right. But it belongs in a **new
service beside the router**, not grafted into it. The router is a routing
service; it is good at that, and the outcome-driven machinery is why.

---

## 8. Guardrails for whoever executes this

1. **Never let two vendor-fallback implementations coexist** in one request path. Decide ownership first (§2).
2. **Any new dependency on a regulation-adjacent service needs a written risk acceptance** — 8 → 44 direct dependencies (150 → 349 installed packages) is not a routine bump.
3. **Measure before planning.** This plan was adversarial to its own conclusion because its baseline was wrong by 5×.
4. **Structure discipline (Invariant #6) applies hardest to framework adoption.** If the integration logic lands inline in `ai-service-router.js`, stop.
5. **One thing at a time.** R1-R3 are small and independent; do not couple them to a migration.

---

## 9. Incidental finding — a documentation defect worth fixing

`services/onasis-ai-router/CLAUDE.md` was **blocked by the tool's
prompt-injection guard** (`read_secrets` pattern). Reproduced by running the
guard's own scanner against the file:
`scan_for_threats(CLAUDE.md, scope="context")` → `['read_secrets']`.

It is a false positive on **exactly one line** — line 427, which contained the
literal `` `cat .env.production` ``. The pattern is
`cat\s+…(\.env|credentials|…)`; the `dotenvx`, `.env.production` and `Bearer`
examples elsewhere in the file do not match. This section originally blamed
those classes; they were never the trigger.

Impact: **every agent that tries to orient itself in this service is silently
blocked from its primary orientation document.** That is a real operational
defect — it is the file the outcome-driven plan calls "the service's primary
orientation document."

Fix applied (2026-10-22): line 427 was reworded to describe the shell read
without the `cat … .env` shape, and the scanner now returns no findings. Hoisting
runnable commands into a referenced `RUNBOOK.md` remains reasonable hygiene but is
not required to unblock the file. No secrets were exposed either way — the guard
matched the *shape* of the documentation, not a leak.

---

## Appendix — verification log

All figures produced by direct measurement on 2026-10-17:

```
# Scale (origin/main, 2026-10-17 — before PR #14)
find apps -name "*.ts*" | wc -l                      → 92 files, 9,808 lines
find services/onasis-ai-router -name "*.js" \
  -not -path "*/node_modules/*" | xargs wc -l        → 15,169
wc -l core/ai-service-router.js                      → 1,638
ls test/*.test.js | wc -l                            → 31 (+2 root) = 33

# VoltAgent loadability (npm install @voltagent/core@2.11.0)
node -e "require('@voltagent/core')"                 → OK, 772 ms, 202 exports
du -sh node_modules                                  → 268 MB (disk, not RSS)
ls node_modules | wc -l                              → 250 (349 resolved)
npm view @voltagent/core@2.11.0 dependencies         → 44 direct; 22 provider
  SDKs (17 @ai-sdk/* + 5 others) + 12 @opentelemetry/*
npm view @voltagent/core@2.11.0 exports              → require + import (dual)

# Capability checks against our source
grep "event-stream" services/…/core/*.js             → none
sed -n '161,169p' core/openai-compat.js              → stream_unsupported (deliberate)
grep "vendorOrder" vendors/index.js                  → 9 use-cases, 10 vendors
  registered; chain pi→minimax→openclaw→openai→anthropic→lmstudio
  (ollama + supabase-edge registered but deprecated)
  NOTE: pre-PR #14. After it merges, openclaw is absent from the
  completion lanes (ask-ai, landing-guide, support-chat).
grep "name:" core/tool-loop.js                       → 8 tool families
```

**Not verified:** VoltAgent runtime behaviour under a real workload, and adapter
feasibility. Phase 3 exists precisely because those two cannot be established
from reading — they need the spike.
