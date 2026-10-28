# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Snapshot date: 2026-08-19.** This document describes live-verified state as of that date. Vendor
credentials, model availability, and OpenClaw agent auth status are all things that drift — re-verify
before trusting anything below that isn't a code/architecture fact. Where a fact came from a live probe
rather than reading source, that's noted so a future session knows whether to just trust it or re-check.

## What this service is

`onasis-ai-router` is a shared, multi-tenant AI vendor router. It fronts **every** AI-chat consumer on
this platform — the `lanonasis repl` CLI, the VS Code/Cursor/Windsurf IDE extension (once wired, see
Concierge Wiring below), Slack/Discord concierge bots (once wired), and `ai.vortexcore.app` (VortexCore's
own chat surfaces). Clients never pick a vendor or model — they send a `use_case` string and the router
picks the vendor, model, system prompt, and fallback chain internally. This is a **hard design
invariant** (see `vendors/index.js` header comment) — vendor identifiers, model names, and API keys must
never reach a client response or an info-level log.

**Live path:** systemd service `onasis-ai-router.service`, working directory
`/opt/lanonasis/shared_services/onasis-agent-haven/services/onasis-ai-router`, git repo
`lanonasis/onasis-agent-haven`. Runs as non-root user `onasis-ai-router` (not root — hardened
2026-08-19), bound to `127.0.0.1:8000` only. `nginx` (`ai.vortexcore.app`) proxies `/` straight through
with no path rewriting — every route below is reachable at `https://ai.vortexcore.app/<path>` verbatim.

**Do not confuse with** `/opt/lanonasis/shared_services/onasis_ai_router/` (no hyphen, not nested under
`services/`) — a stale, non-git, untouched-since-2026-05-23 copy predating the monorepo restructure.
Not what systemd runs. `/opt/lanonasis/agents.md` used to point at it; fixed 2026-08-19, but if you find
another doc with the underscore path, it's wrong.

## Companion docs

- **`docs/INTEGRATION-GUIDE.md`** — hand this to anyone plugging an application into the router. Full
  HTTP contract, auth rules, use-case selection, tested client implementations, browser-app security
  (server-side proxy requirement), per-project notes, and an anti-hallucination checklist. Consumers
  should need only that file; this one is for people working ON the router.
- **`scripts/router-logs.js`** — operational log summariser (see "Reviewing logs" below).

## Commands

```bash
# Restart (always via systemd — never manual kill+nohup, Restart=always will fight you)
systemctl restart onasis-ai-router.service
systemctl status onasis-ai-router.service
journalctl -u onasis-ai-router.service -f

# Edit encrypted secrets (dotenvx, AES-256-GCM) — --ops-off is mandatory, see root DOTENVX-RUNBOOK.md
dotenvx set SOME_VAR "value" -f .env.production --ops-off

# Syntax-check before restarting into new code
node --check server.js && node --check core/ai-service-router.js && node --check vendors/index.js

# Health (rtk, the shell wrapper on this host, silently rewrites plain `curl` output into a schema
# stub instead of running the request — always use `command curl`, not `curl`, when testing this service)
command curl -s http://127.0.0.1:8000/health
```

There is no test suite for this service. Verification is live-curl-and-read-the-logs; see "How to verify
a change" below.

## Architecture

```
server.js                    Express wrapper: CORS, rate limiting (120 req/min/IP, dependency-free
                              in-memory), request logging (PII-redacted), keep-alive tuning.
                              Loopback-only bind. Mounts AIServiceRouter's routes at '/'.

core/ai-service-router.js    AIServiceRouter class — the real logic. Auth, use-case resolution,
                              vendor fallback loop, tool-call dispatch, response sanitization.

vendors/index.js             Vendor abstraction layer. USE_CASES registry (what the platform needs),
                              VENDOR_REGISTRY (how each vendor is reached), resolveVendorChainForUseCase
                              (which vendors to try, in what order), sanitizeVendorResponse (strip vendor
                              identity + persona-leak scrubbing before anything reaches a client).

vendors/<name>/adapter.js    One per vendor: ollama, openai, anthropic, openclaw, supabase-edge
                              (deprecated), deepseek (stub), hermes (stub). Each exports
                              {chat(internalRequest, model), healthCheck()}.

vendors/_shared/http-client.js   Shared undici keep-alive Agent + fetchWithRetry (one retry on
                              network error/5xx/429, never on 4xx auth errors).

core/prompt-composer.js      Builds the final system prompt per use case: SOUL.md (shared identity)
                              + role prompt (agent_model_files/subagents/*.md) + lane prompt
                              (agent_model_files/lanes/*.md). Owns the single use-case table,
                              DEFAULT_USE_CASE_PROMPTS, mapping each use case to both halves.
                              Before 2026-09-11 the lane prompts were string literals in
                              vendors/index.js (SYSTEM_PROMPTS) keyed by a second, unchecked map —
                              see "Prompt composition" below.
```

### Request flow

