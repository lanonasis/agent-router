# L0 Agent Heaven and Router Convergence Plan

**Status:** approved architecture. Phase 1 complete. Phase 3's enforcement
half shipped and verified live; profile *activation* blocked on auth-gateway.
Phase 2 has its regression baseline; the corpus merge is outstanding.

See `docs/superpowers/specs/2026-08-27-open-findings-tracker.md` #17-#19 for
what was verified and how.

## Outcome

Every Onasis application calls one authenticated L0 endpoint with the same
request format. Agent Heaven supplies a reviewed profile and the router
executes it without exposing internal vendors or allowing applications to
override system instructions.

```text
application -> UAI identity + application entitlement -> Agent Heaven profile
    -> router composition, memory and inference -> branded L0 response
```

## Fixed decisions

- Public model: `lzero`; `Vortex-L0` is a transitional alias.
- Public endpoint: `POST /v1/chat/completions`.
- Profile intent: `X-Onasis-Profile`; application intent:
  `X-Onasis-Application`. Both require UAI entitlement verification.
- Applications send user/assistant/approved tool history. Agent Heaven owns
  hidden system/developer instruction.
- Router owns UAI consumption, memory scoping, profile enforcement, vendor
  routing, fallthrough, and sanitization.
- No profile-specific public URLs. Profiles are internal router bindings behind
  the uniform endpoint.

## Ownership

| Component | Owner | Responsibility |
|---|---|---|
| `packages/agent-model-files` | Agent Heaven | Canonical prompt source, profile templates, generated prompt artifacts |
| `packages/agent-contracts` | Platform | Profile, API, UAI-scope, memory partition, and outcome contract |
| Auth Gateway UAI | Identity | Credential resolution and application/profile entitlement |
| `onasis-ai-router` | Inference | Profile composition, scoped memory, tools, vendors, fallthrough, responses |
| Applications | Product surface | User experience, approved profile intent, safe presentation of outcomes |

## Profile model

Reusable roles (`coder`, `researcher`, `reviewer`) are composed with product
profiles (`ide-extension`, `maple-hub-assistant`, `l0-concierge`, `l0-repl`).
Regulated profiles such as `v-secure-adviser` and `vortex-financial-adviser`
require distinct reviewed policy overlays and stricter capability approval.

Each active manifest includes: profile/application IDs, version, identity and
role templates, policy documents, permitted tools, memory mode, validated
context fields, and limits. It must be immutable for a deployed version.

## Delivery sequence

### 1. Foundation — current PR

- Extend `@onasis/agent-contracts` with L0 constants and profile/UAI types.
- Make Agent Heaven prompt generation checkable with `--check` and CI.
- Record L0 identity boundary in the source-of-truth prompt corpus.
- Keep existing router prompt loading unchanged while duplicate corpora are
  reconciled. This avoids an unreviewed live persona change.

### 2. Canonical prompt migration

- Preserve the router's effective prompt behavior as a regression baseline.
- Reconcile its nested prompt hierarchy into Agent Heaven's canonical package.
- Generate any app documentation copy from that package; stop hand-editing it.
- Add parity tests for every role and router use case.

### 3. Entitled profile activation

- Extend UAI resolution with verified application identity and profile
  entitlements. **Blocked, auth-gateway (onasis-core).** Verified live
  2026-09-03: `/v1/auth/resolve` returns no `applicationId` and no
  entitlements, and `organizationId` is empty for api_key auth. Until this
  lands, every profile request is refused with `entitlements_unavailable` —
  the router side is installed and failing closed by design.
- Add a router profile resolver that accepts only active manifests whose
  application/profile pair UAI authorizes.
- Compose hidden system instructions server-side; reject public `system` and
  `developer` message roles. **Done** on both `/v1` and the native path
  (`ecabac5`, `4c66495`). This was not merely unbuilt — it was actively
  exploitable in production until 2026-09-03; see tracker #17.
