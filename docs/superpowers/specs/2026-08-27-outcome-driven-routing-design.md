# Outcome-Driven Routing — onasis-ai-router

**Date:** 2026-08-27
**Service:** `services/onasis-ai-router`
**Status:** Design approved, pending implementation plan

---

## 1. Problem

The router selects vendors from a hand-maintained `vendorOrder`, treats any HTTP
200 as success, and reports health by pinging `/v1/models`. All three are
*declarations*. None of them observe what a vendor actually did. Every defect
below follows from that.

### 1.1 Measured evidence (2026-08-26/27, live, this host)

Real `chat()` calls against each active vendor, bypassing the health ping:

| Vendor | Outcome | Latency |
|---|---|---|
| `openclaw` | 200 OK — content sometimes a gateway error string | p50 ~3.4s, p90 ~10s, **max 41.5s** (n=18) |
| `minimax` | 200 OK — correct answer | p50 ~2.2s, max 4.5s (n=6) |
| `openai` | 429 `You have no credits remaining` | ~1.0s wasted |
| `anthropic` | 400 `credit balance is too low` | ~0.2s wasted |
| `ollama` | 200 OK — correct but very slow | **11.0s** for one word |

Chain for `ask-ai`, `landing-guide`, `dashboard-assistant`, `support-chat`,
`memory-analysis`:

```
openclaw → minimax → openai → anthropic → ollama
```

### 1.2 The four defects

**D1 — Success is inferred from HTTP status.**
`vendors/openclaw/adapter.js` throws only on `!response.ok`. OpenClaw
intermittently returns **HTTP 200 whose content is
`"⚠️ Agent couldn't generate a response. Please try again."`** — a gateway error
string in the success field. The router serves it to the user as the answer and
never falls through.

Gateway journal for those turns:

```
stopReason=length ... incomplete turn detected — surfacing error to user
provider=kilocode/nvidia/nemotron-3.5-lightning:free
```

The `fixer` agent boots with ~11.5K prompt tokens (AGENTS.md 9005 chars and
SOUL.md 8729 chars, both truncated at a 5000-char limit, plus 72 catalogued
tools) and is driven by a reasoning model against a `max_tokens: 350` cap. When
reasoning overruns the cap, no assistant message is emitted and the gateway
substitutes the error string.

**Frequency: intermittent, not steady-state.** Observed 2/2 in initial probes
and twice in the gateway journal (22:31, 22:32 on 2026-08-26); did **not**
reproduce across 18 subsequent controlled trials on the same prompts and model.
Treat it as a tail event, not the common case.

**D2 — Chain order is unrelated to vendor reality.**
`openai` and `anthropic` are hard-dead on billing yet sit at positions 3 and 4
of every interactive chain, costing ~1.2s of pure waste whenever the chain is
walked. `content-generation`, `code-assist` and `repl-nlp` lead with `ollama` at
11s per short response. Correcting any of this today requires a human noticing
and editing a file.

**D3 — Health checks measure liveness, not capability.**
`/health` returns all five vendors healthy in under a second while real
inference fails for three of them. It pings `/v1/models`, and
`vendors/openclaw/adapter.js` health-checks with:

```js
return response.ok || response.status === 401;   // healthy even when auth fails
```

This is why testing looked fine while real requests were broken.

**D4 — The circuit breaker rewards the failing vendor.**
`core/ai-service-router.js:270` calls `_circuitSuccess()` whenever
`adapter.chat()` does not throw. OpenClaw returns 200, so each error string
**decays its failure count by 2**. Meanwhile `openai`/`anthropic` — dead for
days — get `VENDOR_CIRCUIT_COOLDOWN_MS=30000` and `THRESHOLD=3`, so they are
retried every 30 seconds indefinitely. The breaker punishes vendors that report
failure honestly and promotes the one that does not.

### 1.3 What the latency data actually says

An earlier reading of single samples suggested MiniMax was ~3.5x faster than
OpenClaw at the median. With n=18 vs n=6 that does not hold: medians are 3.4s vs
2.2s, a ~1.5x gap. **The real difference is the tail** — OpenClaw reaches 41.5s,
which exceeds its own `OPENCLAW_TIMEOUT_MS` of 30s, while MiniMax caps at 4.5s.