```
POST /api/v1/ai-chat  (alias: POST /functions/v1/ai-chat)
  → authenticateRequest       resolves X-API-Key / Authorization Bearer via
                               AUTH_GATEWAY_URL/v1/auth/resolve (localhost:4000), 20s Redis-backed cache
  → trackUsage
  → routeToAIService → handleOllamaChat
        resolveUseCaseFromRequest(req)      body.use_case → X-Use-Case header → 'ask-ai' default
        resolveVendorChainForUseCase(useCase)
        promptComposer.compose({useCase, runtimePrompt})
        prefetchMemoryBrief(...)             optional, 3s budget, swallowed on failure
        for each vendor in chain:
            adapter.chat({messages, systemPrompt, tools, ...}, model)
            on success: break
            on failure: circuit-breaker record, try next vendor
        if tool_calls present: executeToolCalls → follow-up adapter.chat() pass
        sanitizeVendorResponse(result, useCase)   strip vendor fields + persona-leak scrub
        wrapResponse(text, rawMessage)             → { response, actions? }
        addOnasisBranding(...)                     → + onasis_metadata
```

### Response contract — READ THIS BEFORE WRITING A CLIENT

The canonical shape (`core/ai-service-router.js` `wrapResponse()` + `addOnasisBranding()`), confirmed
live 2026-08-19:

```json
{
  "response": "the synthesized answer, plain text",
  "actions": [ ],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 },
  "onasis_metadata": {
    "service": "ai-chat",
    "user_auth_id": "...",
    "processing_time": 1234,
    "powered_by": "Onasis-CORE Partnership Platform",
    "partner_api_version": "2.0.0",
    "timestamp": "..."
  }
}
```

**It is NOT `{ message: { content } }`.** That shape does not exist on this endpoint. This was gotten
wrong at least twice in this session's own draft guidance before being caught against the real source —
if you're about to write `data.message.content` anywhere, stop and check `wrapResponse()` again.

The canonical reference client is `apps/lanonasis-maas/packages/repl-cli/src/core/ai-router-client.ts` in
the `lan-onasis-monorepo` repo — it reads `data.response || data.message?.content || ''` (defensive, but
`response` is what's actually sent) and gets auth header selection right. Match it; don't invent a second
pattern per integration surface.

### Auth

- `X-API-Key: lano_...` — canonical for programmatic/service callers. Resolved via `auth_gateway.*`
  tables in Supabase project `ptnrwrgzrsbocgxlpvhd` ("CONNECTION POINT"), NOT the Neon DB some other
  docs in this stack describe — that's a different, unrelated auth-gateway generation.
- `Authorization: Bearer <supabase JWT or opaque OAuth token>` — for session-based/SSO callers.
- These are mutually exclusive priority paths in the auth-gateway's resolver, not synonyms — a `lano_*`
  key sent as `Authorization: Bearer lano_...` will NOT resolve; it must be `X-API-Key`.

### Use cases and vendor routing (current, verified 2026-08-19)

```
landing-guide, ask-ai, dashboard-assistant, support-chat, memory-analysis
    → pi -> minimax -> openclaw -> openai -> anthropic -> lmstudio   (interactive/latency-sensitive)

content-generation, code-assist, repl-nlp
    → minimax -> pi -> openclaw -> openai -> anthropic -> lmstudio   (batch/latency-tolerant)

tool-proxy   (caller-executed tools — see "Tool safety")
    → openai -> minimax -> anthropic -> openclaw   (native-tool vendors only)
```

**2026-09-18: `ollama` replaced by `lmstudio` as the local/free last-resort vendor** in every
`vendorOrder` above (`VENDOR_REGISTRY.ollama.status` is now `'deprecated'`, adapter kept on disk).
Measured ~12x faster on this host for the same coder model (`qwen2.5-coder-ops`), and its systemd unit
(`/etc/systemd/system/lmstudio.service`) actually survives reboots — the old `ollama serve` process had
been running unmanaged since a manual start with no persistence at all until this session set up both.
`ollama.service` itself is still running (kept for `ollama: cloud` usage only) but its one pulled model
was removed to reclaim disk and `OLLAMA_KEEP_ALIVE=0` was set, so re-activating the `ollama` vendor entry
without first re-pulling a model would 404 on every call. New adapter: `vendors/lmstudio/adapter.js`,
OpenAI-compatible wire format against `http://127.0.0.1:1234/v1` (no API key). Verified live via
`/health` immediately after restart: `"lmstudio":{"status":"healthy",...}`.

`minimax` sits ahead of `openai`/`anthropic` because those two are currently zero-credit — it is the
only cloud vendor in the chain with working billing as of 2026-08-19.

`memory-analysis` is the lane that backs (or will back — see Concierge Wiring) the IDE-extension sidebar
chat box and the Slack/Discord memory concierge. It is deliberately cloud-first: the underlying Ollama
model on this host is CPU-bound and takes 12-50s per response depending on prompt/tool-calling overhead,
which is unacceptable for an interactive chat surface someone is watching a spinner for.

Each `USE_CASES` entry has two routing-relevant fields, and they do **different** things —
conflating them was the root cause of `openclaw`/`hermes` being unreachable for months:
- `vendorOrder: [...]` — the actual vendor fallback order, tried left-to-right, added 2026-08-19.
- `modelLane` (was `vendorPriority` before 2026-08-19, still read as a fallback for compat) — picks
  which MODEL to use *within* whichever vendor the chain lands on (`vendorConfig.models[modelLane]`).
  It never selects a vendor. Before `vendorOrder` existed, vendor selection was implicitly "first
  active entry in `VENDOR_REGISTRY`'s **object key declaration order** that supports this use case" —
  which is always `ollama`, since it declares `capabilities: ALL_USE_CASES` and is listed first. That
  made `openclaw` and `hermes` structurally unreachable no matter how they were configured.

`resolveVendorChainForUseCase` tries `vendorOrder` first (skipping ineligible vendors rather than
truncating the chain at the first gap), and only falls back to the legacy registry-order walk if a use
case has no `vendorOrder` or every named vendor is currently down.

### Vendor status (`VENDOR_REGISTRY`, current)

| vendor | status | notes |
|---|---|---|
| `lmstudio` | active | Local, free, replacing `ollama` (2026-09-18) as the last-resort local vendor in every chain. `http://127.0.0.1:1234/v1`, OpenAI-compatible, no API key. Only `qwen2.5-coder-ops` confirmed loaded/working — every `models.*` lane defaults to it. systemd-managed (`lmstudio.service`), survives reboots. |
| `ollama` | **deprecated** 2026-09-18 | Adapter kept on disk, not wired into any `vendorOrder`. Its pulled model was removed and `OLLAMA_KEEP_ALIVE=0` set — `ollama.service` itself still runs (for `ollama: cloud` usage only), but this vendor entry would 404 on every call if re-activated without re-pulling a model first. |
| `openai` | active, **out of credit** | `429 insufficient_quota` as of 2026-08-19. Code path is fine; this is a billing action only the account owner can take. |
| `anthropic` | active, **out of credit** | `400 credit balance too low`, same story. |
| `openclaw` | active | Genuinely OpenAI-compatible gateway (`127.0.0.1:18789/v1/chat/completions`), fronts Pi-embedded agents. See OpenClaw section below — this is where most of the interesting/fragile state lives. |
| `minimax` | active | OpenAI-compatible (`https://api.minimax.io/v1`), model `MiniMax-M3`, ~3s. **The only cloud vendor with working credit right now.** Key from `MINIMAX_API_KEY` (originally provisioned for the `mmx` CLI at `/root/.mmx/config.json`). Three quirks handled in its adapter, see below — don't "simplify" them away. |
| `supabase-edge` | **deprecated** 2026-08-19 | DO NOT re-activate. See "The VortexCore circular dependency" below — this is a load-bearing incident record, not a stylistic note. |
| `deepseek` | stub | Adapter exists, not wired to any use case's `capabilities`. |
| `hermes` | stub | Adapter exists; chat endpoint path is unverified per its own file header. Do not flip to active until confirmed against the live Hermes Gateway API. |

## The VortexCore circular dependency (2026-08-19 incident — do not re-introduce)

`vendors/supabase-edge/adapter.js` targeted `mxtsdgkwzjzlttpotole/functions/v1/ai-router` — which is
**VortexCore's own AI router**, one of THIS router's consuming applications. That inverted the intended
architecture (VortexCore → Onasis router) into a cycle: Onasis router → VortexCore's router → (VortexCore
→ Onasis again). A shared platform router must never fall back into one consuming product's own backend.

