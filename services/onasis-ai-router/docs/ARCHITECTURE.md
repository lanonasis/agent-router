# Onasis AI Router — Architecture & Codemap v2

> Replaces `router_codemap.md`.
> Updated after security hardening, folder refactor, vendor abstraction layer, and Supabase fallback chain (Feb 2026).

**Live gateway:** `https://api.connectionpoint.tech`
**Deployed branch:** `railway-dev` · commit `7a88b24`
**Latest deploy ID:** `db62d221-bd24-4b65-85a9-9cf838773a6e` → ✅ SUCCESS

---

## 1. Folder Structure

```
onasis_ai_router/
│
├── server.js                     ← Express entry point, CORS, mounts router
├── package.json                  ← Node 18+ required (native fetch)
│
├── core/                         ← Request handling & orchestration
│   ├── ai-service-router.js      ← Main router class (auth, tools, fallback)
│   ├── unified-router.js         ← Supabase privacy-proxy routes
│   ├── unified-router.cjs        ← CommonJS build of unified-router
│   ├── multi-platform-router.js  ← Multi-brand hostname routing
│   └── vendor-auth-middleware.js ← API key validation middleware
│
├── vendors/                      ← Vendor abstraction layer (INTERNAL ONLY)
│   ├── index.js                  ← Registry, use-case → vendor resolution, sanitization
│   ├── ollama/
│   │   └── adapter.js            ← Primary: local Ollama adapter
│   ├── supabase-edge/
│   │   └── adapter.js            ← Fallback: Supabase edge function adapter
│   └── stubs/
│       ├── anthropic.js          ← Future: Claude (stub, not wired)
│       └── openai.js             ← Future: OpenAI (stub, not wired)
│
├── integrations/                 ← MCP / CLI tooling (not in request path)
│   ├── claude-mcp-wrapper.js
│   ├── cli-integration.js
│   ├── external-mcp-client.js
│   └── stdio-mcp-server.js
│
├── scripts/                      ← Dev setup helpers
│   ├── quick-setup.sh
│   ├── setup-ollama.sh
│   └── setup-ollama-lite.sh
│
├── docs/                         ← Documentation
│   ├── ARCHITECTURE.md           ← This file
│   ├── router_codemap.md         ← Original codemap (historical reference)
│   └── *.md                      ← Setup guides
│
└── logs/
    └── ai-router.log
```

---

## 2. End-to-End Request Flow

Clients never see vendor names, model identifiers, or internal routing decisions.

```
Client App (any platform)
    │
    │  POST /api/v1/ai/chat
    │  Headers: X-API-Key: lano_...
    │  Body:    { "messages": [...], "use_case": "ask-ai" }
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  server.js                                                   │
│  · CORS whitelist (CORS_ALLOWED_ORIGINS env)                │
│  · Mount core/ai-service-router routes                      │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  authenticateRequest middleware                              │
│  · Forwards Authorization / X-API-Key to AUTH_GATEWAY_URL  │
│  · Returns 401 if gateway rejects                           │
│  · Sets req.uai (anonymous user context) on success        │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  trackUsage middleware                                       │
│  · Logs request metadata for billing (no PII)               │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  routeToAIService → handleOllamaChat                        │
│                                                             │
│  1. resolveUseCaseFromRequest(req)                          │
│     Reads body.use_case or X-Use-Case header               │
│     Falls back to 'ask-ai' if unknown/missing               │
│                                                             │
│  2. resolveVendorChainForUseCase(useCase)                   │
│     Returns ordered vendor list: [ollama, supabase-edge]   │
│                                                             │
│  3. Memory prefetch (background, parallel with #4)          │
│     Searches memory API for relevant context                │
│                                                             │
│  4. First inference pass                                    │
│     Try ollama → on fail, try supabase-edge (fallback)      │
│     Circuit breaker skips known-dead vendors               │
│                                                             │
│  5. Tool detection                                          │
│     If AI requests tools (memory.search, code.read, etc.)  │
│     → Execute tools → second inference pass with results   │
│                                                             │
│  6. sanitizeVendorResponse()                               │
│     Strips: model, provider, engine, vendor, backend…      │
│                                                             │
│  7. addOnasisBranding()                                     │
│     Adds: onasis_metadata { service, use_case, … }         │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
                    Client receives clean,
                    vendor-agnostic JSON
```