Cause: OpenClaw is not one LLM call. The gateway journal shows several upstream
calls of ~1.1–1.7s each per user turn (agent reasoning loop), on top of ~11.5K
bootstrap prompt tokens per request. MiniMax is a single completion call.

This matters for the design: **a static reorder would be built on a median gap
that is not stable.** Overlapping medians with divergent tails is precisely the
case that requires continuous observation rather than a fixed list.

---

## 2. Principle

> **Route on observed outcomes, not on declarations.**

Config expresses *intent*. Observation decides *dispatch*. Every component below
exists to serve that one sentence; nothing below is independently motivated.

---

## 3. Module decomposition

`core/ai-service-router.js` is 1726 lines spanning six unrelated concerns. Split
along seams already present in the file:

| New module | Extracted from | Responsibility |
|---|---|---|
| `core/chain-executor.js` | ~230–300 | Walk the chain, apply budgets, report per-attempt outcomes |
| `core/vendor-scoreboard.js` | 413–441 | Typed circuit breaking, success/latency stats, chain filtering |
| `core/capability-probe.js` | 1573+ | Cached real-inference probes; backs `/health` |
| `core/tool-loop.js` | ~300–410, 727–920 | Tool extraction, execution, follow-up pass |
| `core/tools/*.js` | 923–1343 | The nine `toolX()` implementations, one file per family |
| `core/memory-prefetch.js` | 618–700 | Prefetch, cache, in-flight dedup |
| `core/middleware.js` | 1444–1570 | `authenticateRequest`, `trackUsage` |

`AIServiceRouter` retains route wiring and composition only — target ~200 lines.

**Phase 1 is a pure move: no behaviour change, existing tests must pass
unchanged.** It lands first so every later change arrives in a small, reviewable
file.

---

## 4. Vendor response contract

New module `vendors/_shared/response-contract.js`.

```js
class VendorContractError extends Error {
  constructor(message, { vendorId, reason }) { ... }
}
// reason: 'empty_content' | 'error_sentinel' | 'incomplete_turn'

function assertUsableCompletion(normalised, { vendorId, sentinels })
```

Every adapter returns through it. It throws when:

1. **`empty_content`** — content is empty after trimming **and** `tool_calls` is
   empty. (A tool-call turn legitimately carries no prose; it must not throw.)
2. **`incomplete_turn`** — `done_reason === 'length'` with empty content.
3. **`error_sentinel`** — content matches a sentinel declared by that vendor.

Sentinels are declared in the registry:

```js
openclaw: {
  errorSentinels: [/^⚠️\s*Agent couldn't generate a response/i],
}
```

**On the honest limits of this design.** Rules 1 and 2 are generic and catch the
adjacent failure modes. OpenClaw's specific string is *not* caught generically —
its content is non-empty and its `finish_reason` is `stop`, because the gateway
rewrites the turn before returning it. For that case the sentinel **is** the
mechanism, and a sentinel is a blocklist: it catches the string we have seen and
not the next one.

Two things mitigate this, and neither should be oversold:

- Usage-based detection was considered and is **unverified**. The hypothesis was
  that a gateway-authored string would report `completion_tokens: 0` and so be
  detectable generically. It could not be tested: the failure did not reproduce
  during any run in which usage was captured. What *is* measured is that
  successful turns report ~35–115 completion tokens with non-zero
  `reasoning_tokens`, which makes it plausible that a `stopReason=length` turn
  also carries real reasoning tokens and the signal would not discriminate — but
  that is inference, not evidence. **If the failure recurs, capture the full
  response body first**; a confirmed `completion_tokens: 0` would be a stronger
  and more general rule than the sentinel, and should replace it.
- The scoreboard (§5) is the durable defence. A vendor emitting an unrecognised
  error string still degrades its own success/latency statistics through user
  retries and downstream signals, and loses chain position without a code change.

Sentinels are therefore a **fast path for known failures**, not the strategy.

A throw from the contract is what allows the chain to continue to MiniMax
instead of serving the apology.

---

## 5. Outcome-typed circuit breaker and scoreboard

Replace the flat `failCount` with a classified outcome:

| Class | Trigger | Cooldown |
|---|---|---|
| `billing` | `insufficient_quota`, credit-balance messages, HTTP 402 | Hours, exponential (base 1h, cap 12h) |
| `auth` | HTTP 401/403 | Open until config change; re-probe hourly |
| `contract` | `VendorContractError` | Minutes (base 5m, exponential, cap 1h) |
| `transient` | 5xx, timeout, `ECONNRESET` | Seconds — current behaviour retained |

