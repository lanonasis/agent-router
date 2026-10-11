# Onasis L0 Platform Contract

**Status:** implementation baseline

This document is the contract for applications, harnesses, and first-party
services that use Onasis AI. It is intentionally narrower than the router's
internal implementation: vendor selection, upstream models, prompt assembly,
memory adapters, and circuit state are implementation details and are not part
of the public platform.

The integration guide contains examples. This document defines the rules those
examples must obey.

## 1. Boundaries and ownership

```text
caller -> Auth Gateway UAI -> Onasis AI Router -> internal vendor chain
                                   |
                                   +-> scoped memory retrieval
```

- **Auth Gateway UAI** resolves the caller and organization from credentials.
  It is the sole identity authority before a request reaches memory or the
  router's vendor chain.
- **Onasis AI Router** owns use-case selection, prompt policy, memory-tool
  availability, fallthrough, response branding, and compatibility translation.
- **Applications** own their UI, user consent, and client-side error handling.
  They never choose an upstream vendor or model.

### Agent Heaven profile control plane

Agent Heaven owns the reviewed profile that defines shared identity, role
template, product behavior, allowed tools, memory mode, limits, and the hidden
system instruction. The router consumes a versioned profile binding and owns
its runtime execution. Applications use the same OpenAI-compatible endpoint
and request an approved profile; they do not create profile-specific public
URLs or submit arbitrary system/developer prompts.

`X-Onasis-Profile` and `X-Onasis-Application` may express caller intent, but
they are not authority. UAI must resolve application entitlement from the
credential before the router activates a profile. Until that entitlement is
available in UAI, profile activation remains an internal/router-controlled
binding.

The router is an independent operational service. It calls UAI for identity;
it does not duplicate auth-gateway state or use the primary database as an
identity resolver.

## 2. Credentials and identity

Every protected router request is resolved by UAI. A request carries exactly
one credential scheme.

| Credential | Native router `/api/v1` | OpenAI facade `/v1` | Rule |
|---|---|---|---|
| Platform API key (`lano_`) | `X-API-Key` | `Authorization: Bearer` or `X-API-Key` | `/v1` temporarily translates Bearer `lano_` to `X-API-Key` until auth-gateway Bearer parity is deployed. |
| User JWT / OAuth access token | `Authorization: Bearer` | `Authorization: Bearer` | Passed unchanged to UAI. |
| PKCE/session credential | UAI-supported transport | UAI-supported transport | UAI resolves the resulting user identity and scope. |
| MaaS-scoped `lms_` / `vx_` credentials | Not accepted unless issuer mapping is explicitly implemented | Rejected as `invalid_api_key` | Prefixes are not authorization. A credential requires issuer, identity, organization, and revocation semantics. |

Auth-gateway PR #112 is the prerequisite for uniform API-key transport at the
gateway. Its deployment removes the router's temporary OpenAI translation; it
does not itself make an `lms_` or `vx_` credential router-valid.

Memory prefetch and any cache/inflight state must be partitioned by the UAI
identity, organization, and relevant retrieval filters. A shared server key is
therefore acceptable only for truly shared/anonymous interactions; it must not
stand in for distinct users with personal memory.

## 3. API surfaces

### Native router API

`POST /api/v1/ai-chat` is the native endpoint for first-party and
router-aware applications.

```json
{
  "use_case": "ask-ai",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

The successful response's answer is `response`. Existing native clients must
not read a fictitious `message.content` or OpenAI `choices` field.

### OpenAI-compatible facade

The facade exists for clients that require OpenAI protocol semantics:

- `GET /v1/models`
- `GET /v1/models/{model}`
- `POST /v1/chat/completions`

It exposes exactly one public model:

```json
{ "id": "lzero", "object": "model", "owned_by": "Onasis" }
```

`Vortex-L0`, `vortexl0`, and `L0` are temporary, case-insensitive aliases.
Responses always identify the public model as `lzero`. Unknown model IDs fail
with `404 model_not_found`; they are never silently substituted.

The facade translates only shape and credential transport. It invokes the same
router policy as the native API and must not implement a separate vendor chain,
memory path, or fallback policy.

Streaming is not implemented. `stream: true` fails explicitly with
`400 stream_unsupported`; clients must request a buffered completion until a
proper SSE contract is added.

## 4. Public behavior and error semantics

- `/health` is unauthenticated operational health. `200 degraded` means at
  least one internal vendor is unavailable but the router still has a serving
  path. `503 unavailable` means no vendor can serve.
- `/v1/models` is authenticated capability discovery, not a deployment health
  probe.
- `401 AUTH_REQUIRED` means credentials are absent, invalid, revoked, or sent
  through the wrong transport.
- `429 RATE_LIMIT_EXCEEDED` includes `Retry-After`; callers must back off.
- `500 AI_SERVICE_ERROR` means the eligible internal chain exhausted. Callers
  may retry once with bounded delay and render a truthful fallback.
- `503 AUTH_SERVICE_UNAVAILABLE` means UAI could not be reached; it is distinct
  from an invalid credential.

No public response may name an internal vendor, upstream model, agent profile,
workspace, gateway, or private memory belonging to another identity.

## 5. Compatibility and release gates

Before a router release is called platform-compatible, all of the following
must pass:

1. Offline route tests cover `/v1/models`, model aliases, OpenAI Bearer `lano_`
   translation, JWT passthrough, unsupported scoped credentials, and validation
   errors without calling a vendor.
2. UAI contract tests prove the same valid credential has the intended outcome
   in native and facade transports.
3. A post-deploy canary checks authenticated model discovery and one bounded
   completion against the public URL, without logging credentials or vendor
   details.
4. A concurrent cross-identity memory test proves cached prefetch material
   cannot cross organization or user boundaries.
5. Each migrated client is verified from a clean install and reports whether it
   rendered a router response, a degraded-context response, or a local fallback.

## 6. Migration policy

Keep the native API while first-party clients migrate deliberately. Use the
OpenAI facade only for tools that require it. Do not add application-specific
use cases or vendors as a migration shortcut; propose those through router
ownership with the corresponding prompt, fallback, privacy, and cost review.

The current caller inventory and integration examples live in
`docs/INTEGRATION-GUIDE.md`. The route-level executable baseline lives in
`test/openai-compat-http.test.js`.
