'use strict';

/**
 * Identify a credential without disclosing it.
 *
 * "Which account key is the router actually using?" had no safe answer: the
 * adapters read OPENAI_API_KEY / ANTHROPIC_API_KEY from process.env at load,
 * the value arrives via dotenvx from .env.production, and nothing logged
 * anything about it — so a key that authenticates but belongs to an empty
 * account looked identical to every other failure.
 *
 * The fingerprint is the first 10 hex chars of SHA-256(value). That is the
 * same digest `supabase secrets list` prints, so the router's key can be
 * compared directly with an Edge Function secret ("is this the same
 * account?") without either value ever being printed. The visible prefix is
 * only the provider's public key-type marker (`sk-proj-`, `sk-ant-api03-`),
 * never any of the secret body.
 */

const crypto = require('node:crypto');

/** Env var and default endpoint per vendor, matching each adapter. */
const VENDOR_CREDENTIALS = {
  openai:    { keyVar: 'OPENAI_API_KEY',    baseVar: 'OPENAI_BASE_URL',    defaultBase: 'https://api.openai.com/v1' },
  anthropic: { keyVar: 'ANTHROPIC_API_KEY', baseVar: 'ANTHROPIC_BASE_URL', defaultBase: 'https://api.anthropic.com/v1' },
  minimax:   { keyVar: 'MINIMAX_API_KEY',   baseVar: 'MINIMAX_BASE_URL',   defaultBase: 'https://api.minimax.io/v1' },
};

function fingerprint(value) {
  if (typeof value !== 'string' || value.trim() === '') return { set: false };
  const v = value.trim();
  const typeMarker = (v.match(/^(sk-(?:proj|ant-api\d+|svcacct|admin)?-?)/) || [''])[0];
  return {
    set: true,
    length: v.length,
    type: typeMarker || null,
    fp: crypto.createHash('sha256').update(v).digest('hex').slice(0, 10),
    // A key with stray whitespace or quotes is a classic dotenv mistake: it
    // authenticates nowhere and looks set everywhere.
    suspicious: v !== value || /^["']|["']$/.test(v) || undefined,
  };
}

/** Endpoint host only (no path/query), safe to log. */
function endpointOf(baseUrl) {
  try { return new URL(baseUrl).origin; } catch { return 'invalid-url'; }
}

/**
 * Summary of every vendor credential in `env`. Safe for info-level logs:
 * no key material, no account ids — fingerprint, length and endpoint only.
 */
function describeVendorCredentials(env = process.env) {
  const out = {};
  for (const [vendor, cfg] of Object.entries(VENDOR_CREDENTIALS)) {
    const base = env[cfg.baseVar] || cfg.defaultBase;
    out[vendor] = {
      key_var: cfg.keyVar,
      ...fingerprint(env[cfg.keyVar]),
      endpoint: endpointOf(base),
      endpoint_source: env[cfg.baseVar] ? cfg.baseVar : 'default',
    };
  }
  return out;
}

module.exports = { fingerprint, describeVendorCredentials, VENDOR_CREDENTIALS, endpointOf };