---

## 3. Vendor Abstraction Layer (`vendors/`)

### 3a. Use-Case Registry (`vendors/index.js`)

Clients declare **intent**, not model. The registry maps intent to inference parameters:

| use_case              | maxTokens | temp | Priority | Description                      |
|-----------------------|-----------|------|----------|----------------------------------|
| `landing-guide`       | 400       | 0.7  | speed    | Onboarding guide on landing pages |
| `ask-ai`              | 350       | 0.65 | speed    | Quick "Ask AI" buttons           |
| `dashboard-assistant` | 1200      | 0.75 | quality  | Full assistant panel             |
| `support-chat`        | 800       | 0.6  | quality  | Help desk conversations          |
| `content-generation`  | 2000      | 0.85 | quality  | Marketing copy / summaries       |
| `code-assist`         | 2000      | 0.2  | quality  | Technical / developer assistance |

### 3b. Vendor Registry (`vendors/index.js` — internal only)

```
ollama (active, PRIMARY)
  └── fallbackVendor: supabase-edge

supabase-edge (active, FALLBACK)
  └── fallbackVendor: null  ← end of chain

anthropic (stub — not wired)
openai    (stub — not wired)
```

### 3c. Vendor Chain Resolution

```javascript
resolveVendorChainForUseCase('ask-ai')
// returns:
[
  { _vendorId: 'ollama',         _model: 'qwen2:1.5b', ... },
  { _vendorId: 'supabase-edge',  _model: 'auto', ...       },
]
```

The caller iterates: first success wins. Vendor identity is never returned to the client.

### 3d. Response Sanitization

Every response passes through `sanitizeVendorResponse()` before `addOnasisBranding()`.
Removed fields: `model`, `provider`, `backend`, `vendor`, `engine`, `deployment_id`,
`system_fingerprint`, `object`, `ai_service_provider`.

---

## 4. Fallback Chain & Circuit Breaker

```
Request arrives
      │
      ▼
 ┌──────────┐   healthy    ┌─────────────────────────────┐
 │  Ollama  │─────────────▶│  inference + tool loop       │
 │ (local)  │              └─────────────────────────────┘
 └──────────┘
      │ error / timeout / circuit open
      ▼
 ┌──────────────────┐        ┌──────────────────────────────────────────┐
 │  Supabase Edge   │───────▶│  POST /functions/v1/ai-chat              │
 │  (cloud relay)   │        │  Internally: OpenAI / Claude / Gemini /  │
 └──────────────────┘        │  OpenRouter — edge function decides       │
      │                      └──────────────────────────────────────────┘
      │ error
      ▼
 503 — all vendors exhausted
```

### Circuit Breaker (in-memory, per process)

| Setting                    | Default | Env var                      |
|----------------------------|---------|------------------------------|
| Failures before open       | 3       | `VENDOR_CIRCUIT_THRESHOLD`   |
| Cooldown before retry (ms) | 30 000  | `VENDOR_CIRCUIT_COOLDOWN_MS` |

After threshold consecutive failures, the vendor is skipped until the cooldown expires.
On any success, the circuit resets immediately.

### Key behaviour notes

- **Vendor is locked per request** — if Ollama handles turn 1, it handles the tool follow-up. No mid-conversation switching.
- **Tools disabled on Supabase edge** — the edge function returns a final text answer; `tool_calls` array is always `[]` in the normalised response. Tool calls only work when Ollama is primary.
- **Model selection is automatic** — `speed` vs `quality` chosen by `vendorPriority` in the use-case config.

---

## 5. Security Hardening (applied Feb 2026)

