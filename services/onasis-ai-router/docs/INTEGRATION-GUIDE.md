# Onasis AI Router — Integration Guide

**Audience:** an engineer or coding agent adding branded AI interaction to an Onasis platform application.
**Status:** authoritative. Verified live 2026-08-19 against the running service.

Read this end-to-end before writing code. It is written to be dropped into any project as the single
reference, so a fresh agent with no prior context can integrate correctly without guessing.

---

## 0. Rules of engagement — read first

**You are a CONSUMER of this router. You do not modify it.**

| | |
|---|---|
| ✅ **DO** | Write client code inside YOUR application that calls the HTTP API described below. |
| ❌ **DO NOT** | Edit anything under `services/onasis-ai-router/` — adapters, `vendors/index.js`, prompts, `USE_CASES`. |
| ❌ **DO NOT** | Add a new `use_case`, vendor, or model "for your app". The existing use cases cover every integration; adding one is a router-team change with fallback/prompt/cost implications. |
| ❌ **DO NOT** | Call OpenAI/Anthropic/MiniMax/Ollama/OpenClaw directly from your app. The whole point of the router is that vendor choice, failover, cost, and branding are decided in one place. Bypassing it re-creates the exact fragmentation this router was built to remove. |
| ❌ **DO NOT** | Invent endpoints, fields, or parameters. If something you need isn't in this document, it does not exist — ask the router owner rather than guessing. Several integrations have already been written against a hallucinated `{message:{content}}` response shape that has never existed. |

**Anti-hallucination checklist.** Before you write a single line, confirm each of these against §2/§3, not
from memory or from another codebase's pattern:

- [ ] Endpoint path is `/api/v1/ai-chat` (not `/v1/chat/completions`, not `/api/v1/completions`)
- [ ] Response field is `data.response` (NOT `data.message.content`, NOT `data.choices[0].message.content`)
- [ ] A `lano_*` key goes in the `X-API-Key` header (NOT `Authorization: Bearer`)
- [ ] You picked a `use_case` from the fixed list in §4 — you did not invent one
- [ ] You are not sending `model`, `vendor`, `provider`, or `temperature` — the router owns those

If you're unsure whether something is real, the fastest ground truth is one `curl` (§9) against the live
service. Do that instead of assuming.

---

## 1. What this is

`onasis-ai-router` is the shared, multi-tenant AI gateway for the Onasis platform. Every branded AI
interaction — chat boxes, assistants, concierges, summarisers — goes through it.

Your app sends **a use case and messages**. The router decides the vendor, the model, the system prompt,
the fallback chain when a vendor is down, and strips vendor identity from the response so everything
speaks as Onasis. You never see or choose a model.

```
your app ──POST /api/v1/ai-chat──►  onasis-ai-router  ──► openclaw / minimax / openai / anthropic / ollama
   (use_case + messages)                    │                       (chosen + failed over internally)
                                            └──► memory.search / memory.get tools (automatic)
◄────────── { response, onasis_metadata } ──┘
```

**Base URL:** `https://ai.vortexcore.app`

That hostname is correct and current, despite the VortexCore branding — the router is shared
infrastructure that happens to be reachable on that vhost, and it serves every Onasis product. Do not
"correct" it to something that sounds more on-brand; no other hostname routes to this service.
Configure it as an env var (`AI_ROUTER_URL`) rather than hardcoding, so a future alias is a config change.

---

## 2. The contract

### Request

```
POST https://ai.vortexcore.app/api/v1/ai-chat
X-API-Key: lano_...                    # or: Authorization: Bearer <jwt/oauth token>
Content-Type: application/json

{
  "use_case": "ask-ai",
  "messages": [
    { "role": "user", "content": "How do I rotate my API key?" }
  ]
}
```

| field | required | notes |
|---|---|---|
| `use_case` | recommended | One of §4. Omitted → defaults to `ask-ai`. An unrecognised value silently falls back to `ask-ai` rather than erroring — so a typo fails quietly, double-check it. |
| `messages` | yes | `[{role, content}]`, roles `user`/`assistant`. Include prior turns for multi-turn context — the router is stateless and does not remember your conversation. |
| `tools` | no | Only if you need to override the default tool set. Omit it — see §6. |

