# Onasis AI Router

The Onasis AI Router is the authenticated inference service for the L0
platform. It accepts a caller through Auth Gateway UAI, applies router-owned
prompt and memory policy, selects an internal inference path, and returns a
branded vendor-neutral response.

It is not an application-specific chatbot endpoint and it is not a direct
upstream-model proxy.

```text
application -> UAI identity resolution -> router policy -> scoped memory/tools -> internal inference chain
```

## Public contracts

Start with the documents that define the actual contract:

- [L0 Platform Contract](docs/L0-PLATFORM-CONTRACT.md)
- [Integration Guide](docs/INTEGRATION-GUIDE.md)
- [Architecture and codemap](docs/ARCHITECTURE.md)

Public base URL: `https://ai.vortexcore.app`.

| Surface | Endpoint | Audience |
|---|---|---|
| Health | `GET /health` | Operational monitoring; unauthenticated. |
| Native chat | `POST /api/v1/ai-chat` | First-party/router-aware clients. |
| Supabase-style native alias | `POST /functions/v1/ai-chat` | Existing compatible callers. |
| OpenAI model discovery | `GET /v1/models` | OpenAI-compatible clients; authenticated. |
| OpenAI chat | `POST /v1/chat/completions` | SDKs and harnesses that require OpenAI shape. |
| Session memory proxy | `POST /api/v1/session-memory/events`, `GET /api/v1/session-memory/:sessionId` | Authenticated router clients only. |

The public model is `lzero`, owned by Onasis. `Vortex-L0` and `L0` are
compatibility aliases; the router never exposes the real upstream vendor or
model.

## Authentication and request rules

Every protected endpoint resolves identity through Auth Gateway UAI.

- Native `/api/v1/ai-chat`: send a `lano_` key as `X-API-Key`, or a user JWT /
  OAuth token as `Authorization: Bearer`.
- OpenAI `/v1`: accepts the OpenAI Bearer convention for `lano_` keys and
  normalizes it at the facade; JWT/OAuth Bearers are passed to UAI unchanged.
- Do not send both credential headers.
- `lms_` and `vx_` credentials are not router credentials unless an explicit
  issuer-to-identity mapping is implemented and verified.

The native request shape is:

```json
{
  "use_case": "ask-ai",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

The OpenAI-compatible request shape is:

```json
{
  "model": "lzero",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

`stream: true` is deliberately rejected until real SSE support exists. The
native answer field is `response`; the OpenAI facade uses
`choices[0].message.content`.

## Agent Heaven profiles

Agent Heaven is becoming the profile control plane. It defines reviewed
identity, role templates, policy documents, allowed tools, memory mode, and
limits. The router will consume a versioned profile only after UAI can prove
the caller’s application/profile entitlement.

That entitlement check is not implemented yet. Do not rely on
`X-Onasis-Profile` or `X-Onasis-Application` to select a persona today; they
are planned metadata, not authorization. Current router use cases continue to
use the router’s existing prompt composition and validation.

## Local operation

Requirements: Node.js 22+ and a configured local development environment. The
server binds loopback-only by default.

```bash
cd /opt/lanonasis/shared_services/onasis-agent-haven/services/onasis-ai-router
npm install
npm start
```

Defaults:

- Bind host: `127.0.0.1`
- Port: `8000`
- Health: `http://127.0.0.1:8000/health`
- Public ingress is expected to be handled by the host reverse proxy.

Configuration is environment-driven. Do not commit credentials. Relevant
settings include `AUTH_GATEWAY_URL`, `API_BASE_URL`, `OLLAMA_BASE_URL`,
`PROMPT_IDENTITY_MODE`, `PROMPTS_ROOT`, and memory-prefetch limits. Inspect a
prompt composition locally with:

```bash
npm run inspect:prompt -- ask-ai --preview
```

## Reliability and privacy

- UAI identity and organization scope partition memory-prefetch cache and
  in-flight work.
- Memory prefetch degrades to an answer without context rather than turning a
  memory outage into a router error.
- A single unhealthy internal provider means `/health` is `200 degraded`; only
  no viable provider produces `503 unavailable`.
- The router applies circuit breaking, latency-aware tail demotion, and vendor
  fallthrough internally.
- User-facing responses must not expose upstream vendors, models, internal
  workspace/agent identity, or another caller’s memory.

## Tests

```bash
npm test
```

The suite covers response contracts, OpenAI compatibility, UAI transport
normalization, cache isolation, tool behavior, health semantics, and vendor
fallthrough. HTTP contract tests use local loopback listeners and may be
skipped only in sandboxed environments that prohibit listener creation.

## Runtime ownership

The repository’s systemd template under `../../infra/systemd/` declares the
intended production runtime model. It contains host-specific paths, so verify
the installed unit before treating it as a deployable artifact. The PM2
configuration in `../../infra/pm2/` is for local development or a deliberate
migration; it is not the intended production owner.