It was also the root cause of a "VortexCore digital banker" persona leak that took most of a session to
fully diagnose. Confirmed via the Supabase Management API against the deployed edge function source: it
**hardcodes** its persona as the first system message and appends the caller's messages after it —

```js
const VORTEX_SYSTEM_PROMPT = `You are VortexAI, the embedded digital banker inside the VortexCore app...`;
const conversation = [
  { role: 'system', content: VORTEX_SYSTEM_PROMPT },   // ALWAYS first, hardcoded
  ...messages.slice(-8).map(...)                        // caller's messages appended after
];
```

No caller-side payload can ever override a server-side prepend. An earlier same-day fix in this repo
(forwarding `systemPrompt` as a `role:'system'` message from the adapter) reduced but could not
eliminate the leak — that fix is still in `vendors/supabase-edge/adapter.js` and is harmless, but was
treating a symptom. The edge function also truncates to the last 8 messages and rewrites `role:'tool'` →
`'assistant'`, silently corrupting the tool-calling contract for anything that fell through to it.

**Resolution:** `supabase-edge` is `status: 'deprecated'` in `VENDOR_REGISTRY`. All `fallbackVendor`
pointers to it are `null`. `resolveVendorChainForUseCase` only ever walks `active` vendors, so it is
removed from every chain. The adapter file is kept on disk for reference/audit, not deleted. **If a
last-resort managed cloud fallback is wanted later, it must be a NEUTRAL Onasis-owned endpoint that
honors the caller's system prompt verbatim — never any single consuming product's own assistant.**

## Persona/identity leak defense (three layers, 2026-08-19)

This turned out to be a multi-layer problem; each layer catches what the previous one misses.