`use_case` may also be sent as the `X-Use-Case` header. Body wins if both are present.

**A caller-supplied `system` (or `developer`) message is rejected — HTTP 400, not ignored.**

```json
{"error":{"message":"The 'system' role is not accepted here — system instruction is owned by the service.",
          "code":"system_role_not_permitted","param":"messages[0]"}}
```

This is the single most common integration mistake, because "the router owns the system prompt"
reads as *your system message is redundant* rather than *your request will fail*. It is the latter.
The check runs before any other work, so the request costs nothing — but it never reaches a model.

If you have instructions to apply, they belong in a **use case** (§4) or a provisioned **profile**
(§2.1), never in the message array. Send only `user`, `assistant`, and approved `tool` turns.

**Do not send** `model`, `provider`, `vendor`, `temperature`, or `max_tokens`. The router sets these per
use case. They are ignored, and passing them signals a misunderstanding of the abstraction.

### 2.1 Profiles — `X-Onasis-Profile`

A use case selects a lane. A **profile** selects a reviewed agent identity: role template, policy
documents, permitted tools, memory mode, and limits, frozen per deployed version. Profiles are
provisioned server-side in Agent Heaven; there is no way to define one from a request.

```
X-Onasis-Profile: l0-concierge          # profile intent
X-Onasis-Application: l0-concierge      # optional; may only narrow to the profile's own application
```

Entitlement is resolved from your credential's UAI, never from the header — naming a profile you are
not entitled to fails. Ask the platform team to entitle your credential; you cannot self-serve it.

| status | `error.code` | meaning |
|---|---|---|
| 400 | `profile_not_found` | No manifest with that id is loaded |
| 400 | `profile_required` | You sent `X-Onasis-Application` without `X-Onasis-Profile` |
| 403 | `profile_not_active` | The manifest exists but its status is not `active` |
| 403 | `profile_not_entitled` | Your credential's UAI does not grant this profile |
| 403 | `profile_application_mismatch` | The named application is not the profile's own |
| 403 | `entitlements_unavailable` | Auth gateway returned no entitlement data at all |

Omit both headers and you get the use-case path, which is what every caller should do until a profile
has been provisioned for them.

### Response — 200

```json
{
  "response": "You can rotate your key from the dashboard under Settings → API Keys.",
  "actions": [],
  "usage": { "prompt_tokens": 1004, "completion_tokens": 44, "total_tokens": 1048 },
  "onasis_metadata": {
    "service": "ai-chat",
    "user_auth_id": "b0f23242-...",
    "processing_time": 3728,
    "powered_by": "Onasis-CORE Partnership Platform",
    "partner_api_version": "2.0.0",
    "timestamp": "2026-08-19T23:00:00.000Z"
  }
}
```

**The answer is `data.response`.** A plain string, already cleaned (vendor names, model identifiers,
internal paths, and reasoning-token blocks are stripped server-side).

`actions` is usually `[]`. When present it carries UI hints like
`{type:'open_memory', memory_id:'...'}` — render them if your surface can, ignore them otherwise.

### Errors

| status | body `error.code` | what it means | what you should do |
|---|---|---|---|
| 400 | `system_role_not_permitted` | You sent a `system`/`developer` message | Remove it. Use a use case or profile instead. Never retry as-is. |
| 400 / 403 | `profile_*` | Profile intent could not be honoured — see §2.1 | Don't retry. Fix the header or get the credential entitled. |
| 401 | `AUTH_REQUIRED` | Key/token missing, invalid, or wrong header | Don't retry. Surface a sign-in/config prompt. |
| 429 | `RATE_LIMIT_EXCEEDED` | >120 req/min from your IP | Honour the `Retry-After` header. Never hot-loop. |
| 500 | `AI_SERVICE_ERROR` | Every vendor in the chain failed | Show a friendly failure or your local fallback (§7). Safe to retry once after a short delay. |
| 503 | `AUTH_SERVICE_UNAVAILABLE` | Auth gateway unreachable | Transient. Retry once with backoff. |
| 504 | *(nginx HTML, not JSON)* | Request exceeded the 60s proxy timeout | Treat as a timeout. Your client timeout should be < 60s so you fail first with a clean error. |