Consequences:

- `openai`/`anthropic` leave every chain on their own, and **rejoin on their own
  when credit is restored** — no file edit, no redeploy.
- A `contract` failure now counts *against* OpenClaw rather than for it,
  reversing D4.
- Transient blips keep today's forgiving behaviour.

The scoreboard additionally tracks per-vendor **success rate and latency
percentiles** (EWMA over a rolling window). Given §1.3, dispatch is ordered by
observed cost, not by a fixed list:

- `vendorOrder` is filtered to vendors whose circuit is closed.
- Within that set, order by declared preference **unless** a vendor's p95
  exceeds `VENDOR_TAIL_DEMOTE_MS` (default 15000) while a healthy alternative
  sits below it — in which case it is demoted.

This is what handles the 41.5s tail without hard-coding a claim about medians
that the data does not support.

Persistence: in-memory, consistent with existing prefetch/breaker state.
Redis-backed sharing across replicas is explicitly **out of scope** (see §9).

---

## 6. Health means capability

- Delete `return response.ok || response.status === 401`.
- Replace `/v1/models` pings with a real micro-inference probe: `"Reply with
  PONG"`, `max_tokens: 8`, passed through `assertUsableCompletion()`.
- Run on a background interval (`CAPABILITY_PROBE_INTERVAL_MS`, default 300000),
  cached with TTL; never inline on a user request.
- `/health` reports the **last real inference outcome** per vendor, plus its
  circuit state and latency percentiles.

Probe cost is bounded and trivial. The alternative is the current state: a green
dashboard over a router failing most of its real calls.

---

## 7. Lane typing

Vendors declare a `lane`:

- **`completion`** — stateless, single call: `minimax`, `openai`, `anthropic`,
  `ollama`
- **`agent`** — stateful, tool-using, multi-round-trip: `openclaw`, later `l0`

Use cases declare which lane they require. **Agent lanes carry a minimum token
floor (`AGENT_LANE_MIN_TOKENS`, default 2000)**; a use case requesting an agent
vendor with a lower `maxTokens` is a startup validation error, not a runtime
surprise.

This makes D1's proximate cause — a 350-token cap against a 72-tool agent —
structurally impossible rather than fixed once. It also encodes §1.3's finding:
agent-lane vendors are inherently multi-round-trip and belong in latency-tolerant
use cases.

Interactive use cases (`ask-ai`, `landing-guide`, `support-chat`) move to
`completion` lane. `memory-analysis` and `dashboard-assistant` may keep an agent
vendor, subject to the token floor.

---

## 8. Error handling and data flow

```
request
  → authenticateRequest        (core/middleware.js, Redis-cached)
  → resolve use case + lane    (vendors/index.js)
  → scoreboard.filter(chain)   (core/vendor-scoreboard.js)  ← circuit + tail demotion
  → for each vendor:
       adapter.chat()
         → assertUsableCompletion()        ← throws VendorContractError
       → scoreboard.record(vendor, outcome, latencyMs)
       → on throw: classify(err) → record → continue
  → all exhausted → 503 with a neutral client message
  → tool loop (core/tool-loop.js) if tool_calls present
  → sanitizeVendorResponse()   ← unchanged; vendor identity never leaves
```

Existing invariants that **must not regress**:

- Vendor ids, model names, endpoints and keys never appear in client responses
  or info-level logs.
- `PERSONA_LEAK_BLOCKLIST` enforcement stays at its current central point.
- The tool-calling id-zipping contract (commit `5eed764`) is untouched.

---

## 9. Non-goals

- **No parallel vendor racing.** The existing code comment is correct: racing
  bills every paid vendor for duplicate work on every fallback request.
- **No rewrite of the tool-calling contract.** Recent commits show it is
  hard-won and working.
- **No cross-replica scoreboard state.** In-memory per process, matching
  existing patterns. Revisit only if the service is actually scaled out.
- **No L0 vendor in this spec.** It is a follow-on (§10).
- **No re-litigating the `supabase-edge` deprecation.** Settled 2026-08-19.

---

## 10. Follow-on: L0 as an agent-lane vendor