1. **Structural** — the circular dependency above, fixed by deprecating `supabase-edge`.
2. **Prompt pinning** — `agent_model_files/lanes/memory-intelligence.md` explicitly states
   the identity ("You are the Onasis L0 memory assistant... When asked who or what you are, always
   answer that you are the Onasis L0 memory assistant. Never claim to be another product, model, or
   platform...").
3. **Text-level enforcement** — `sanitizeVendorResponse()` calls `sanitizePersonaLeaks()` on every
   response before it reaches a client. This exists because base models and agent-gateway vendors
   (openclaw in particular) answer "who are you?" from their own training/context data regardless of
   system-prompt instructions — field-stripping can't catch that, only text rewriting can. Current
   coverage, all whole-word/phrase regex rewrites to "Onasis" or a masked value:
   - Brand/platform names: `OpenClaw`, `Nemotron`, `NVIDIA`, `Hermes`, `Ollama`, `VortexAI`,
     `VortexCore`, `kilocode`, the agent's own ambient name ("Mr Banks").
   - Model-identifier strings containing a known stem (`nemotron`, `qwen`, `llama`, `claude`, `mistral`,
     `deepseek`, `gpt`) — e.g. `kilocode/nvidia/nemotron-3.5-lightning:free`.
   - Self-identification shapes: `"I am X"`, `"call me X"`, `"trained/developed/built by X"`, `"as an
     AI language model"`.
   - **Server-internal filesystem paths** (`/root/...`, `/home/...` → `[workspace]`) and **the server
     operator's real name** → "the Onasis team". Added after discovering that even a brand-new OpenClaw
     agent with zero accumulated history still leaked `/root/.openclaw/workspace` and the operator's
     name under an identity probe — traced to OpenClaw's `recall-forge` plugin auto-injecting
     cross-agent context regardless of which agent handled the request. (`recall-forge`'s own
     `agentId: "MrBanks"` config value is also where the "Mr Banks" persona came from.)
     **Fixed at the source 2026-08-19 by the platform owner**: `recall-forge` is now
     `recallMode: "ondemand"`, `autoRecall: false` — it no longer auto-injects. This text-level scrub is
     retained as defense-in-depth (it costs nothing and covers any vendor, not just OpenClaw), but the
     underlying injection vector is closed, not merely contained.

**Known residual, not chased further (diminishing returns):** under sustained adversarial interrogation
("what files define your operational modes?"), the model can still name internal OpenClaw config files
by filename (`AGENTS.md`, `ORCHESTRATOR.md`, etc.) without their path. This does not disclose anything
an attacker couldn't already infer, and normal usage patterns (a user asking about their memories) never
approach this. If it needs closing later, extend `PERSONA_LEAK_BLOCKLIST`/`sanitizePersonaLeaks`, same
pattern as everything above.

**Verification pattern for any future persona work:** don't trust a single "hello" test. Use an explicit
identity probe (`"who are you? be specific about your name, workspace path, and who built you"`) — the
leaks in this incident were invisible on casual greetings and only surfaced under direct questioning.

## OpenClaw integration

Gateway: `127.0.0.1:18789`, OpenAI-compatible (`/v1/chat/completions`), auth via `OPENCLAW_GATEWAY_TOKEN`
bearer token (configured in this router's `.env.production`, matches the live gateway process's env —
verify with `ss -tlnp | grep 18789` to find the current gateway PID, since it changes across OpenClaw's
own restarts, and diff its `/proc/<pid>/environ` against the router's).

**The router's health check for openclaw only probes reachability, not model authorization.** It reported
"healthy" through an entire outage window where every configured agent was returning 401/403 (expired/
unauthorized model credentials). Do not trust `/health`'s `openclaw: healthy` as proof calls will
actually succeed — hardening `healthCheck()` to do a minimal authenticated completion is a known,
un-scheduled follow-up.

### Agent roster (as of 2026-08-19 — **re-verify before trusting**, provider auth expires/rotates)

`openclaw agents list` / `/root/.openclaw/openclaw.json` `agents.list`:

| agent | model (primary) | used for |
|---|---|---|
| `fixer` | `kilocode/nvidia/nemotron-3.5-lightning:free` | `ask-ai`, `landing-guide`, `dashboard-assistant`, `support-chat`, `memory-analysis` — all 5 conversational lanes |
| `data` | `kilocode/stepfun/step-3.7-flash:free` | (authenticated and working; not currently routed to) |
| `coder` | `hetz/Qwen/Qwen3.6-35B-A3B-FP8` | `code-assist`, `repl-nlp` |
| `research` | `kimi/k2p5` | `content-generation` |
| `onasis-router` | `kilocode/nvidia/nemotron-3.5-lightning:free` | **NOT ROUTED TO — has no auth, see below** |

**Two traps here, both hit for real on 2026-08-19:**

1. **`USE_CASE_AGENT` was dead config for its entire existence.** `vendors/openclaw/adapter.js`'s
   `pickAgent()` reads `internalRequest.useCase`, but `handleOllamaChat` never put a `useCase` field in
   that object — so it was always `undefined`, the map never matched, and *every* request fell through
   to `DEFAULT_AGENT` (`fixer`) regardless of use case. Fixed in commit `7462991`. If you change this
   map, verify the routing actually takes effect (check which agent answered) rather than assuming.
2. **`openclaw agents add` creates an agent with an EMPTY, isolated auth store**
   (`/root/.openclaw/agents/<id>/agent/openclaw-agent.sqlite`). Such an agent returns
   `No API key found for provider "<provider>"` (HTTP 401) until auth is configured for it or portable
   static profiles are copied from the main agentDir. This is why `onasis-router` — created to isolate
   the conversational lanes — is **not** routed to: once the `useCase` bug above was fixed, routing to
   it would have 401'd all 5 interactive lanes. Its original purpose (escaping recall-forge's
   auto-injected context) was independently solved at the source anyway; see the persona section.
   **Before routing any lane to a new agent, probe it directly first** — see the verification command
   below; a 401 there means it will fail in production.

`vendors/openclaw/adapter.js`'s `USE_CASE_AGENT` map controls agent selection; it's independent of
`vendors/index.js`'s `vendorOrder`/`modelLane` (that layer picks *which vendor*, this one picks *which
OpenClaw agent* once `openclaw` is the selected vendor).