Error bodies are deliberately generic — upstream vendor detail is logged server-side, never returned.
Do not try to parse vendor specifics out of them.

---

## 3. Authentication

Two mutually exclusive schemes. Pick by credential type — **they are not interchangeable**:

```
lano_* API key           →  X-API-Key: lano_...
Supabase JWT / OAuth     →  Authorization: Bearer <token>
```

Sending a `lano_*` key as `Authorization: Bearer` **will fail** — the auth gateway resolves these on
different code paths.

**Where the key comes from:** reuse whatever credential storage your app already has. Do not build a
second credential system, and do not prompt the user for a key you already hold elsewhere.

### ⚠️ Browser/mobile apps: never ship the key to the client

A `lano_*` key is a **server-side secret**. It grants access to the user's memory bank. If your app is a
browser SPA (React/Vue/Svelte) or a mobile client, calling this API directly from the client would ship
the key to every user — anyone can read it out of network inspector or the bundle.

**Correct pattern for browser apps** — proxy through your own backend:

```
browser ──► your backend route (holds the key, checks YOUR session) ──► ai.vortexcore.app
```

```ts
// server-side route in YOUR app (Next.js route handler / Express handler / etc.)
export async function POST(req: Request) {
  const session = await getSession(req);            // YOUR auth — reject anonymous callers
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { query } = await req.json();

  const r = await fetch(`${process.env.AI_ROUTER_URL}/api/v1/ai-chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.LANONASIS_API_KEY!,  // server env only — never NEXT_PUBLIC_*
    },
    body: JSON.stringify({ use_case: 'ask-ai', messages: [{ role: 'user', content: query }] }),
  });

  const data = await r.json();
  return Response.json({ answer: data.response });  // return ONLY what the UI needs
}
```

Never put the key in `NEXT_PUBLIC_*`, `VITE_*`, `REACT_APP_*`, or any client-bundled variable. Those are
compiled into the JavaScript your users download.

### ⚠️ One server key = one identity for all your users

The proxy above is correct about secrecy and **wrong about identity** if your users have personal
memory. A `lano_*` key resolves to *the key's owner*, not to whoever is talking to your app. Route
every user through one server-side key and the router sees a single caller: they share one memory
bank, one org, and one cache identity.

This is not theoretical. The router prefetches a memory brief on the normal chat path and caches it
per authenticated identity. Same identity + same question inside the TTL = same brief. That is
correct behaviour for one user and a data leak between two.

**If your users are authenticated and have personal memory**, forward *their* credential — do not
substitute your own:

```ts
const userToken = req.headers.get('authorization');   // the user's access token, passed by your client
if (!userToken) return new Response('Unauthorized', { status: 401 });