| Issue | Fix | Location |
|---|---|---|
| Command injection (`exec()`) | Replaced with `execFile()` + executable allowlist | `core/ai-service-router.js` `toolCodeRunCommand` |
| Path traversal | `_resolveRestrictedPath()` — sandbox to `CODE_BASE_DIR` | `core/ai-service-router.js` |
| Vulnerable `node-fetch ^2.7.0` | Removed entirely; uses Node 18+ native `fetch` | All files |
| Race condition in prefetch cache | `_prefetchInflight` Map coalesces concurrent fetches | `core/ai-service-router.js` `prefetchMemoryBrief` |
| Unhandled Promise rejections | `try/catch` added to all async tool handlers | `core/ai-service-router.js` |
| Missing timeout controls | `AbortController` + `clearTimeout` on all `fetch` calls | All fetch sites |
| CORS wildcard `*` | Configurable `CORS_ALLOWED_ORIGINS` env list | `server.js` |
| Vendor identity leak | `sanitizeVendorResponse()` + removed `ai_service_provider` from branding | `vendors/index.js` |
| Shell injection in `findRelated` | Regex guard + `execFile` with args array | `core/ai-service-router.js` |
| Error message leak in webhooks | Generic `'Webhook processing failed'` returned to caller | `core/unified-router.js` |

---

## 6. Environment Variables

```bash
# ── Primary Vendor: Ollama ────────────────────────────────────
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-coder:6.7b           # default model
OLLAMA_FAST_MODEL=qwen2:1.5b               # speed-priority use cases
OLLAMA_QUALITY_MODEL=deepseek-coder:6.7b   # quality-priority use cases
OLLAMA_TOOL_MODEL=qwen2:1.5b               # used for summarizing tool payloads

# ── Fallback Vendor: Supabase Edge ───────────────────────────
SUPABASE_URL=https://mxtsdgkwzjzlttpotole.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_EDGE_CHAT_PATH=/functions/v1/ai-chat
SUPABASE_EDGE_TIMEOUT_MS=30000

# ── Circuit Breaker ───────────────────────────────────────────
VENDOR_CIRCUIT_THRESHOLD=3        # failures before bypassing vendor
VENDOR_CIRCUIT_COOLDOWN_MS=30000  # ms before retrying a failed vendor

# ── Auth & Services ───────────────────────────────────────────
AUTH_GATEWAY_URL=http://localhost:4000
API_BASE_URL=https://api.lanonasis.com
CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# ── Memory ────────────────────────────────────────────────────
MEMORY_PREFETCH_ENABLED=true
MEMORY_API_KEY=lano_your_key_here
```

---

## 7. Live Endpoint Reference

**Base URL:** `https://api.connectionpoint.tech`

### Health Check

```bash
GET /health
# No auth required
# Response: 200
{
  "status": "healthy",
  "uptime": 188553,
  "services": {
    "api": { "status": "online", "services": 5 },
    "mcp": { "status": "online", "adapters": 27, "tools": 975,
             "supabase": { "healthy": true, ... } }
  },
  "version": "1.0.0"
}
```

### AI Chat (primary client endpoint)

```bash
POST /api/v1/ai/chat
Headers:
  Content-Type: application/json
  X-API-Key: lano_<your_key>       # OR Authorization: Bearer <token>

# Minimal request — router picks everything else
Body: { "prompt": "What is Maple Hub by Lan Onasis?" }

# With use case context
Body: {
  "messages": [
    { "role": "user", "content": "What services does Onasis offer?" }
  ],
  "use_case": "landing-guide"
}

# Response (vendor-agnostic):
{
  "response": "Onasis offers...",
  "onasis_metadata": {
    "service": "onasis-ai",
    "use_case": "landing-guide",
    "processing_time": 1240,
    "powered_by": "Onasis-CORE Partnership Platform",
    "partner_api_version": "2.0.0",
    "vendor_masked": true,
    "pii_removed": true,
    "timestamp": "2026-02-22T..."
  }
}
```

### Supported `use_case` values

| Value                 | Best for                        |
|-----------------------|---------------------------------|
| `ask-ai`              | Quick inline chat buttons       |
| `landing-guide`       | Onboarding / landing page guide |
| `dashboard-assistant` | Full in-app assistant panel     |
| `support-chat`        | Customer support widgets        |
| `content-generation`  | Copy / summary generation       |
| `code-assist`         | Dev tooling / code chat         |

### Client-side integration pattern

```javascript
// All client apps call ONE endpoint — router handles the rest
const response = await fetch('https://api.connectionpoint.tech/api/v1/ai/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.ONASIS_API_KEY,
    'X-Use-Case': 'ask-ai',           // optional — also accepted in body
  },
  body: JSON.stringify({
    messages: [{ role: 'user', content: userInput }],
    // use_case: 'ask-ai'             // body form also accepted
  }),
});
const data = await response.json();
displayMessage(data.response);
```