**Provider auth reality (2026-08-19, `openclaw models auth list` for agent `fixer`):** profiles exist for
`anthropic` (OAuth), `google`, `groq`, `kilocode`, `kimi`/`kimi-coding`, `minimax`/`minimax-portal`,
`openai` (OAuth, two profiles), `opencode`/`opencode-go`, `qwen-portal`. Confirmed working live:
`kilocode/nvidia/nemotron-3.5-lightning:free`, `kimi/k2p5`, `kimi/kimi-k2-thinking`,
`kilocode/stepfun/step-3.7-flash:free`, `hetz/Qwen/Qwen3.6-35B-A3B-FP8`. Confirmed broken at various
points this session: `hetz/DeepSeek-V4-Flash-0731`/`hetz/Kimi-K2.7-Code` (403 "model use not permitted"),
`opencode/deepseek-v4-flash-free` (expired login). **This list rots — a model working today does not mean
it'll work next week.** Re-verify with a direct gateway probe before assuming an agent's configured model
still works: `command curl -sS http://127.0.0.1:18789/v1/chat/completions -H "Authorization: Bearer
$TOKEN" -d '{"model":"openclaw:<agent>","messages":[...]}'`.

Config backups from this session's edits: `/root/.openclaw/openclaw.json.bak-20260819-*`.

## MiniMax adapter quirks (all three verified live 2026-08-19 — do not remove)

`vendors/minimax/adapter.js` is structurally a copy of the OpenAI adapter, plus three deliberate
deviations. Each exists because of observed behaviour, not defensiveness:

1. **Reasoning tokens are INLINE in `message.content`.** `MiniMax-M3` emits `<think>...</think>` inside
   `content` and does **not** populate a separate `reasoning_content` field. Unstripped, the user
   receives the model's internal monologue as the answer. `stripThinkBlocks()` removes closed blocks and
   tolerates an unclosed trailing `<think>` (truncated / max-token responses). This is a correctness
   issue as well as cosmetic: `extractSoftToolCalls()` scans response text for JSON, so a reasoning
   trace containing a JSON snippet could be misparsed as a tool call.
2. **It ignores system-prompt identity instructions.** Asked "who are you?" with an Onasis system prompt
   in place, it answers "I'm MiniMax-M3, an AI assistant made by MiniMax". Handled centrally —
   `MiniMax`/`Minimax`/`minimax` are on `PERSONA_LEAK_BLOCKLIST` — not in the adapter, since every
   vendor needs the same treatment and one central list is the auditable place for it.
3. **It returns HTTP 200 with an in-body error envelope** (`base_resp.status_code != 0`) for some auth,
   quota, and rate-limit failures. A bare `response.ok` check treats those as successful empty
   completions and hands the user an empty string instead of failing over to the next vendor. The
   adapter raises on a non-zero `status_code` so the chain continues.

Its `healthCheck()` issues a real 1-token completion rather than a reachability probe — deliberately not
repeating the OpenClaw mistake documented above, where a reachability-only check reported "healthy"
through an entire credential outage.

**On swapping the model.** `MiniMax-M3` is a reasoning model, hence quirk 1. Non-reasoning MiniMax models
(e.g. `MiniMax-M2.7`, `MiniMax-M-2.5`) would not emit `<think>` blocks at all. A swap is **not required** —
`stripThinkBlocks()` is verified working and is the safer design regardless, since it also protects
against a future model or provider re-introducing inline reasoning. If you do want to swap for cost,
speed, or context-window reasons, it is a **config change only**: set `MINIMAX_FAST_MODEL` /
`MINIMAX_QUALITY_MODEL` in `.env.production` — no code change, and leave the strip in place.

## Prompt composition (merged 2026-09-11)

A request's system prompt is three files, composed by `core/prompt-composer.js`:

```
## Shared Identity      agent_model_files/SOUL.md              (every lane, unconditionally)
## Role Prompt          agent_model_files/subagents/<role>.md  (role map)
## Runtime Instructions agent_model_files/lanes/<lane>.md      (lane map)
```

Both maps come from **one** table, `DEFAULT_USE_CASE_PROMPTS`. That is the merge: until 2026-09-11 the
lane half was a string literal in `vendors/index.js` keyed by `USE_CASES[uc].systemPromptKey`, while the
role half was a separate map in the composer. Two tables over one key space, different owners, different
formats, and only the corpus half overridable without a redeploy — registering a use case meant editing
both, and nothing compared them. `USE_CASES[uc].systemPromptKey` is still the lane key, so existing
entries kept pointing at the same text.