const r = await fetch(`${process.env.AI_ROUTER_URL}/api/v1/ai-chat`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: userToken,      // Bearer <user access token> — NOT your server key
  },
  body: JSON.stringify({ use_case: 'ask-ai', messages: [{ role: 'user', content: query }] }),
});
```

**Never send both `Authorization` and `X-API-Key`.** They resolve on different code paths in the auth
gateway; sending both means you do not control which identity you get.

**If your users are anonymous** (a landing-page or marketing chat), a shared server key is fine —
but then treat it as a shared identity on purpose:

- use `landing-guide` or `ask-ai`, never a personal-memory use case;
- enforce rate and volume limits **server-side** — a client-side message cap is bypassable by anyone
  with devtools;
- do not present the answers as personalised.

**Where the token lives matters.** If your client stores its session in `localStorage` (the Supabase
JS default), your server route **cannot** read it from cookies — the browser must send it explicitly.
Decide this before writing the proxy; it is the most common reason a proxy silently falls back to the
server key.

---

## 3b. OpenAI-compatible endpoint (`/v1`)

**Use the native contract above unless your client can only speak OpenAI.** The
`/v1` surface exists for harnesses with no adapter layer — Pi, IDE extensions,
LangChain/LlamaIndex, anything built on the OpenAI SDKs. It is a translation
layer over the same router: identical routing, fallback, memory tools and
vendor policy.

```
GET  /v1/models            -> { "object": "list", "data": [ ... one model ... ] }
GET  /v1/models/{model}
POST /v1/chat/completions  -> a standard chat.completion object
```

**One model, and it is not the real one.** Callers see `lzero`, `owned_by:
"Onasis"`. `Vortex-L0` and `L0` are accepted aliases (case-insensitive). Any
other model id is a `404 model_not_found` — the endpoint will never silently
serve you something other than what you asked for. The actual vendor and model
behind it are deliberately never disclosed.

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey:  process.env.LANONASIS_API_KEY,       // a lano_ key, server-side only
  baseURL: 'https://ai.vortexcore.app/v1',
});

const r = await client.chat.completions.create({
  model: 'lzero',
  messages: [{ role: 'user', content: 'Hello' }],
});
console.log(r.choices[0].message.content);
```

**Authentication.** This endpoint accepts the OpenAI convention —
`Authorization: Bearer <lano_ key>` — and normalises it internally. This is the
one place that translation happens; on the native `/api/v1/ai-chat` path a
`lano_` key must still be sent as `X-API-Key`. An `lms_` key is rejected here
with a specific message: it is scoped to the memory API and cannot authenticate
to the router.

**Streaming is not supported yet.** `"stream": true` returns
`400 stream_unsupported` rather than quietly sending a buffered response — a
silent non-stream looks like a hang to a streaming client. See
`docs/superpowers/specs/2026-08-27-streaming-and-identity-notes.md`.

**Choosing a lane.** Requests default to the `dashboard-assistant` lane. To pick
another, send the `X-Use-Case` header (same values as §4).

**Cost note.** The router injects a memory brief on the normal chat path, so
`prompt_tokens` is substantially larger than the messages you sent — ~19k for a
one-line prompt is normal. Budget for it, and do not use `prompt_tokens` to
estimate your own payload size.

---

## 4. Choosing a use case

Fixed list. Pick the closest — do not invent one.

| use_case | for | latency profile |
|---|---|---|
| `ask-ai` | Quick "Ask AI" buttons, one-shot Q&A | fast (cloud-first) |
| `landing-guide` | Onboarding/marketing page guides | fast |
| `dashboard-assistant` | Full in-product assistant panels | fast |
| `support-chat` | Help desk / customer support conversations | fast |
| `memory-analysis` | Memory concierge — "what do I know about X", context recall | fast |
| `content-generation` | Marketing copy, summaries, long-form | slower (local-first) |
| `code-assist` | Developer/technical assistance | slower (local-first) |
| `repl-nlp` | CLI/REPL natural-language command interpretation | slower (local-first) |

**Latency profile matters.** The five "fast" lanes are cloud-first and typically answer in **3–8s**. The
three "slower" lanes deliberately try free local inference first and can take **15–60s** — correct for
batch work, wrong for a chat box someone is watching.

**Rule of thumb:** if a human is waiting on a spinner, use a fast lane. For an interactive assistant or
concierge, `memory-analysis` (memory-aware) or `dashboard-assistant` (general) are the right defaults.

---

## 5. Reference implementations

### TypeScript / JavaScript (ESM)

