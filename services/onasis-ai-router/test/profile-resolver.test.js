'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProfileResolver, ProfileError, validateManifest, entitlementsFor,
        PROFILE_HEADER, APPLICATION_HEADER } = require('../core/profile-resolver');

// Release gate 3: "Router tests prove no caller-supplied system prompt or
// unentitled profile can alter behavior." The system-prompt half is pinned in
// test/message-policy.test.js; this file pins the profile half.
//
// Live check 2026-09-03: auth.lanonasis.com/v1/auth/resolve returned authId,
// authMethod, credentialId, authSource, actorId, actorType, apiKeyId — and no
// applicationId or entitlements, so profile requests were refused then.
// Superseded: auth-gateway 8894492 (2026-09-09) now publishes
// applicationEntitlements, verified live 2026-09-10, so a request that lacks a
// grant is refused as profile_not_entitled — a real entitlement comparison, not
// a missing feature.

const MANIFEST = {
  profileId: 'test-profile',
  applicationId: 'test-app',
  version: '1.0.0',
  status: 'active',
  publicModel: 'lzero',
  roleTemplate: 'generic',
  identityTemplate: 'IDENTITY-LAYER.md',
  policyDocuments: ['policies.md'],
  allowedTools: ['memory.search'],
  memoryMode: 'user-scoped',
  allowedMessageRoles: ['user', 'assistant', 'tool'],
  allowedContextFields: [],
  boundUseCase: 'dashboard-assistant',
  limits: { maxInputTokens: 8000, maxOutputTokens: 1200, requestTimeoutMs: 60000 },
};

function withProfiles(manifests) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profiles-'));
  manifests.forEach((m, i) => fs.writeFileSync(path.join(dir, `p${i}.json`), JSON.stringify(m)));
  return new ProfileResolver({ dir });
}

const reqWith = (headers, uai) => ({ headers, uai });

test('no profile header returns null — the use-case path is untouched', () => {
  // Every current caller takes this path; it must not start failing.
  assert.equal(withProfiles([MANIFEST]).resolve(reqWith({}, { authId: 'u' })), null);
});

test('an entitled caller resolves the manifest', () => {
  const r = withProfiles([MANIFEST]);
  const got = r.resolve(reqWith(
    { [PROFILE_HEADER]: 'test-profile' },
    { authId: 'u', applicationEntitlements: ['test-profile'] },
  ));
  assert.equal(got.profileId, 'test-profile');
  assert.equal(got.boundUseCase, 'dashboard-assistant');
});

test('application-qualified entitlements are accepted', () => {
  const r = withProfiles([MANIFEST]);
  assert.ok(r.resolve(reqWith(
    { [PROFILE_HEADER]: 'test-profile' },
    { authId: 'u', applicationEntitlements: ['test-app:test-profile'] },
  )));
});

test('absent entitlements fail closed, not open', () => {
  // NOT the live condition — the live condition is a real entitlement
  // comparison that refuses with profile_not_entitled (see the file header and
  // the live-shaped test below). This branch means the gateway returned nothing
  // at all: an outage, or a pre-8894492 gateway. An implementation that treated
  // "no entitlement data" as "no restrictions" would hand every caller every
  // profile.
  const r = withProfiles([MANIFEST]);
  for (const uai of [{ authId: 'u' }, { authId: 'u', applicationEntitlements: null }, {}, undefined]) {
    assert.throws(
      () => r.resolve(reqWith({ [PROFILE_HEADER]: 'test-profile' }, uai)),
      (e) => e instanceof ProfileError && e.status === 403
             && e.code === 'entitlements_unavailable',
      `uai=${JSON.stringify(uai)} must be refused`,
    );
  }
});

test('an empty entitlement list grants nothing', () => {
  const r = withProfiles([MANIFEST]);
  assert.throws(
    () => r.resolve(reqWith({ [PROFILE_HEADER]: 'test-profile' },
      { authId: 'u', applicationEntitlements: [] })),
    (e) => e.code === 'profile_not_entitled' && e.status === 403,
  );
});

test('entitlement to one profile does not grant another', () => {
  const other = { ...MANIFEST, profileId: 'other-profile' };
  const r = withProfiles([MANIFEST, other]);
  assert.throws(
    () => r.resolve(reqWith({ [PROFILE_HEADER]: 'other-profile' },
      { authId: 'u', applicationEntitlements: ['test-profile'] })),
    (e) => e.code === 'profile_not_entitled',
  );
});