Guards, and what each actually covers — they do **not** overlap:
- `scripts/capture-prompt-baseline.js --check` composes against a `[[RUNTIME]]` placeholder, so it pins
  SOUL + role across 54 mode/use-case/vendor combinations and says **nothing** about lane text.
- `test/prompt-system-merge.test.js` pins each lane against `test/__baselines__/lane-prompts.json` — the
  literals as they were immediately before the move — and asserts every use case resolves both halves.
- `scripts/capture-corpus-parity.js --check` tracks the router corpus against `packages/agent-model-files`.

Overrides: `PROMPTS_ROOT` (corpus root), `PROMPT_USE_CASE_ROLE_MAP` and `PROMPT_USE_CASE_LANE_MAP` (JSON,
merged over defaults). A corpus without a `lanes/` directory falls back to the bundled copies and warns
once, rather than blanking the system prompt — `capture-corpus-parity.js` points `PROMPTS_ROOT` at the
canonical package, which has role prompts but no lanes.

**Open question, measured not resolved: SOUL.md is prepended to every lane, and it is a developer-agent
document.** It opens "I am an execution partner. Not a chatbot", and carries "Types are not optional.
Tests are not optional", a risk-posture table about database migrations and deployment configs, and six
per-role agent souls (coder/reviewer/architect/tester...). That composes into `landing-guide` — the
**anonymous** public `/api/v1/public/ask` surface — and into `support-chat`, where it contradicts the
lane prompt sitting directly beneath it ("Welcome users warmly", "Help users resolve issues with
empathy"). Measured `hybrid`-mode composition, 2026-09-11: 13,503–13,896 chars on six of eight lanes and
11,661/11,680 on the two developer lanes, against a lane prompt of 166–402 chars — so SOUL + role is
**97.1–98.8% of every system prompt this router sends**, and the part written for the lane is the
remaining one to three percent. This is also most of why the router's corpus composes 24–36% larger
than the canonical package
(`docs/CORPUS-MERGE.md`). Scoping SOUL.md to the developer lanes is a persona change on live concierge
traffic, so it is deliberately **not** part of the structural merge — it needs a product decision, and
`capture-prompt-baseline.js` will show exactly what moves when someone makes it.

## Tool safety

- **Pass-through lane (`tool-proxy`) — added 2026-10-28.** Some callers own tools this router cannot
  reach (the dashboard concierge's control-room reads and proposal writes, for example). On this lane
  the router RETURNS the model's `tool_calls` instead of executing them, and the caller runs them and
  sends `role: "tool"` results back on the next request. Three properties are enforced, not documented:
  (1) only vendors declaring `supportsNativeTools: true` may serve it — pi is `false` because its
  adapter passes `--no-tools` unconditionally, which is exactly why `dashboard-assistant` answered "no
  tools are available" on 2026-10-27; lane validation refuses to boot a chain containing a non-tool
  vendor, including via `AI_VENDOR_ORDER`; (2) the credential's resolved `auth_id` must be listed in
  `TOOL_PASSTHROUGH_AUTH_IDS` — unset means nobody, and the refusal logs the id; (3) the lane is
  buffered, so the streaming routes refuse it. A request with no caller `tools` is refused (`400
  tools_required`) rather than falling back to `memory.*`, because the fallback would reproduce the
  original defect silently. Code: `core/tool-passthrough.js`.
- **`code.*` tools** (`code.read`, `code.write`, `code.run_command`, `code.scan_dependencies`,
  `code.find_related`) — NOT offered by default (`getCodeToolDefinitions()`, separate from
  `getToolDefinitions()`). Require ALL of: explicitly offered in this specific request's `tools` array,
  AND caller's `auth_id` in `CODE_TOOLS_TRUSTED_AUTH_IDS` (currently just `admin@lanonasis.com`'s
  `auth_id`, `b0f23242-48c5-4273-b8a7-2e1267e08c8f`), AND `CODE_BASE_DIR` configured (currently
  `/opt/lanonasis/mcp-core` — the memory-core service repo, deliberately NOT this router's own source
  tree). Filesystem access is sandboxed to `CODE_BASE_DIR` with path-traversal checks, PLUS a
  secret-shaped-filename denylist (`.env*`, `*.key`/`*.pem`, `id_rsa*`, `.npmrc`, `.netrc`) enforced in
  both the path resolver AND `code.run_command`'s argument list (closes the shell-read
  bypass against `.env.production` — the path resolver only ever validated `cwd`,
  never the arguments `cat`/`grep`/`find`/etc. take as parameters).
- **`memory.*` tools** have NO offered-tools/trusted-identity gate — they dispatch directly whenever
  offered. The tool *definition itself* is the only control. `memory.write` (mutating) is therefore
  withheld by default from every question-answering use case — offered only on `repl-nlp` (explicitly
  agentic; the user is issuing commands). Override via `MEMORY_WRITE_USE_CASES` env var
  (comma-separated use-case list) if a surface genuinely needs autonomous writes — don't flip the
  default, opt in per use case. A caller can still pass its own `tools` array to get write access
  regardless of this default.