```ts
// ai-router-client.ts — drop-in, no dependencies
export interface AiRouterResponse {
  response: string;
  actions?: Array<Record<string, unknown>>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  onasis_metadata?: Record<string, unknown>;
}

export interface AskOptions {
  useCase?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const BASE_URL = process.env.AI_ROUTER_URL ?? 'https://ai.vortexcore.app';
const API_KEY  = process.env.LANONASIS_API_KEY ?? '';

export class AiRouterError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly retryAfter?: number) {
    super(message);
    this.name = 'AiRouterError';
  }
}

export async function ask(query: string, opts: AskOptions = {}): Promise<string> {
  if (!API_KEY) throw new AiRouterError('LANONASIS_API_KEY is not configured', 0);

  // Client timeout stays under nginx's 60s proxy cap so we fail with a clean
  // error rather than receiving an opaque HTML 504.
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true });

  try {
    const res = await fetch(`${BASE_URL}/api/v1/ai-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({
        use_case: opts.useCase ?? 'ask-ai',
        messages: [...(opts.history ?? []), { role: 'user', content: query }],
      }),
      signal: ac.signal,
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? 60);
      throw new AiRouterError('Rate limited', 429, 'RATE_LIMIT_EXCEEDED', retryAfter);
    }
    if (!res.ok) {
      // 504s come back as nginx HTML, not JSON — don't assume a parseable body.
      const body = await res.json().catch(() => null);
      throw new AiRouterError(
        body?.error?.message ?? `AI router returned ${res.status}`,
        res.status,
        body?.error?.code,
      );
    }

    const data = (await res.json()) as AiRouterResponse;
    return data.response ?? '';           // <-- data.response, NOT data.message.content
  } finally {
    clearTimeout(timer);
  }
}
```

Usage:

```ts
try {
  const answer = await ask('What did we decide about the billing migration?', {
    useCase: 'memory-analysis',
  });
  render(answer);
} catch (err) {
  if (err instanceof AiRouterError && err.status === 429) {
    render(`Busy right now — try again in ${err.retryAfter}s.`);
  } else {
    render(localFallback());          // see §7 — never leave the surface silent
  }
}
```

### CommonJS

Identical logic; swap the module syntax:

```js
const BASE_URL = process.env.AI_ROUTER_URL || 'https://ai.vortexcore.app';
const API_KEY = process.env.LANONASIS_API_KEY || '';

async function ask(query, { useCase = 'ask-ai', history = [], timeoutMs = 45000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/api/v1/ai-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ use_case: useCase, messages: [...history, { role: 'user', content: query }] }),
      signal: ac.signal,
    });
    if (!res.ok) throw Object.assign(new Error(`AI router ${res.status}`), { status: res.status });
    const data = await res.json();
    return data.response || '';
  } finally { clearTimeout(timer); }
}

module.exports = { ask };
```

### curl (for verifying before you write code)

```bash
curl -sS https://ai.vortexcore.app/api/v1/ai-chat \
  -H "X-API-Key: $LANONASIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"use_case":"ask-ai","messages":[{"role":"user","content":"hello"}]}'
```

---

## 6. Memory tools — automatic, don't reimplement

The router automatically offers the model `memory.search` and `memory.get`, scoped to the authenticated
caller. Ask a memory-shaped question with `use_case: "memory-analysis"` and retrieval + synthesis happen
server-side in one round trip.

**Do not** search memories yourself and paste results into the prompt. That's slower, duplicates work
the router already does, and produces worse answers than letting the model drive retrieval. (Several
existing surfaces do a manual `searchMemories()` + string-template — that is the legacy pattern being
replaced, not a model to copy.)

**Writes are off by default.** `memory.write` is not offered on question-answering use cases, deliberately:
a model that free-associates a "save this" call would write to the user's real memory bank with no
confirmation. Saving should be an explicit user action in your UI calling the memory API directly, not a
side effect of a chat turn.

---

## 7. Reliability requirements for your integration

The router already fails over across five vendors internally, so a 500 means *everything* was down —
rare, but design for it.

1. **Always have a fallback path.** Never leave the surface silent or dump a raw error. Degrade to
   something useful: cached content, a plain memory-search result list, or a clear "AI is unavailable
   right now" message.
2. **Set a client timeout under 60s** (45s recommended). nginx cuts at 60s and returns HTML, not JSON —
   fail on your own terms first.
3. **Respect 429.** Honour `Retry-After`. Never retry in a tight loop; the limit is 120 req/min per IP
   and hot-looping will keep you locked out.
4. **Retry at most once**, and only for 500/503/timeout — never for 401 (config error) or 429 (backoff).
5. **Never log the API key.** Redact `X-API-Key` and `Authorization` in any request logging you add.

---

## 8. Per-project notes

Stack detected on this host 2026-08-19. Adapt if the project has changed.

| project | stack | integration shape |
|---|---|---|
| **network-sync** | ESM + TypeScript, no web framework | Use the TS client (§5) directly in a service module. Server-side, key in env — straightforward. |
| **thrift-circle** | ESM JavaScript | Use the CJS/ESM client (§5). Server-side, key in env. |
| **v-secure** | ESM + TypeScript + Express | Add a thin Express route wrapping the TS client. Given this is the security product, be strict about §7.5 (never log the key) and prefer `support-chat` or `dashboard-assistant`. |
| **the-fixer-initiative** | CJS + Express | Use the CommonJS client (§5). Note `require`, not `import`. |
| **maple-movement-hub** | ESM + TypeScript + **React/Vite (browser)** | ⚠️ **Must NOT call the router from the browser.** Vite inlines `VITE_*` env vars into the client bundle — putting the key there leaks it to every visitor. Add a small server-side proxy endpoint (§3) and have React call *that*. This is the one project here where the naive integration is a real security bug. |

---

## 9. Verify before you ship

Run these against the live service. If any fails, stop and fix before writing more code.

```bash
# 1. Service is up.
#    "healthy" = every vendor answered. "degraded" (still HTTP 200) = one or more
#    vendors are down and the router is routing around them — requests are served
#    normally, so do NOT treat this as an outage or gate your deploy on it.
#    Only HTTP 503 / "unavailable" means no vendor can answer.
curl -sS https://ai.vortexcore.app/health

