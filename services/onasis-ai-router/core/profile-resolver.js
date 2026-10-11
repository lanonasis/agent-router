'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Profile activation, gated on UAI entitlement.
 *
 * Convergence plan §"Fixed decisions": *"Profile intent: `X-Onasis-Profile`;
 * application intent: `X-Onasis-Application`. Both require UAI entitlement
 * verification."* The word the plan chose is **intent** — these headers say
 * what the caller would like, never what it is allowed to have. A header is
 * caller-controlled input; entitlement comes from the credential.
 *
 * ## Entitlement state
 *
 * This resolver shipped inert on purpose. On 2026-09-03 auth-gateway returned
 * no applicationId and no entitlements, so every profile request was refused
 * and the resolver existed only to hold the door shut.
 *
 * That changed on 2026-09-09, when auth-gateway shipped `8894492` and began
 * publishing applicationEntitlements from UAI. Verified live 2026-09-10: a
 * request for l0-concierge now returns profile_not_entitled, which is only
 * reachable past the entitlements-null guard — so real entitlement data is
 * arriving and being compared. Entitlements are the `profile:` prefixed subset
 * of an API key's own permissions array.
 *
 * The resolver is therefore live, not inert. What remains is provisioning:
 * entitling credentials and writing the manifests. The alternative — leaving
 * the header
 * unimplemented until entitlements land — is what makes it easy for someone to
 * later wire `X-Onasis-Profile` straight into prompt selection and ship a
 * header-controlled persona switch. Release gate 3 asks for proof that "no
 * unentitled profile can alter behavior"; that proof is only meaningful if the
 * check exists before the profiles do.
 *
 * Requests that name no profile are unaffected and keep resolving by use case,
 * which is the plan's "controlled compatibility binding ... during migration".
 */

const PROFILE_HEADER = 'x-onasis-profile';
const APPLICATION_HEADER = 'x-onasis-application';

const PROFILES_DIR = path.resolve(__dirname, '..', 'profiles');

/** Carries an HTTP status so the route can answer precisely. */
class ProfileError extends Error {
  constructor(message, { status = 403, code = 'profile_not_entitled' } = {}) {
    super(message);
    this.name = 'ProfileError';
    this.status = status;
    this.code = code;
  }
}

const REQUIRED_MANIFEST_FIELDS = [
  'profileId', 'applicationId', 'version', 'status', 'publicModel',
  'roleTemplate', 'identityTemplate', 'allowedTools', 'memoryMode',
  'allowedMessageRoles', 'limits',
];

/**
 * A manifest "must be immutable for a deployed version" (plan, §Profile model),
 * so it is frozen on load — a later bug that mutates one cannot silently widen
 * the tool list or limits for every subsequent request sharing the object.
 */
function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) freezeDeep(v);
  }
  return value;
}

function validateManifest(manifest, source) {
  const missing = REQUIRED_MANIFEST_FIELDS.filter(f => manifest[f] === undefined);
  if (missing.length > 0) {
    throw new Error(`Profile manifest ${source} is missing: ${missing.join(', ')}`);
  }
  if (manifest.allowedMessageRoles.some(r => r === 'system' || r === 'developer')) {
    // A manifest could otherwise re-open the hole core/message-policy.js closes.
    throw new Error(`Profile manifest ${source} may not permit system/developer roles`);
  }
  return manifest;
}

function loadManifests(dir = PROFILES_DIR) {
  const byId = new Map();
  let entries;
  try {
    entries = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch {
    return byId; // no profiles defined yet is a valid state, not an error
  }
  for (const file of entries) {
    const source = path.join(dir, file);
    const manifest = validateManifest(JSON.parse(fs.readFileSync(source, 'utf8')), file);
    byId.set(manifest.profileId, freezeDeep(manifest));
  }
  return byId;
}

/**
 * Entitlements as UAI reports them. Read only from `req.uai` — never from a
 * header, and never defaulted to "allow" when the field is absent.
 */
function entitlementsFor(uai) {
  const list = uai && uai.applicationEntitlements;
  return Array.isArray(list) ? list : null;
}

class ProfileResolver {
  constructor({ dir = PROFILES_DIR, logger } = {}) {
    this.logger = logger;
    this.manifests = loadManifests(dir);
  }

  list() {
    return [...this.manifests.values()];
  }

  /**
   * @returns {object|null} the active manifest, or null when the caller named
   *          no profile (use-case path).
   * @throws  {ProfileError} when a profile is named but cannot be activated.
   */
  resolve(req) {
    const headers = (req && req.headers) || {};
    const requested = String(headers[PROFILE_HEADER] || '').trim();
    const requestedApp = String(headers[APPLICATION_HEADER] || '').trim();

    if (!requested) {
      if (requestedApp) {
        // An application without a profile cannot select behaviour, so
        // honouring it would be pretending to do something.
        throw new ProfileError(
          `${APPLICATION_HEADER} requires ${PROFILE_HEADER}.`,
          { status: 400, code: 'profile_required' },
        );
      }
      return null;
    }

    const manifest = this.manifests.get(requested);
    if (!manifest) {
      throw new ProfileError(`Unknown profile '${requested}'.`,
        { status: 400, code: 'profile_not_found' });
    }
    if (manifest.status !== 'active') {
      throw new ProfileError(`Profile '${requested}' is not active.`,
        { status: 403, code: 'profile_not_active' });
    }

    // The header may only *narrow* to the manifest's own application; it can
    // never nominate a different one.
    if (requestedApp && requestedApp !== manifest.applicationId) {
      throw new ProfileError(
        `Profile '${requested}' does not belong to application '${requestedApp}'.`,
        { status: 403, code: 'profile_application_mismatch' },
      );
    }

    const entitlements = entitlementsFor(req.uai);
    if (entitlements === null) {
      // Fail closed when the gateway tells us nothing. This was every request
      // until auth-gateway shipped `8894492 feat(auth): publish application
      // identity and profile entitlements from UAI`, deployed 2026-09-09.
      // Verified live 2026-09-10: a profile request now reaches the
      // entitlement comparison below and returns profile_not_entitled, so
      // this branch means a real gateway outage or an unentitled credential
      // type — not "the feature does not exist yet".
      throw new ProfileError(
        'Profile activation is not available for this credential.',
        { status: 403, code: 'entitlements_unavailable' },
      );
    }
    if (!entitlements.includes(manifest.profileId)
        && !entitlements.includes(`${manifest.applicationId}:${manifest.profileId}`)) {
      throw new ProfileError(
        `This credential is not entitled to profile '${requested}'.`,
        { status: 403, code: 'profile_not_entitled' },
      );
    }

    return manifest;
  }
}

module.exports = {
  ProfileResolver,
  ProfileError,
  PROFILE_HEADER,
  APPLICATION_HEADER,
  loadManifests,
  validateManifest,
  entitlementsFor,
};