- Keep a controlled compatibility binding for existing native use cases during
  migration. Scoped deliberately: native callers keep resolving by
  `use_case`, but the binding does **not** extend to accepting caller system
  instruction — that clause protects existing use cases, not an injection
  vector.

### 4. Consumer migration

- Move IDE, Maple, Concierge, REPL, Slack, Discord, and future applications to
  the uniform L0 endpoint, `lzero`, and an approved profile binding.
- Require truthful user feedback for completed, degraded-memory, fallback, and
  failed outcomes.
- Retire client-owned prompt construction only after production telemetry shows
  no remaining callers.

## Release gates

1. Derived Agent Heaven files are current in CI.
2. Contract tests cover model aliases, profile validation, UAI entitlement,
   memory partition, and error semantics.
3. Router tests prove no caller-supplied system prompt or unentitled profile can
   alter behavior. **Met** — `test/message-policy.test.js` (both surfaces
   reject `system`/`developer`, verified live) and `test/profile-resolver.test.js`
   (absent entitlements fail closed; headers are never authority).
4. A post-deploy canary verifies one entitled profile through the public URL.
5. Regulated profiles receive separate policy approval and evaluation fixtures.

## Router review — consumer tooling and multi-vendor failover

**Date:** 2026-10-11. **Status:** findings verified against source; fixes proposed,
none implemented. **Scope:** independent read of `services/onasis-ai-router`,
prompted by feedback from a consumer integrating against the service. Every claim
was checked against source rather than accepted; where the report was wrong, that
is recorded too.

### Verification of the consumer report

| Claim | Verdict |
|---|---|
| Router never calls MCP core (`:3001`) | **Confirmed.** No reference to `3001`, `mcp-core` or `MCP_CORE` in `core/`, `vendors/` or `server.js`. |
| Tool offer varies by use case; `memory.write` only on `repl-nlp` | **Confirmed.** `tool-loop.js:70-74`; override via `MEMORY_WRITE_USE_CASES`. |
| Profile manifest is a ceiling on offered tools | **Confirmed.** `ToolLoop.constrainToAllowed` (`tool-loop.js:88-93`), enforced once at `ai-service-router.js:424`. |
| Three extraction passes for tool calls | **Confirmed.** native `tool_calls` → in-text markup → soft bare-JSON. |
| Memory prefetch swallows failures | **Confirmed.** returns `''` on any error (`memory-prefetch.js:143-148`). |
| Health probe covers LLM vendors only | **Confirmed.** `vendor-health.js:103-105` iterates `VENDOR_REGISTRY` alone. |
| Two memory backends in use | **Confirmed.** `api.lanonasis.com` for working memory + tools; `AGENT_MEMORY_URL` for session memory. |
| Chain is "Ollama → Pi → MiniMax → OpenAI → Anthropic → LM Studio" | **Wrong and stale.** `ollama` is deprecated and in no `vendorOrder`; `openclaw` is omitted entirely. Actual interactive chain: `pi, minimax, openclaw, openai, anthropic, lmstudio`; batch lanes start at `minimax`. |

The last row matters as process, not trivia: a consumer mapped the routing
topology from memory, then drew conclusions from a chain that has not existed
since 2026-09-18. Consumers must not need vendor identity — that is a hard
invariant — but they *do* need an accurate, citable topology document. See **R6**.

### Fixes, highest value first

#### R1 — a memory error is indistinguishable from memory content (correctness)

`toolMemorySearch` / `toolMemoryGet` / `toolMemoryWrite` call `response.json()`
and pass the result to `formatToolPayload()` **without ever checking
`response.ok`** (`tool-loop.js:486-487`, `518-519`, `569-570`). An upstream that
answers `401`/`403`/`500` with a JSON error envelope therefore reaches the model
as a successful tool result, and the model summarises an error object as though
it were the user's memories.

Only a non-JSON body (or a transport failure) reaches the `catch` — which is why
this has stayed invisible. The failure mode depends on the error body's content
type.