# 2. Your key authenticates (401 here = wrong header or bad key, not a router problem)
curl -sS -o /dev/null -w '%{http_code}\n' https://ai.vortexcore.app/api/v1/ai-chat \
  -H "X-API-Key: $LANONASIS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"use_case":"ask-ai","messages":[{"role":"user","content":"ping"}]}'

# 3. You are reading the right field — this must print the answer, not "undefined"
curl -sS https://ai.vortexcore.app/api/v1/ai-chat \
  -H "X-API-Key: $LANONASIS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"use_case":"ask-ai","messages":[{"role":"user","content":"say hi"}]}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["response"])'
```

Integration checklist:

- [ ] Answer renders from `data.response`
- [ ] Key is server-side only (browser apps proxy through a backend)
- [ ] Exactly one auth scheme per request — never both `Authorization` and `X-API-Key`
- [ ] If users have personal memory, their own token is forwarded (a shared server key
      collapses every user into one memory identity)
- [ ] Anonymous/volume limits are enforced server-side, not in the client
- [ ] Client timeout < 60s
- [ ] 429 honours `Retry-After`
- [ ] A fallback path exists and was tested by pointing `AI_ROUTER_URL` at an unreachable host
- [ ] No secret appears in logs or client bundles
- [ ] You changed **nothing** under `services/onasis-ai-router/`

---

## 10. Something's wrong — is it you or the router?

Check the router's own health first; don't debug your client against a broken backend.

```bash
# On the router host (srv896342):
node services/onasis-ai-router/scripts/router-logs.js              # last hour, human summary
node services/onasis-ai-router/scripts/router-logs.js --since 24h  # wider window
node services/onasis-ai-router/scripts/router-logs.js --tail       # live
```

Verdict line tells you where the problem is:

- **HEALTHY** → the router is fine. The bug is in your client (wrong field, wrong header, wrong host).
- **DEGRADED** → vendors are failing but fallbacks are absorbing it; users are still served. Slower than
  usual is expected. Not your bug, usually not urgent.
- **FAILING** → chain exhausted, users are getting 500s. Router-side; escalate to the router owner.

Common causes it will name for you: `OUT OF CREDIT` (billing), `AUTH/CREDENTIAL` (re-auth a vendor),
`TIMEOUT`, `MODEL/ROUTE NOT FOUND` (config drift), `UNREACHABLE`.

For deeper detail see `services/onasis-ai-router/CLAUDE.md` — the router's own architecture doc. Read it
before proposing any change to the router itself.
