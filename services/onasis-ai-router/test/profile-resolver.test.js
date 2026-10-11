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
// Live check 2026-09-03: auth.lanonasis.com/v1/auth/resolve returns authId,
// authMethod, credentialId, authSource, actorId, actorType, apiKeyId — and no
// applicationId or entitlements. So every profile request must be refused
// today, and these tests encode that as the intended state rather than a gap.

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
  // The live condition today. An implementation that treated "no entitlement
  // data" as "no restrictions" would hand every caller every profile.
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

test('the shipped l0-concierge manifest is refused by a real-shaped UAI', () => {
  // Reproduces the live auth-gateway response shape verified 2026-09-03.
  const router = new ProfileResolver();
  const liveShapedUai = {
    authId: 'ec93b540-124c-427c-a357-5767e0986ae5',
    authMethod: 'api_key', credentialId: 'x', authSource: 'api_key',
    actorId: 'x', actorType: 'user', apiKeyId: 'x',
  };
  assert.throws(
    () => router.resolve(reqWith({ [PROFILE_HEADER]: 'l0-concierge' }, liveShapedUai)),
    (e) => e.code === 'entitlements_unavailable',
    'no profile may activate until auth-gateway returns entitlements',
  );
});
