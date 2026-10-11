# Auth-gateway entitlements — scope

**Status:** scoped 2026-09-03, not started. Unblocks profile activation in
`onasis-ai-router` (see `L0-AGENT-HEAVEN-CONVERGENCE-PLAN.md` phase 3).

**Repo:** `onasis-core`, `services/auth-gateway` (HEAD `a28f056`), deployed via
PM2 as `auth-gateway` on port 4000 / `https://auth.lanonasis.com`.

## Headline

**This is smaller than the convergence plan implies.** The plan says "Extend UAI
resolution with verified application identity and profile entitlements", which
reads like new infrastructure. It mostly isn't. The identity, scope, and
application primitives all exist — `/v1/auth/resolve` computes most of what the
router needs and then **throws it away** before responding.

The work is plumbing plus one modelling decision, not a new subsystem.

## Correction to an earlier finding

The router's `core/openai-compat.js` says a `lano_` key is rejected on Bearer
and that Onasis-CORE PR #112 "is not deployed". **That is now stale.** Verified
live 2026-09-03:

```
Bearer + lano_  -> 200
X-API-Key       -> 200
```

The fix is in source at HEAD (`a28f056 fix(auth): resolve bearer API keys to
UAI`) and is running. The router's Bearer→X-API-Key translation is now
redundant. It is harmless and still correct, so it is not urgent to remove, but
the comment claiming otherwise should be corrected.

## What already exists

| Capability | Where | State |
|---|---|---|
| Bearer + X-API-Key transport parity | `resolve.routes.ts` priority 3 | deployed |
| Scope catalogue incl. `ai:chat`, `ai:*` | `api-key.service.ts` `VALID_SCOPES` | done |
| Scope storage + normalisation | `security_service.api_keys.permissions`, `normalizeScopes()` | done |
| Org, project scope, key context on a key | `api_keys.organization_id`, `.project_scope`, `.key_context` | done |
| Per-service entitlement with rate limits | `ServiceScope { service_key, allowed_actions, max_calls_per_minute, max_calls_per_day }` | done |
| Application registry | `auth_gateway.api_clients` (`app_id`, `app_name`, `metadata`) | done |
| Key → application binding | `api_keys.binding.client_id` → `api_clients.client_id` → `app_id` | done |
| `validateAPIKey()` returning all of it | returns `permissions`, `organizationId`, `projectScope`, `keyContext`, `keyId`, `binding` | done |

The application-identity chain the plan asks for is already modelled end to
end. Nothing walks it at resolve time.

## The actual gaps

### 1. `/v1/auth/resolve` discards what it just computed — the whole gap in one place

`src/routes/resolve.routes.ts` priority 3 keeps only two fields:

```ts
if (validation.valid && validation.userId) {
  authMethod = 'api_key'
  resolvedApiKeyId = validation.keyId
  resolvedUAI = await resolveIdentityCached('api_key', validation.userId, {...})
}
```

`validation.permissions`, `.organizationId`, `.projectScope`, `.keyContext` and
`.binding` are all in scope on that line and never read again. The response
body is built from `resolvedUAI` alone.

**Effort: small.** No schema change, no new query — the data is already in
process memory.

### 2. `X-Project-Scope` is dead on the API-key path (defect)

Around line 232:

```ts
const projectScope = req.user?.project_scope ?? (req.user?.app_metadata as ...)?.project_scope
```

