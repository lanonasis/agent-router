# Vendor configuration

Which vendor answers a request, and which vendors are in play at all, are
operational decisions. They change when a provider runs out of credit, when an
upstream token expires, or when one turns out to be wrong for a particular lane.
None of that should require editing code and redeploying a live router.

Everything below is an **override**. Unset means the code default applies; the
defaults in `vendors/index.js` remain the source of truth.

Changes take effect on restart:

```bash
export $(grep DOTENV_PRIVATE_KEY_PRODUCTION /opt/lanonasis/shared_services/onasis-agent-haven/services/onasis-ai-router/.env.keys | xargs)
systemctl restart onasis-ai-router
curl -s localhost:8000/health | jq '.status, .vendors_healthy'
```

---

## Vendor order

The order vendors are tried in, most preferred first. Comma-separated.

| Variable | Scope |
|---|---|
| `AI_VENDOR_ORDER_<USE_CASE>` | One lane. Beats the global. |
| `AI_VENDOR_ORDER` | Every lane without its own key. |

The use-case suffix is the lane name upper-cased with non-alphanumerics turned
into underscores: `repl-nlp` → `AI_VENDOR_ORDER_REPL_NLP`, `dashboard-assistant`
→ `AI_VENDOR_ORDER_DASHBOARD_ASSISTANT`.

```bash
# Prefer the local model on the coding lane only
AI_VENDOR_ORDER_CODE_ASSIST=ollama,minimax,openclaw
```

Unknown vendor ids are dropped and logged rather than failing the request — a
typo in an env var must not take the router down. If an override matches no
known vendor at all it falls back to the built-in order, because an empty chain
is a mistake rather than an instruction to serve nothing.

**Ordering does not enable.** A vendor named here is still skipped unless its
status is active (see below) and it supports the lane.

**Native-tool lanes.** A lane that declares `requiresNativeTools` (currently
`tool-proxy`, the caller-executed tool lane) additionally skips every vendor
that does not declare `supportsNativeTools: true`. That flag is a protocol
fact, not a quality judgement: pi is `false` because its adapter passes
`--no-tools` unconditionally. An override that names a non-tool vendor for such
a lane fails lane validation at boot rather than serving a request whose tools
the model never sees.

## Enabling and disabling vendors

| Variable | Effect |
|---|---|
| `AI_VENDOR_DISABLED` | Take vendors out of every chain. |
| `AI_VENDOR_ENABLED` | Promote a `stub` vendor to active. |

```bash
# An expired upstream token — stop paying its timeout until it is fixed
AI_VENDOR_DISABLED=openclaw
```

Disable wins over enable. Naming a vendor in both is contradictory, and the safe
reading of a contradiction is the one that serves less traffic.

`supabase-edge` **cannot** be enabled this way. It targets VortexCore's own AI
router — one of this router's consuming applications, so enabling it creates a
cycle — and it hardcodes a product persona as the first system message that no
caller payload can override. A config flag is exactly the wrong way to
reintroduce either; the attempt is refused and logged.

## Models

Each vendor resolves a fast and a quality model. An unset **or empty** variable
falls through to the next candidate, so a blank line in `.env` cannot become the
model name.

| Vendor | Fast | Quality |
|---|---|---|
| minimax | `MINIMAX_FAST_MODEL` | `MINIMAX_QUALITY_MODEL` |
| openai | `OPENAI_FAST_MODEL` | `OPENAI_QUALITY_MODEL` |
| anthropic | `ANTHROPIC_FAST_MODEL` | `ANTHROPIC_QUALITY_MODEL` |
| deepseek | `DEEPSEEK_FAST_MODEL` | `DEEPSEEK_QUALITY_MODEL` |
| hermes | `HERMES_FAST_MODEL` | `HERMES_QUALITY_MODEL` |

Ollama resolves per lane, with fallbacks between them:
`OLLAMA_LANA_MODEL`, `OLLAMA_MIRA_MODEL`, `OLLAMA_CODA_MODEL`,
`OLLAMA_FAST_MODEL`, `OLLAMA_QUALITY_MODEL`, `OLLAMA_GENERAL_MODEL`,
`OLLAMA_MODEL`.

> Lane names are not model names. `OLLAMA_MODEL=coda` sets a **lane**;
> `resolveOllamaModel()` maps every lane onto an installed model. Check
> `ollama list` before assuming a name resolves.