- **Tool-call leak (fixed 2026-08-19, confirmed firing in prod before the fix):** the follow-up
  inference pass (after a tool executes) was never re-checked for emitting *another* tool call. A model
  re-emitting the same `{"name":"memory.write","arguments":{...}}` JSON on the follow-up pass went
  straight to the client as the "answer" — `cleanAssistantText()` deliberately preserves valid JSON, so
  nothing downstream caught it. Now detected (`extractSoftToolCalls`/`extractToolCalls` re-checked on
  the follow-up) and replaced with a plain-language summary. The repeated call is **not** re-executed —
  it already ran once; re-running risks an unbounded call/result/call loop and duplicate writes.

## Reliability

- **Circuit breaker**: opens after 3 consecutive failures per vendor, `VENDOR_CIRCUIT_COOLDOWN_MS`
  (default was 30000, raised to 300000 on 2026-08-19 — a 30s cooldown meant every 30 seconds of traffic
  re-paid the "try 3 dead vendors first" tax during a sustained outage like the OpenAI/Anthropic
  zero-credit situation).
- **Timeouts**: `AUTH_GATEWAY_TIMEOUT_MS` (per attempt, default 12000 — was 3000 until 2026-09-26,
  which sat below every cold auth-gateway lookup: JWT 3.2s, lano_ key 10.1s measured, so every cache
  miss became a 503) plus `AUTH_GATEWAY_BUDGET_MS` (whole resolve incl. one retry on timeout/5xx —
  never on 401/403 — default 20000, also clamped to `REQUEST_BUDGET_MS`). Auth time now counts against
  the request deadline; reasoning in `core/middleware.js`. `MEMORY_PREFETCH_TIMEOUT_MS` (default
  3000), `OLLAMA_TIMEOUT_MS` (currently 40000 — nginx's `proxy_read_timeout` on `ai.vortexcore.app` is
  60s default; keep this comfortably under that or you trade a clear router error for an opaque nginx
  502/504). Per-vendor `{VENDOR}_TIMEOUT_MS` env vars exist for each cloud adapter.
- **Fallback timeout ratio**: any vendor after the first in a chain gets `timeoutOverrideMs` = its own
  configured timeout × `VENDOR_FALLBACK_TIMEOUT_RATIO` (default 0.65) — a degraded fallback path
  shouldn't pay every vendor's full timeout on top of the primary's.
- **Rate limiting**: 120 req/min per IP, dependency-free in-memory fixed-window, in `server.js`.
  `/health` is exempt. `429` responses carry `Retry-After`.

## Security hardening (2026-08-19 audit remediation)

- Runs as dedicated non-root systemd user `onasis-ai-router` (`NoNewPrivileges=true`,
  `PrivateTmp=true`), was previously `User=root`.
- Bound to `127.0.0.1:8000` only (`BIND_HOST` env var), was previously `0.0.0.0`.
- `.env`/`.env.branded` untracked from git and gitignored — **correction, 2026-08-19**: these were
  confirmed to contain ONLY placeholder/empty secret values (verified by reading both files in full).
  No real key leak occurred; this was hygiene, not incident response. `.env.production`/`.env.keys` were
  never committed to git history (confirmed via `git log --all`) and remain deliberately gitignored —
  they're deployed disk-only via the systemd unit, never through git, matching this repo's existing
  convention (predates this session).
- `npm audit`: 0 vulnerabilities (was 8: 4 high, 4 moderate) — semver-compatible transitive bumps only,
  `package.json` unchanged.
- ~4000 lines of dead router code deleted **twice** (`core/unified-router.js`, `unified-router.cjs`,
  `multi-platform-router.js`, `vendor-auth-middleware.js`, `integrations/*.js` [pre-2026-08-19 batch],
  `api-gateway/*`) — confirmed zero references from `server.js`'s require chain both times.
  **Root cause of the resurrection, confirmed by the platform owner:** the files were re-introduced by a
  sync from the stale untracked copy at `/opt/lanonasis/shared_services/onasis_ai_router/` (the
  no-hyphen, non-git, 2026-05-23 directory described at the top of this document), then swept into an
  unrelated commit (`2cb215f` — whose own new MCP-WebSocket work under `integrations/*.js` IS
  intentional WIP by another session and was left alone) via a broad `git add`. So this was a
  stale-source sync problem, not something actively regenerating the files. **Deleting that stale
  directory (open item 4 below) removes the source and prevents a third recurrence** — do that rather
  than deleting these files a third time.

## Known open items (not yet resolved, tracked or flagged, not silently forgotten)

1. **`DEFAULT_AI_ROUTER_URL` branding — COSMETIC ONLY, nothing is broken.**
   `https://ai.vortexcore.app` **is the correct, active, production endpoint** for this router and has
   been working all along — it's what `repl-cli` uses, what every test in this document uses, and what
   nginx proxies to `127.0.0.1:8000`. Do not "fix" it. The only open question is cosmetic: this router
   is shared/multi-tenant, not VortexCore-specific, so a memory-focused CLI pointing at a
   finance-app-branded hostname reads oddly. Adding a `lanonasis.com`-branded alias would need new DNS +
   cert + nginx vhost (`mcp.lanonasis.com` serves a different service; nothing else currently proxies to
   port 8000). That's an optional infra nicety for the platform owner, NOT a defect — and any alias must
   be added alongside `ai.vortexcore.app`, never as a replacement, or every existing client breaks.