test('a draft profile cannot be activated even by an entitled caller', () => {
  const r = withProfiles([{ ...MANIFEST, status: 'draft' }]);
  assert.throws(
    () => r.resolve(reqWith({ [PROFILE_HEADER]: 'test-profile' },
      { authId: 'u', applicationEntitlements: ['test-profile'] })),
    (e) => e.code === 'profile_not_active' && e.status === 403,
  );
});

test('an unknown profile is a 400, distinct from a refusal', () => {
  assert.throws(
    () => withProfiles([MANIFEST]).resolve(reqWith({ [PROFILE_HEADER]: 'nope' },
      { authId: 'u', applicationEntitlements: ['nope'] })),
    (e) => e.code === 'profile_not_found' && e.status === 400,
  );
});

test('the application header cannot nominate a different application', () => {
  const r = withProfiles([MANIFEST]);
  assert.throws(
    () => r.resolve(reqWith(
      { [PROFILE_HEADER]: 'test-profile', [APPLICATION_HEADER]: 'someone-elses-app' },
      { authId: 'u', applicationEntitlements: ['test-profile'] })),
    (e) => e.code === 'profile_application_mismatch',
  );
});

test('an application header without a profile is rejected, not ignored', () => {
  assert.throws(
    () => withProfiles([MANIFEST]).resolve(reqWith({ [APPLICATION_HEADER]: 'test-app' }, { authId: 'u' })),
    (e) => e.code === 'profile_required' && e.status === 400,
  );
});

test('entitlements are read from UAI only, never from a header', () => {
  // The header is caller-controlled; treating it as authority would make the
  // whole check ornamental.
  const r = withProfiles([MANIFEST]);
  assert.throws(
    () => r.resolve(reqWith({
      [PROFILE_HEADER]: 'test-profile',
      'x-uai-entitlements': 'test-profile',
      'x-onasis-entitlements': 'test-profile',
    }, { authId: 'u' })),
    (e) => e.code === 'entitlements_unavailable',
  );
  assert.equal(entitlementsFor({ applicationEntitlements: 'test-profile' }), null,
    'a non-array entitlement value must not be treated as a grant');
});

test('a manifest permitting system/developer roles is rejected at load', () => {
  // Otherwise a manifest could re-open the hole core/message-policy.js closes.
  for (const role of ['system', 'developer']) {
    assert.throws(
      () => validateManifest({ ...MANIFEST, allowedMessageRoles: ['user', role] }, 'x.json'),
      /may not permit system\/developer/,
    );
  }
});

test('an incomplete manifest is rejected at load, not at request time', () => {
  const { profileId, ...noId } = MANIFEST;
  assert.throws(() => validateManifest(noId, 'x.json'), /missing: profileId/);
});

test('manifests are frozen — a deployed version must be immutable', () => {
  const r = withProfiles([MANIFEST]);
  const m = r.list()[0];
  assert.throws(() => { m.allowedTools.push('code.write'); }, TypeError);
  assert.throws(() => { m.limits.maxOutputTokens = 999999; }, TypeError);
});

test('a missing profiles directory is a valid empty state', () => {
  const r = new ProfileResolver({ dir: path.join(os.tmpdir(), 'definitely-not-here-'+process.pid) });
  assert.deepEqual(r.list(), []);
  assert.equal(r.resolve(reqWith({}, { authId: 'u' })), null);
});

test('a live-shaped UAI without the grant is refused as not entitled', () => {
  // Reproduces the CURRENT live auth-gateway response shape. auth-gateway
  // shipped 8894492 on 2026-09-09 and began publishing applicationEntitlements
  // from UAI; verified live 2026-09-10 that a request naming l0-concierge
  // returns profile_not_entitled, which is only reachable PAST the
  // entitlements-null guard — so real entitlement data is arriving and being
  // compared. The gateway strips the `profile:` prefix before publishing, so
  // the values here are bare. The credential genuinely lacks this profile, so
  // the honest code is profile_not_entitled, not entitlements_unavailable.
  const router = new ProfileResolver();
  const liveShapedUai = {
    authId: 'ec93b540-124c-427c-a357-5767e0986ae5',
    authMethod: 'api_key', credentialId: 'x', authSource: 'api_key',
    actorId: 'x', actorType: 'user', apiKeyId: 'x',
    applicationEntitlements: ['some-other-profile'],
  };
  assert.throws(
    () => router.resolve(reqWith({ [PROFILE_HEADER]: 'l0-concierge' }, liveShapedUai)),
    (e) => e instanceof ProfileError && e.code === 'profile_not_entitled' && e.status === 403,
    'a live-shaped UAI that does not grant l0-concierge must be refused as not entitled',
  );
});