`openclaw` reports `auto` because it routes to an agent rather than a model —
see `USE_CASE_AGENT` in `vendors/openclaw/adapter.js`.

## Endpoints

Every adapter takes its base URL from the environment, so a vendor can be
pointed at a proxy, a regional endpoint, or a local mock without a code change.

| Vendor | Variable | Default |
|---|---|---|
| minimax | `MINIMAX_BASE_URL` | `https://api.minimax.io/v1` |
| openai | `OPENAI_BASE_URL` | `https://api.openai.com/v1` |
| anthropic | `ANTHROPIC_BASE_URL` | `https://api.anthropic.com/v1` |
| deepseek | `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| ollama | `OLLAMA_BASE_URL` | `http://localhost:11434` |
| openclaw | `OPENCLAW_BASE_URL` | `http://127.0.0.1:18789` |
| hermes | `HERMES_BASE_URL` | `http://100.107.32.45:8642` |

`pi` has no base URL — it is a local CLI, not an HTTP endpoint. Its knobs are:

| Variable | Default | Meaning |
|---|---|---|
| `PI_BIN` | `pi` | Path to the executable. |
| `PI_PROVIDER` | `minimax` | Provider Pi routes to. Never left to Pi's own default. |
| `PI_MODEL` / `PI_FAST_MODEL` / `PI_QUALITY_MODEL` | `MiniMax-M3` | Model passed explicitly. |
| `PI_THINKING` | `off` | `off, minimal, low, medium, high, xhigh, max`. |
| `PI_TIMEOUT_MS` | `30000` | Per-call ceiling. |

## Output token ceilings

| Variable | Scope |
|---|---|
| `AI_MAX_TOKENS_<USE_CASE>` | One lane, e.g. `AI_MAX_TOKENS_ASK_AI`. Beats the global. |
| `AI_MAX_TOKENS` | Every lane without its own key. |

A non-numeric or non-positive value is ignored with a warning rather than
applied — `AI_MAX_TOKENS=0` must not silently reduce every answer to nothing.

**A ceiling does not shorten an answer, it truncates one.** Set it too low and
replies come back cut mid-word, with nothing in the response body to say
anything is missing. Two things guard against that now:

- `onasis_metadata.truncated: true` appears when the vendor stopped at the
  ceiling. Absent means complete, which is the common case.
- A warning is logged with the lane and its ceiling, so the cause is actionable
  rather than a mystery.

Reasoning models make this sharper than it looks. MiniMax-M3 counts
`completion_tokens_details.reasoning_tokens` against `max_tokens` without ever
putting them in the content, and against this router's full system prompt it
reasons heavily — one measured reply spent roughly 720 of 800 tokens thinking
and returned 321 characters of prose. Budget for the thinking, not just the
answer, and set the number from measurement rather than from how long the reply
ought to be.

Measured defaults (2026-09-04): `ask-ai` 1500 — at that ceiling five sampled
replies finished on their own at 322/450/625/976/620 completion tokens. 800 was
tried first and three of five were still cut.

## Timeouts and budgets

| Variable | Default | Meaning |
|---|---|---|
| `<VENDOR>_TIMEOUT_MS` | `30000` | Per-call ceiling, e.g. `MINIMAX_TIMEOUT_MS` |
| `REQUEST_BUDGET_MS` | `55000` | Whole-request wall clock. Keep it under the caller's proxy timeout. |
| `MIN_VENDOR_ATTEMPT_MS` | `2000` | Below this, no further attempt is started — leaving time to return a real error. |
| `VENDOR_FALLBACK_TIMEOUT_RATIO` | `0.65` | Fraction of its own timeout a non-primary vendor gets. |
| `SYNTHESIS_MIN_TIMEOUT_MS` | `8000` | Floor for the synthesis pass. |
| `OUTAGE_RETRY_AFTER_SECONDS` | `30` | `Retry-After` on vendor and auth outages. |

## Circuit breaker

| Variable | Default |
|---|---|
| `VENDOR_CIRCUIT_THRESHOLD` | `3` |
| `VENDOR_CIRCUIT_COOLDOWN_MS` | `30000` |
| `VENDOR_CIRCUIT_COOLDOWN_CAP_MS` | `300000` |
| `VENDOR_BILLING_COOLDOWN_MS` | `3600000` |
| `VENDOR_AUTH_COOLDOWN_MS` | `3600000` |
| `VENDOR_TAIL_DEMOTE_MS` | `15000` |