2. **OpenClaw health check lies during exactly the outage it exists to detect** (reachability-only, no
   auth check) — see OpenClaw section above.
3. **Internal OpenClaw config filenames** can surface under sustained adversarial identity probing — see
   persona-leak section above. Deliberately not chased further; extend `sanitizePersonaLeaks` if it
   becomes a real problem.
4. **`/opt/lanonasis/shared_services/onasis_ai_router/`** (stale, non-git, 2026-05-23) is unreferenced
   dead weight on disk. Not deleted — flagged for the owner to confirm before removal, same posture as
   item 4 in the dead-code section above.
5. **Concierge wiring is designed but not yet built.** See next section.

## Concierge wiring (IDE extension, Slack, Discord) — status as of 2026-08-19

Tracked on Hermes kanban board `concierge-ai-wiring` (`hermes kanban boards switch concierge-ai-wiring`):
- `t_7017dd1e` — vendor chain reliability prerequisite — **done**, this document supersedes its comments
  as the canonical record.
- `t_e3b6b1b7` — wire the VS Code/Cursor/Windsurf sidebar chat box (`EnhancedSidebarProvider.ts`
  `handleChatQuery()` in `lan-onasis-monorepo`, `IDE-EXTENSIONS/vscode-extension/`) to this router.
  Currently does pure `memoryService.searchMemories()` + hardcoded string templating — **zero LLM call**.
  Ready for implementation; card body has full detail, corrected against this doc's response contract.
- `t_30ca049a` — same gap, `apps/slack-memory-concierge` + `apps/discord-memory-concierge` in
  `lan-onasis-monorepo`, both delegate to the shared `vortexai-l0` package's `L0Orchestrator` →
  `concierge-executor.ts`, which — per its own header comment — "leaves LLM/agent orchestration to L0"
  but nothing upstream ever adds that step. One fix in `concierge-executor.ts` covers both platforms.

Both should call `POST /api/v1/ai-chat` with `use_case: "memory-analysis"`, `X-API-Key` auth (reuse
each surface's existing credential storage, don't build a second one), and read `data.response` — see
the Response Contract section above. `repl-cli`'s `ai-router-client.ts` is the proven reference
implementation; match its pattern rather than inventing per-surface variants.

## Reviewing logs — is an endpoint failing?

The service logs structured JSON to journald, one object per line. `scripts/router-logs.js` aggregates
the lines that indicate a problem so you don't have to read them raw:

```bash
node scripts/router-logs.js                  # last hour, human-readable summary
node scripts/router-logs.js --since 24h      # any systemd time spec
node scripts/router-logs.js --tail           # follow live, decoded
node scripts/router-logs.js --json           # machine-readable (cron/monitoring)
```

It reports request counts, latency p50/p95/max, per-vendor failure counts with a **classified cause**
(`OUT OF CREDIT` / `AUTH-CREDENTIAL` / `TIMEOUT` / `MODEL-ROUTE NOT FOUND` / `RATE LIMITED` /
`UNREACHABLE`), circuit-breaker trips, chain-exhaustion events, and suppressed tool-call leaks. It ends
with a verdict and sets an exit code so it can back an alert:

| verdict | exit | meaning |
|---|---|---|
| HEALTHY | 0 | no vendor failures |
| DEGRADED | 1 | vendors failing, fallbacks absorbing it, users still served |
| FAILING | 2 | chain exhausted — users are getting 500s, needs attention now |

The distinction that matters: **DEGRADED is normal** on this platform (Ollama times out, cloud vendors
run out of credit) and the fallback chain hides it from users. Only FAILING means someone must act.

Raw access when you need the underlying lines:
```bash
journalctl -u onasis-ai-router.service --since "1 hour ago" | grep -E "Vendor failed|circuit open|All vendors"
```

## How to verify a change to this service

1. `node --check` every file you touched.
2. `systemctl restart onasis-ai-router.service && sleep 3 && systemctl is-active onasis-ai-router.service`
3. `command curl -sS http://127.0.0.1:8000/health` (use `command curl`, not `curl` — see Commands above)
4. Sweep all 8 use cases with a real request each, check status/latency/persona:
   ```bash
   for UC in landing-guide ask-ai dashboard-assistant support-chat content-generation code-assist memory-analysis repl-nlp; do
     command curl -sS --max-time 75 http://127.0.0.1:8000/api/v1/ai-chat \
       -H "X-API-Key: <real lano_* key>" -H "Content-Type: application/json" \
       -d "{\"use_case\":\"$UC\",\"messages\":[{\"role\":\"user\",\"content\":\"who are you? be specific\"}]}" \
       -o /tmp/uc.json -w "$UC %{http_code} %{time_total}s\n"
     command grep -io "vortexcore\|digital banker\|financial insights\|/root/\|/home/" /tmp/uc.json && echo "  LEAK DETECTED" || true
   done
   ```
   Use an **identity probe**, not a bare "hello" — persona leaks in this service have repeatedly been
   invisible on casual greetings and only surfaced under direct questioning.
5. `journalctl -u onasis-ai-router.service --since "2 min ago"` — check for `"Vendor failed"`,
   `"Vendor circuit open"`, `"This operation was aborted"` (timeout), or the tool-call-leak warning.
