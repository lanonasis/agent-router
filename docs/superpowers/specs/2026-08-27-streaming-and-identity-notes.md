# Streaming & Caller Identity — reference notes

**Date:** 2026-08-27
**Service:** `services/onasis-ai-router`
**Status:** Reference only. No implementation, no approved design. Read §4 first.

These are findings and cost estimates captured while finishing the
outcome-driven routing work (PR #1), recorded so the next person does not have
to re-derive them. Nothing here has been built.

---

## 1. Streaming: current state

**The router does not stream, at all.** A caller waits the full duration with no
feedback.

- Every adapter hardcodes `stream: false` — `minimax/adapter.js:93`,
  `openai/adapter.js:55`, and OpenClaw's payload.
- `ChainExecutor.run()` does `await vendor._adapter.chat(...)` — fully buffered.
- No SSE route exists. All six routes in `getRoutes()` are plain
  `router.post` / `router.get`.
- **`streamable: true` on `dashboard-assistant` is dead config.** Grep of the
  whole tree: nothing outside `vendors/index.js` reads that field. It is
  returned in the resolved vendor object and never acted on. Do not trust it as
  a signal that streaming was ever partly built — it was not.

Measured cost of that silence (live, 2026-08-26/27): OpenClaw p50 ~3.4s with a
41.5s tail; a chain that walks past dead vendors took 27.0s on its first
request. All of that is currently blank-spinner time.

## 2. The design constraint that makes this non-trivial

Streaming collides with the fall-through guarantee that PR #1 just established.

Once a token is on the wire, it cannot be recalled. If a vendor streams 40 tokens
and *then* violates the response contract, the router has already shown the user
output from a vendor it has now decided to reject. That is the exact defect
Phase 2 closed — reintroducing it through the streaming path would be a
regression with a different shape.

**Decided approach: buffer the first content token, then stream.**

Hold the response until the vendor's first *content* token arrives and passes
`assertUsableCompletion`, then open the SSE stream and forward the remainder.

- A failing vendor produces no content token, so fall-through stays fully intact
  and the Phase 2 guarantee is preserved unconditionally.
- The cost is time-to-first-token, and it is smaller than it looks: most
  observed latency is agent-loop *thinking* time (the OpenClaw journal shows
  several ~1.2s upstream calls before any assistant text), which buffers
  invisibly. The user waits roughly as long as today for the first token, then
  sees streamed output instead of a further blank wait.
- The contract cannot be fully evaluated on the first token alone — sentinels
  are anchored with `^`, so `/^⚠️\s*Agent couldn't generate a response/i` is
  decidable early, but a sentinel that is not anchored would not be. **If
  streaming is built, constrain `errorSentinels` to anchored patterns and assert
  that at startup**, otherwise the guarantee silently weakens.

## 3. What it would take

Rough shape, not a plan.

| Area | Work |
|---|---|
| Adapters | A `chatStream()` alongside `chat()` for vendors that support SSE. MiniMax and OpenAI are OpenAI-compatible (`stream: true` + SSE parse). OpenClaw's gateway is OpenAI-shaped and should work. **Ollama uses its own NDJSON streaming format, not SSE** — a separate parser. |
| `ChainExecutor` | A `runStream()` that walks the chain, buffers to first content token, validates, then yields. Must still `recordSuccess`/`recordFailure` with latency — and latency now means *time to first token*, which is a different metric from the p95 the scoreboard currently tracks. Decide whether to track both or the scoreboard's tail-demotion logic will be comparing unlike numbers. |
| Route | An SSE endpoint with `Content-Type: text/event-stream`, `flushHeaders()`, heartbeat, and client-disconnect handling that aborts the upstream call (otherwise a closed tab keeps billing a paid vendor). |
| Tool loop | **The hardest part.** The follow-up pass runs a *second* vendor call after tools execute. Streaming a turn that may be followed by tool execution and another turn needs an explicit event protocol, not just text deltas. Simplest first cut: **do not stream tool-calling turns** — stream only when `tools` is empty or the first turn returns no tool calls. |
| Clients | Every consumer needs an SSE path. See §4 — at least one cannot currently authenticate at all. |

**Scope suggestion if it is built:** `lrepl` and `dashboard-assistant` first.
A terminal REPL is where silence feels worst, and `dashboard-assistant` has the
longest responses (1200 tokens). Both have few client implementations. Leave
`ask-ai` / `landing-guide` last — 350–400 token answers, least benefit, most
clients to coordinate.

## 4. What to look out for in the custom setup

**These are live findings, not hypotheticals.**

### 4.1 `lrepl` has never reached the router

Verified 2026-08-27:

```
POST https://ai.vortexcore.app/api/v1/ai-chat  ->  401 AUTH_REQUIRED in 0.063s
AI_ROUTER_API_KEY: <unset>
```

`lrepl` (`/usr/bin/lrepl` → `@lanonasis/repl-cli`, package at
`/opt/lanonasis/lan-onasis-monorepo/apps/lanonasis-maas/packages/repl-cli`) is a
real router consumer: `src/core/ai-router-client.ts:66` posts to
`${baseUrl}/api/v1/ai-chat` and sends the `X-Use-Case` header. But with no key
configured it gets an immediate 401 and degrades:

```
[LZero] Processing request...            orchestrator.ts:462  call starts
[LZero] Using enhanced mode (44ms)       orchestrator.ts:479  <- this is the CATCH block
  → Switching to backup intelligence...  orchestrator.ts:480
Falling back to pattern matching...      orchestrator.ts:486  openaiApiKey unset, so OpenAI skipped
Hello root! Great to see you...          orchestrator.ts:779  canned fallbackProcessor output
```

Consequences worth internalising:

- **"Using enhanced mode" is a failure being reported as an upgrade.** It is
  printed from a `catch`. Anyone reading that output reasonably concludes the
  system is working better than usual. It is the opposite. This label alone can
  cost hours of misdiagnosis — and plausibly contributed to earlier reports of
  "awkward agent feedback" that were never the router at all.
- **The 44ms is the tell.** Any router round-trip under ~200ms did not reach a
  model. Treat sub-200ms "success" as a failure until proven otherwise.
- **Fix is configuration, not code:** set `AI_ROUTER_API_KEY` for `lrepl`. Do
  that before drawing any conclusion about router behaviour from a REPL session.

### 4.2 Three unrelated things are all called "persona"

Do not conflate them. They live in different repos and leak into each other when
confused:

| Layer | Where | What it is |
|---|---|---|
| Router personas | `vendors/index.js` `SYSTEM_PROMPTS` + `core/prompt-composer.js` (SOUL.md + role prompts) | The Onasis-branded system prompt per use case |
| Leak defence | `vendors/index.js:591` `PERSONA_LEAK_BLOCKLIST`, `:614` `sanitizePersonaLeaks()` | **Live, load-bearing.** Added by `9abfa7e` after OpenClaw's `fixer` agent leaked its ambient "Mr Banks" identity into concierge replies |
| `lrepl`'s `[LZero]` | `repl-cli` `orchestrator.ts` | The CLI's own hardcoded label + canned fallback strings. **Not** the router's persona |
| L0 lenses | `lanonasis/lzero-concierge`, `extensions/maas/personas.ts` | `lzero` / `mind` / `heart` / `concierge`. A separate product |

`sanitizePersonaLeaks` is not dead code and must not be removed — it is the
mitigation for a real incident. Equally, **do not import another product's
persona layer into the router**; that is the shape of the original leak.

Also relevant if L0 is ever routed to: its persona is process-global mutable
state (`let activePersona` in `personas.ts`) and `/persona` is an
**interactive-mode slash command**. The OpenAI bridge's RPC protocol has ten
command types and none of them switches persona, so **through the bridge the
persona is permanently `lzero`** and cannot be changed by a caller.

### 4.3 Caller identity is available and mostly discarded

`/v1/auth/resolve` (`onasis-core/services/auth-gateway/src/routes/resolve.routes.ts:237`)
returns twelve fields. `core/middleware.js:63` destructures five.

| Field | Returned | Router keeps it |
|---|---|---|
| `authId`, `organizationId`, `authMethod`, `email`, `fromCache` | yes | yes |
| `actorType` (`'user'`), `apiKeyId`, `credentialId`, `requestId`, `authSource`, `actorId` | yes | **no — dropped** |

No display name here — but see below: `/v1/auth/resolve` is not the only
identity endpoint, and the name lives on a different one.

`/v1/auth/resolve` is **not the only identity endpoint**, and an earlier draft of
this document was wrong to conclude from it that no display name exists. It does.

### `GET /v1/auth/me` — the profile endpoint

`auth.routes.ts:25` → `authController.getMe` (`auth.controller.ts:2343`),
documented as *"Full user profile with OAuth metadata — used for personalized
experiences in IDE, CLI, and analytics"*. It returns:

```js
name       = metadata.name || metadata.full_name || metadata.user_name || null
avatar_url = metadata.avatar_url || metadata.picture || metadata.image || null
// plus: id, email, role, provider, project_scope, platform,
//       created_at, last_sign_in_at, metadata.{locale,timezone}
```

**It works with the router's existing credential.** `requireAuth`
(`middleware/auth.ts:111`) accepts a JWT, an opaque OAuth token, *and*
`x-api-key` (`:201`). On the API-key branch it calls `validateAPIKey` and sets
`req.user.userId = validation.userId` — the key's **owner** — which `getMe` then
resolves via `findUserAccountById`.

Consequences:

- **"hello Derick" is a router-only change.** No auth-gateway work is required;
  the data and the endpoint already exist and already accept the router's
  credential.
- **"hello Slackbot" is still not available.** An API key resolves to its owner,
  so a key created for Slack would greet you with the *owner's* name, not the
  key's. `validation.keyContext` and `apiKeyId` exist inside the middleware but
  `getMe` does not return a key name. Machine-caller naming needs either a new
  field or a generic label chosen from `actorType` / `apiKeyId`.
- **Distinguishing human from machine is nearly free either way** — `actorType`
  is already returned by `/v1/auth/resolve` and simply discarded in
  `core/middleware.js:63`.
- **`name` can legitimately be `null`.** It is read from OAuth `raw_metadata`,
  so accounts created by email/password may have none. `getMe` returns `null`
  rather than failing; any greeting needs a fallback path.
- **Cost is a second round-trip.** The router currently makes one call to
  `/v1/auth/resolve`, Redis-cached at ~16ms. A profile lookup should reuse the
  same `core/auth-cache.js` pattern with a longer TTL — a display name changes
  far less often than a credential's validity, so the 20s auth TTL is
  unnecessarily short for it.
- **Do not copy `lrepl`'s approach.** It greets from `process.env.USER_NAME ||
  process.env.USER` (`repl-cli/src/config/loader.ts:43`), which on this VPS is
  `root` — hence "Hello root!". Personalisation must come from the
  authenticated identity, never from the process environment.

### 4.4 Caller-declared use case is unverified

`resolveUseCaseFromRequest` reads `body.use_case` or the `X-Use-Case` header and
falls back to `ask-ai`. The validation line rejects *unknown* use cases but not
*wrong* ones — any caller can claim any use case and get that lane's prompt,
token budget and vendor chain. `req.uai` is never consulted. Binding permitted
use cases to the authenticated org/key would fix it, but it is a **breaking
change for every existing caller**, so it needs its own design.

---

## 5. Related

- PR #1 — outcome-driven routing phases 1–3
- `docs/superpowers/specs/2026-08-27-outcome-driven-routing-design.md`
- Phase 4 (capability health) and Phase 5 (lane typing) remain unbuilt; lane
  typing in particular interacts with §3, since agent-lane vendors are
  multi-round-trip and benefit most from streaming.