Billing and auth failures open on the first occurrence: an empty account will
not refill, and a rejected key will not start working, inside one request.

## Health probes

| Variable | Default |
|---|---|
| `VENDOR_HEALTH_TTL_MS` | `60000` |
| `VENDOR_HEALTH_PROBE_TIMEOUT_MS` | `20000` |
| `VENDOR_HEALTH_PROBE_MAX_TOKENS` | `64` |

Probes issue a real minimal completion rather than a reachability ping. Do not
lower `VENDOR_HEALTH_PROBE_MAX_TOKENS` below the point where a reasoning model
can finish a turn — at 16, MiniMax returned `incomplete_turn` while serving real
traffic, and a probe that fails a working vendor breaks trust as badly as one
that passes a broken one.

---

## Why Pi leads the conversational lanes

`pi` is the only vendor here that is a local process rather than an HTTP
endpoint. It exists for one reason: **a single spelling for controls each vendor
names differently, or not at all.**

The truncation incident is the case in point. MiniMax-M3 counts reasoning tokens
against `max_tokens` without putting them in the content, so an `ask-ai` reply
spent roughly 720 of 800 tokens thinking and returned 321 characters, cut
mid-word. Through Pi with `--thinking off`, the router states its intent once and
Pi maps it per provider. Measured on `ask-ai`, four requests each:

| | mean latency | completion tokens | truncated |
|---|---|---|---|
| pi first | **4.1s** | 178–659 | none |
| minimax first | 25.6s | 583–1222 | none |

Six concurrent calls all succeeded in 3.3s, so the process-per-request shape
holds under load.

Pi leads `ask-ai`, `repl-nlp`, `dashboard-assistant`, `support-chat` and
`landing-guide`. The analytical lanes — `code-assist`, `content-generation`,
`memory-analysis` — keep minimax first, because reasoning may well earn its cost
there and that has not been measured.

### What the adapter locks down, and why

Pi ships read, bash, edit and write tools, and runs as the router on the
router's host. Several flags are load-bearing rather than tidy:

- **`--no-tools`, unconditionally.** A vendor that can run bash here is not a
  vendor, it is a remote shell. The router's own tool loop, against an
  allowlist, is the only tool path this service has. It cannot be re-enabled
  from a request.
- **Provider and model always explicit.** Pi's configured default on this host
  is `hetz` at thinking level `high` — the credential that has been returning
  401, and the thinking level that caused the truncation. A call that cannot
  name both is refused rather than falling through to it.
- **`--no-extensions --no-skills --no-prompt-templates`.** A bare `pi -p` took
  **89 seconds** and returned nothing, loading the full extension stack per
  invocation. With these it takes ~1.6s. It is also third-party code executing
  inside a request path.
- **`--no-context-files`,** plus a throwaway working directory. Pi otherwise
  discovers `AGENTS.md` and `CLAUDE.md` from its cwd, and this router's own repo
  instructions have no business shaping a caller's answer.
- **`--no-session`,** matching the router's stateless contract.
- **Prompt on stdin, args as an array, `shell: false`.** Nothing the caller sends
  reaches a shell.
- **`HOME` redirected** to that same throwaway directory. Pi writes a credential
  store under `$HOME/.pi`; the router's service user has no home, so the
  inherited `HOME` failed every call with `EACCES ... mkdir`. It also means Pi
  never reads whatever sits in the invoking user's `~/.pi` — the API key comes
  from the inherited environment instead, which keeps it out of argv and
  therefore out of `ps`.

Pi takes a single prompt rather than a conversation, so multi-turn history is
flattened with role labels. That is a real fidelity loss against the HTTP
adapters and the reason Pi is not a drop-in replacement for them.

## Why minimax leads

Measured 2026-09-04. `repl-nlp` previously led with `ollama`; the local 3B CPU
model decides to call a tool well enough and reads a long tool result back
poorly, so the synthesis pass timed out and every REPL search degraded to a raw
record dump — 57.7s for an answer nobody wanted. With minimax first the same
query returns clean prose in 20.0s, and `ask-ai` went from 26.4s to 9.4s.

Ollama stays in every chain as the free last resort. It is the vendor that keeps
answering when the paid ones are out of credit — just not the one that should
answer first.
