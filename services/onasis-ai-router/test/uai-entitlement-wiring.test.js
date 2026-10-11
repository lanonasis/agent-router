'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthMiddleware } = require('../core/middleware');
const { ProfileResolver, PROFILE_HEADER } = require('../core/profile-resolver');

// The gateway now returns applicationId + applicationEntitlements
// (onasis-core 17ccce0). These tests pin the router half: that the middleware
// carries them onto req.uai, and that the resolver's verdict changes only
// because of them — never because of anything a caller sent.

function stubFetch(body, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null },
    json: async () => body,
  });
}

async function resolveUai(body, headers, reqHeaders = { 'x-api-key': 'lano_test' }) {
  const realFetch = global.fetch;
  stubFetch(body, headers);
  // A unique key per call so the shared auth cache cannot serve a prior test.
  const req = { headers: { ...reqHeaders, 'x-test-nonce': String(Math.random()) } };
  try {
    const authenticateRequest = createAuthMiddleware({
      authGatewayUrl: 'http://127.0.0.1:9',
      logger: { warn() {}, error() {}, info() {} },
    });
    await new Promise((resolve, reject) => {
      authenticateRequest(req, {
        status: () => ({ json: (b) => reject(new Error('auth rejected: ' + JSON.stringify(b))) }),
      }, resolve);
    });
  } finally {
    global.fetch = realFetch;
  }
  return req.uai;
}

test('entitlements and application id are carried onto req.uai', async () => {
  const uai = await resolveUai({
    authId: 'u1', organizationId: 'org-1', authMethod: 'api_key',
    applicationId: 'app_maple_hub',
    applicationEntitlements: ['l0-concierge'],
  });
  assert.equal(uai.applicationId, 'app_maple_hub');
  assert.deepEqual(uai.applicationEntitlements, ['l0-concierge']);
});

test('an older gateway that reports nothing leaves entitlements absent, not empty', async () => {
  // The distinction is load-bearing: absent means "this gateway cannot report
  // entitlements", which must refuse profiles. An [] default here would look
  // identical to "reported, and you have none" and quietly lose that.
  const uai = await resolveUai({ authId: 'u1', authMethod: 'api_key' });
  assert.equal('applicationEntitlements' in uai, false);
  assert.equal(uai.applicationId, undefined);
});

test('entitlements are read from the body or the UAI header, not a caller header', async () => {
  const viaHeader = await resolveUai(
    { authId: 'u1', authMethod: 'api_key' },
    { 'x-uai-application-id': 'app_from_gateway' },
    // A caller trying to assert its own application and grants:
    { 'x-api-key': 'lano_test', 'x-uai-application-id': 'app_forged',
      'x-onasis-application': 'app_forged' },
  );
  assert.equal(viaHeader.applicationId, 'app_from_gateway');
  assert.equal('applicationEntitlements' in viaHeader, false,
    'a caller header must never become an entitlement');
});

test('end to end: the same request flips only when the gateway grants it', async () => {
  const resolver = new ProfileResolver();
  const req = (uai) => ({ headers: { [PROFILE_HEADER]: 'l0-concierge' }, uai });

  const denied = await resolveUai({ authId: 'u1', authMethod: 'api_key' });
  assert.throws(() => resolver.resolve(req(denied)),
    (e) => e.code === 'entitlements_unavailable');

  const granted = await resolveUai({
    authId: 'u1', authMethod: 'api_key',
    applicationId: 'l0-concierge',
    applicationEntitlements: ['l0-concierge'],
  });
  const manifest = resolver.resolve(req(granted));
  assert.equal(manifest.profileId, 'l0-concierge');
  assert.equal(manifest.boundUseCase, 'dashboard-assistant');
});

test('a non-array entitlement value is not a grant', async () => {
  // Guards against a gateway bug or a hand-edited row turning a string into
  // authority.
  const uai = await resolveUai({
    authId: 'u1', authMethod: 'api_key', applicationEntitlements: 'l0-concierge',
  });
  assert.equal('applicationEntitlements' in uai, false);
  assert.throws(
    () => new ProfileResolver().resolve({ headers: { [PROFILE_HEADER]: 'l0-concierge' }, uai }),
    (e) => e.code === 'entitlements_unavailable',
  );
});