---

## 8. Validated Endpoint Tests

Tests confirmed against live deployment (commit `7a88b24`, 2026-02-22):

| Endpoint | Method | Auth | Status | Confirmed |
|---|---|---|---|---|
| `/health` | GET | None | 200 | ✅ |
| `/api/v1/ai/chat` | POST | `X-API-Key` | 200 | ✅ |
| `/api/v1/ai/chat` | POST | None | 401 | ✅ |
| Supabase edge (internal) | — | auto-fallback | connectivity ✅ | Supabase reachable (`supabase_healthy: true` in `/health`) |

> **Routing note (commit `7a88b24`):** The successful `POST /api/v1/ai/chat` 200 response was served by the
> **API gateway with Ollama available** — not by the Supabase edge function. Ollama is the primary vendor;
> the Supabase edge activates only when Ollama is unreachable. Supabase reachability is confirmed via the
> `/health` endpoint (`supabase_healthy: true`), but the fallback path is only exercised during an actual
> Ollama outage.
>
> **Vendor leak in old code:** The deployed commit `7a88b24` (pre-vendor-abstraction) included a
> `"provider": "openai"` field in chat responses. The new `sanitizeVendorResponse()` strips this field
> and all other vendor-identifying keys. This fix takes effect on the next deployment.

### Confirmed response shapes

**`GET /health` → 200**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 188553,
  "services": {
    "api": { "status": "online", "services": 5 },
    "mcp": {
      "status": "online",
      "adapters": 27,
      "tools": 975,
      "supabase": {
        "healthy": true,
        "supabaseUrl": "https://mxtsdgkwzjzlttpotole.supabase.co"
      }
    }
  }
}
```

**`POST /api/v1/ai/chat` without auth → 401**
```json
{
  "error": "Authentication required",
  "requestId": "ccf31f74-3188-475e-9281-baf939b823e9"
}
```

**`POST /api/v1/ai/chat` with valid `X-API-Key` → 200 (via Ollama on current deployment)**
```json
{
  "response": "<AI answer>",
  "onasis_metadata": {
    "service": "onasis-ai",
    "use_case": "ask-ai",
    "processing_time": 1240,
    "powered_by": "Onasis-CORE Partnership Platform",
    "partner_api_version": "2.0.0",
    "vendor_masked": true,
    "pii_removed": true,
    "timestamp": "2026-02-22T..."
  }
}
```

> **After next deployment:** The response above reflects the sanitized shape that the new vendor-abstraction
> code produces. The pre-deployment response additionally contained `"provider": "openai"` (now stripped).

---

## 9. Design Patterns Summary

| Pattern | Where | Why |
|---|---|---|
| **Vendor Abstraction** | `vendors/` | Clients never see provider names or models |
| **Use-Case Routing** | `vendors/index.js` | Router allocates vendor/model; users set intent only |
| **Fallback Chain** | `resolveVendorChainForUseCase` | Automatic failover: Ollama → Supabase edge |
| **Circuit Breaker** | `ai-service-router.js` | Bypass dead vendors without slow timeouts |
| **Two-Turn AI** | `handleOllamaChat` | Tool execution in a single user request |
| **Memory Prefetch** | `prefetchMemoryBrief` | Parallel context loading, deduped with inflight map |
| **Privacy Proxy** | `unified-router.js` | PII stripped before any backend call |
| **Response Sanitization** | `sanitizeVendorResponse` | Vendor identity removed from every response |
| **Executable Allowlist** | `toolCodeRunCommand` | `execFile()` + Set of permitted commands |
| **Path Sandbox** | `_resolveRestrictedPath` | File ops confined to `CODE_BASE_DIR` |

---

## 10. Adding a New Vendor

1. Create `vendors/<name>/adapter.js` — implement `chat(internalRequest, model)` and `healthCheck()`
2. Register in `VENDOR_REGISTRY` in `vendors/index.js` with `status: 'stub'`
3. Set `capabilities: [...]` listing supported use cases
4. Test the adapter in isolation
5. Change `status: 'stub'` → `'active'`
6. Wire into the fallback chain by setting `fallbackVendor: '<name>'` on the vendor that should defer to it

Never change `status` to `'active'` without completing steps 1–5 first.