Out of scope here, recorded so it is not lost. `lanonasis/lzero-concierge`
(`automation/pi-server`) exposes an OpenAI-compatible bridge for the L0
continuity concierge — the HTTP surface for Pi-backed agents that previously did
not exist. It is a natural `agent`-lane vendor for `memory-analysis`.

Prerequisites before it enters any chain:

1. Deployed and measured on this host under the §6 probe.
2. **Not on port 8000** — the bridge's `config.ts` defaults `PORT` to `8000`,
   which `onasis-ai-router` already binds on `127.0.0.1`. The repo's README and
   `.env.sample` also contradict each other (`8000` vs `10000`).
3. Health-checked by real inference, **not** by `GET /v1/models` — that endpoint
   is unauthenticated in the bridge and would recreate D3 exactly.
4. Aware that the bridge ignores `max_tokens`/`temperature`, hardcodes a
   300000ms request timeout, and returns `429 session_busy` for concurrent
   requests on a pinned session.

**No fork of L0 is required.** A custom base URL is supported today via
`auth.baseUrl` (`packages/ai/src/models.ts:482`) and the custom-provider system
in `packages/coding-agent/src/core/provider-composer.ts`. A prior analysis
claiming `OPENAI_BASE_URL` is ignored and a data file needs patching cited
`packages/ai/src/providers/data/openai.json`, **which does not exist in the
repo**. Configuration, not a patch.

---

## 11. Testing

Extends `test-vendor-responsiveness.js`, already wired to `npm test`.

| Area | Test |
|---|---|
| Contract | Table-driven per vendor: a fixture of its known-bad 200 must throw. OpenClaw's real apology string becomes a permanent regression fixture. |
| Contract | A tool-call turn with empty content must **not** throw. |
| Scoreboard | Pure unit tests with an injected clock: a `billing` failure must not be retried within cooldown; a `transient` one must. |
| Scoreboard | A `contract` failure must **increase** the failure count (explicit D4 regression guard). |
| Chain | Fake adapters: vendor 1 returns a sentinel, vendor 2 returns valid prose. Assert the chain continues and vendor 2's answer is returned. **This test fails against current code — that is the point.** |
| Lane | A use case pairing an agent vendor with `maxTokens < AGENT_LANE_MIN_TOKENS` fails startup validation. |
| Decomposition | Full existing suite passes unchanged after Phase 1. |

Tests use fakes, not live vendors, so the suite stays deterministic and free.
The live probe scripts remain separate and manual.

---

## 12. Phasing

One architecture, ordered, each phase independently deployable and revertable.

| # | Phase | Outcome |
|---|---|---|
| 1 | Extract modules | Pure move. No behaviour change. |
| 2 | Response contract | **User-visible symptom stops.** Chain falls through instead of serving error strings. |
| 3 | Typed breaker + scoreboard | Dead vendors self-eject and self-heal; D4 reversed. |
| 4 | Capability health | `/health` stops lying. |
| 5 | Lane typing | The token/agent mismatch becomes structurally impossible. |
| 6 | L0 vendor | Separate follow-on, gated on §10. |

Phase 2 removes the symptom. Phases 1 and 3–5 stop it recurring.

### Rollback — REPO is the git root; see the plan Global Constraints for its per-host value

Each phase is a separate commit on `refactor/outcome-driven-routing`. The
service is deployed via systemd from the working tree, so rollback is
`git revert <phase>` plus:

```bash
export $(grep DOTENV_PRIVATE_KEY_PRODUCTION \
  "$REPO"/services/onasis-ai-router/.env.keys | xargs)
systemctl restart onasis-ai-router
```

---

## 13. Open configuration defaults

Introduced by this spec, all overridable by env:

| Variable | Default | Purpose |
|---|---|---|
| `VENDOR_TAIL_DEMOTE_MS` | `15000` | p95 above which a vendor is demoted |
| `AGENT_LANE_MIN_TOKENS` | `2000` | Token floor for agent-lane vendors |
| `CAPABILITY_PROBE_INTERVAL_MS` | `300000` | Background probe cadence |
| `VENDOR_BILLING_COOLDOWN_MS` | `3600000` | Base billing cooldown (exponential, 12h cap) |
| `VENDOR_CONTRACT_COOLDOWN_MS` | `300000` | Base contract cooldown (exponential, 1h cap) |

Existing `VENDOR_CIRCUIT_COOLDOWN_MS` / `VENDOR_CIRCUIT_THRESHOLD` are retained
for the `transient` class only.