test('a live-shaped UAI with a bare entitlement resolves the shipped manifest', () => {
  // POSITIVE end-to-end proof: the gateway publishes applicationEntitlements
  // with the `profile:` prefix ALREADY STRIPPED (auth-gateway resolve.routes.ts
  // ~L49-50 and api-key.service.ts extractProfileEntitlements ~L705-733), so an
  // entitled credential arrives here as exactly ['l0-concierge'] — bare. Against
  // the real shipped manifest (default PROFILES_DIR, status 'active') that must
  // ACTIVATE l0-concierge: this is the Phase 3 goal, and it proves the bare
  // comparison grants, not only refuses.
  const router = new ProfileResolver();
  const entitledUai = {
    authId: 'ec93b540-124c-427c-a357-5767e0986ae5',
    authMethod: 'api_key', credentialId: 'x', authSource: 'api_key',
    actorId: 'x', actorType: 'user', apiKeyId: 'x',
    applicationEntitlements: ['l0-concierge'],
  };
  const manifest = router.resolve(reqWith({ [PROFILE_HEADER]: 'l0-concierge' }, entitledUai));
  assert.equal(manifest.profileId, 'l0-concierge');
});

test('a prefixed entitlement is not a grant — the contract is prefix-stripped', () => {
  // Documents that the router expects PREFIX-STRIPPED values and fails closed
  // (safe) if a gateway ever emits prefixed ones. The `profile:` prefix is
  // stripped upstream — auth-gateway PROFILE_SCOPE_PREFIX ('profile:') plus
  // extractProfileEntitlements in services/auth-gateway/src/services/api-key.service.ts
  // ~L705-733 does `out.add(scope.slice(PROFILE_SCOPE_PREFIX.length))`, and
  // tests/unit/resolve.routes.test.ts ~L123 expects `['l0-concierge']` bare.
  // Because a preserved `profile:l0-concierge` would also fail the bare
  // comparison, the live evidence (profile_not_entitled) alone cannot tell the
  // two apart — this test pins the contract explicitly.
  const router = new ProfileResolver();
  const prefixedUai = {
    authId: 'ec93b540-124c-427c-a357-5767e0986ae5',
    authMethod: 'api_key', credentialId: 'x', authSource: 'api_key',
    actorId: 'x', actorType: 'user', apiKeyId: 'x',
    applicationEntitlements: ['profile:l0-concierge'],
  };
  assert.throws(
    () => router.resolve(reqWith({ [PROFILE_HEADER]: 'l0-concierge' }, prefixedUai)),
    (e) => e instanceof ProfileError && e.code === 'profile_not_entitled' && e.status === 403,
    'a still-prefixed entitlement must not be treated as a grant',
  );
});

test('a UAI with no entitlements at all fails closed', () => {
  // The gateway-returned-nothing case: an outage, or an old gateway that
  // predates 8894492. NOT "the feature does not exist yet" — it shipped and is
  // live. Because no entitlement data arrived, the resolver must refuse rather
  // than default to allowing every profile through. Exercised against the
  // shipped l0-concierge manifest so the real profile is what gets refused.
  const router = new ProfileResolver();
  const noEntitlementsUai = {
    authId: 'ec93b540-124c-427c-a357-5767e0986ae5',
    authMethod: 'api_key', credentialId: 'x', authSource: 'api_key',
    actorId: 'x', actorType: 'user', apiKeyId: 'x',
  };
  assert.throws(
    () => router.resolve(reqWith({ [PROFILE_HEADER]: 'l0-concierge' }, noEntitlementsUai)),
    (e) => e instanceof ProfileError && e.code === 'entitlements_unavailable' && e.status === 403,
    'when the gateway returns no entitlements, activation must fail closed',
  );
});