- Check `response.ok`; treat non-2xx as a failure with a stable shape.
- Distinguish "memory service is unwell" from "no memories matched" in the
  payload, so the model can say which happened.
- Regression test: memory API returns `500 {"error":...}` → the tool result must
  not be presented as memories.

#### R2 — the retry wrapper never fires for memory tools (resilience)

`executeToolCallWithRetry` (`tool-loop.js:333-351`) retries **only when the
attempt throws**. Every memory tool catches its own errors and *returns* an error
payload instead (`488-491`, `540-543`, `571-574`), so the retry is unreachable
for precisely the tools it was written for. The memory path gets one attempt, not
two, while the code reads as though it gets two.

- Have `toolMemory*` throw a typed error on transport/5xx failures, and reserve
  the returned-error shape for validation problems (missing ids, unoffered tool).
- Or move the retry inside the tool. Either way the wrapper and the tools must
  agree on which failures are retryable.

#### R3 — sequential tool calls multiply the memory timeout (latency)

`executeToolCalls` is a sequential loop (`tool-loop.js:325-330`) and each memory
call aborts at `routerTimeoutMs` — `ROUTER_TIMEOUT_MS`, default **15000 ms**
(`ai-service-router.js:62`). Three tool calls against a slow memory service is
therefore up to **45 s** before synthesis even begins, against nginx's 60 s
`proxy_read_timeout`; synthesis then runs on the remaining half-budget.

- Run independent tool calls concurrently (bounded), rather than serially.
- Re-examine 15 s — generous for a search, and paid once per call.

#### R4 — cross-vendor replay carries the original vendor's tool contract (failover)

When a tool has run and the same vendor fails to summarise it, the retry goes to
the rest of the chain with `exclude: [thatVendor]` (`ai-service-router.js:660-664`)
but reuses `followupMessages`, which embeds the **originating vendor's own
`tool_calls[]` verbatim** (`585-588`), plus `tool_call_id`s the next vendor never
issued and a non-standard `tool_name` field.

This already bit once in the same-vendor case — MiniMax rejected the tool-result
ids with `tool result's tool id() not found` (`556-566`). Nothing guarantees the
next vendor is more tolerant.

- Prefer the flattened transcript (`_flattenToolRound`, `760+`) for **any**
  cross-vendor synthesis retry, not only the re-emission path.
- Normalise the replayed assistant turn when the vendor changes.
- Test: replay a vendor-A tool round into a vendor-B adapter.

#### R5 — memory and auth are invisible to health (observability)

`VendorHealthMonitor` probes LLM vendors only, and `router-logs.js`'s verdict is
built from vendor events. A memory or auth-gateway outage therefore reads as
healthy right up until requests start degrading.

- Add a dependency section to `/health` (memory API, auth-gateway) kept separate
  from the vendor verdict — a memory blip must not mark the router FAILING.
- Include memory-tool failure counts in the `router-logs.js` summary.

#### R6 — publish the topology instead of letting consumers guess

Because of the stale map above and the two-backend split, `INTEGRATION-GUIDE.md`
should state, without naming vendors:

- which failures are user-visible and which the fallback chain absorbs;
- that working memory and session memory are different backends with different
  auth and failure modes;
- that the router offers only the tools it advertises, and a profile manifest can
  remove tools but never add them.

### Considered and deliberately not changed

- **Returning an error payload into the tool-result slot is correct.** The model
  should be told a tool failed rather than have the whole request fail. R1 is
  about that payload being *indistinguishable* from success.
- **Two memory backends are intentional** — different lifetimes, different auth.
  The defect is the undocumented behaviour, not the split.
- **Not racing vendors in parallel** (`chain-executor.js:104-109`) stays: it would
  bill every paid vendor per fallback request for duplicate work.
- **Withholding `tools` on the synthesis pass** (`590-605`) stays: this router
  executes exactly one tool round, so re-offering them only invites a call that
  cannot be answered.