This route never populates `req.user` on the API-key path — it calls
`validateAPIKey` directly. So `X-Project-Scope` is never set for API-key auth,
even though `validation.projectScope` was available ~65 lines earlier. The
in-code comment ("carried via X-Project-Scope from the caller's JWT claim or
api_key.project_scope if available in req.user") describes an intent the code
does not implement for this path.

Fixed by the same change as gap 1.

### 3. Two sources of truth for `organizationId`

The response takes org from the **identity** record
(`identity-resolution.service.ts`, `identity.organization_id`), while
`validateAPIKey` independently returns the **key's** `organization_id`. Live,
the identity path yields empty:

```
x-uai-organization:        (empty)
```

Before wiring entitlements, decide which wins. This matters beyond tidiness:
the router's memory prefetch cache key includes `organizationId` (finding #7),
so an empty value there weakens tenant separation to per-user only.

### 4. No profile-entitlement vocabulary — the one real modelling decision

Scopes today are service-level (`ai:chat`), not profile-level. The router
expects `applicationEntitlements: string[]` and accepts either `<profileId>` or
`<applicationId>:<profileId>`.

**Recommendation: reuse the existing scope array with a `profile:` namespace**
— `profile:l0-concierge`, or `profile:l0-concierge:*` for a whole application.

Why this over a new table:
- `VALID_SCOPES` already uses colon notation, so it needs one entry pattern,
  not a new schema, migration, join, or cache layer.
- Scope storage, normalisation, validation and admin tooling already exist and
  are already on the resolve path.
- Revocation is editing an existing array, using machinery that already works.

The cost is that profile grants live in the same flat list as service
permissions. Acceptable now; if profiles later need per-profile rate limits or
version pinning, `ServiceScope` is the existing shape to grow into — it already
carries `allowed_actions` and rate limits.

Note `ApiKeyConsumer` (`'claude' | 'hermes' | 'openclaw'`) is a **closed enum
for agent tooling**, not an application registry. Do not extend it for L0
applications.

### 5. `actorType` is hardcoded

```ts
res.set('X-Actor-Type', 'user')   // agent/service types are future work
```

Only matters if profiles get used by service credentials rather than user keys.
Out of scope unless that is expected soon.

## Work items

| # | Change | Where | Size |
|---|---|---|---|
| 1 | Carry `permissions`, `organizationId`, `projectScope`, `keyContext` from `validateAPIKey` into the resolve response + headers | `resolve.routes.ts` | S |
| 2 | Derive `applicationId` by walking `binding.client_id` → `api_clients.app_id` | `resolve.routes.ts` / `api-key.service.ts` | S–M |
| 3 | Add `profile:*` scope patterns to `VALID_SCOPES`; expose the filtered subset as `applicationEntitlements` | `api-key.service.ts` | S |
| 4 | Decide and enforce one `organizationId` source | `identity-resolution.service.ts` | S, needs a decision |
| 5 | Read `applicationEntitlements` + `applicationId` in the router's auth middleware | `onasis-ai-router/core/middleware.js` | S |
| 6 | Correct the stale PR #112 comment | `onasis-ai-router/core/openai-compat.js` | XS |

Items 1–3 are the critical path. Item 5 is the router side and cannot be tested
end to end until 1–3 ship.

## Risks

- **Cache TTL is a revocation window.** The router caches resolved UAI for
  `AUTH_CACHE_TTL_SECONDS` (default 20s), shared across replicas. Once
  entitlements ride along, a revoked profile grant stays honoured for up to that
  window. 20s is defensible; it should be a deliberate choice, not a surprise.
- **Widening the resolve response widens what every downstream service sees.**
  `/v1/auth/resolve` backs an Nginx `auth_request` for multiple services, not
  just the router. Adding permissions to the body exposes a caller's full scope
  list to all of them. Prefer returning only the `profile:`-namespaced subset as
  `applicationEntitlements` rather than the raw `permissions` array.
- **Fail-closed must survive the change.** The router currently refuses every
  profile because entitlement data is absent. Once the field exists, an empty or
  malformed value must still refuse — `test/profile-resolver.test.js` pins this,
  including that a non-array value is not a grant.

## Definition of done

1. `/v1/auth/resolve` returns `applicationId` and `applicationEntitlements` for
   an API key bound to a client with a `profile:` scope.
2. A key **without** the scope resolves successfully but returns no entitlement
   for that profile — authentication and authorisation stay separate.
3. The router activates `l0-concierge` for an entitled key and still returns
   `403 entitlements_unavailable` / `profile_not_entitled` otherwise.
4. Release gate 4 — "a post-deploy canary verifies one entitled profile through
   the public URL" — becomes runnable for the first time.
