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
