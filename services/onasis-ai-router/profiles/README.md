# Profile manifests

One JSON file per profile, loaded at boot by `core/profile-resolver.js` and
frozen — the plan requires a manifest to be immutable for a deployed version.

**Being listed here does not make a profile reachable.** Activation also
requires the caller's credential to be entitled to it, and entitlements come
from UAI, never from a request header.

**Status changed 2026-09-09.** auth-gateway now publishes entitlements
(`8894492`, deployed 2026-09-09 12:42 UTC). Verified live 2026-09-10: a request
for `l0-concierge` returns `403 profile_not_entitled`, not
`entitlements_unavailable` — meaning the resolver received a real entitlement
list and compared against it. The cross-repo blocker on plan phase 3 is
therefore cleared; what remains is entitling credentials and writing the
remaining manifests, both of which are ordinary provisioning work.

`allowedMessageRoles` may not contain `system` or `developer`; a manifest that
tries is rejected at load, so no profile can re-open the hole
`core/message-policy.js` closes.
