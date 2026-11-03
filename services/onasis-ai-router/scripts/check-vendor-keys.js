#!/usr/bin/env node
'use strict';

/**
 * Which key is each cloud adapter using, and what does the provider say about it?
 *
 * Run it with EXACTLY the environment the service gets — copy the dotenvx
 * flags from the unit's ExecStart (`systemctl cat onasis-ai-router`), since
 * they differ between dotenvx versions (`--ops-off` is unknown to some):
 *
 *   cd /opt/lanonasis/shared_services/onasis-agent-haven/services/onasis-ai-router
 *   dotenvx run --no-armor -f .env.production -- node scripts/check-vendor-keys.js
 *
 * Nothing here is a second source of truth: the model, base URL and chat path
 * for each probe are read from the same env vars, with the same defaults, the
 * router itself uses (VENDOR_REGISTRY + the adapters). A probe that tested a
 * different model or path than production would answer a different question.
 *
 * For each vendor it prints the key fingerprint (sha256 prefix — compare with
 * `supabase secrets list`), the endpoint, and two probes:
 *   auth    GET /models — succeeds for any VALID key, even with zero credit
 *   billing a 1-token completion — fails when the account is out of credit
 *
 * Verdicts: OK | NO_CREDIT (key valid, account empty) | AUTH_REJECTED (key
 * wrong/revoked) | MODEL_NOT_FOUND (configured model retired/unknown) | NOT_SET | UNREACHABLE. Exit code 0 only when every
 * configured vendor is OK. Never prints key material.
 *
 *   --json   machine-readable output
 */

const { describeVendorCredentials, VENDOR_CREDENTIALS } = require('../core/credential-fingerprint');

const asJson = process.argv.includes('--json');
const TIMEOUT_MS = 15000;

const BILLING_RE = /no credits remaining|insufficient[_ ]quota|credit balance is too low|billing|payment required|exceeded your current quota/i;

async function call(url, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, text: text.slice(0, 300) };
  } catch (e) {
    return { status: 0, text: e.message };
  } finally {
    clearTimeout(t);
  }
}

// The exact chat paths and models the adapters send — same env vars, same
// defaults (vendors/<name>/adapter.js, vendors/index.js VENDOR_REGISTRY).
const CHAT_PATHS = {
  openai:    () => process.env.OPENAI_CHAT_PATH || '/chat/completions',
  anthropic: () => process.env.ANTHROPIC_CHAT_PATH || '/messages',
  minimax:   () => process.env.MINIMAX_CHAT_PATH || '/chat/completions',
};

function routerModel(vendor) {
  try {
    const { VENDOR_REGISTRY } = require('../vendors');
    return VENDOR_REGISTRY[vendor]?.models?.speed || null;
  } catch {
    return null;
  }
}

function requestsFor(vendor, key, base) {
  const model = routerModel(vendor);
  const body = JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
  if (vendor === 'anthropic') {
    const headers = { 'x-api-key': key, 'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01', 'content-type': 'application/json' };
    return { model, auth: [`${base}/models`, { headers }], billing: [`${base}${CHAT_PATHS.anthropic()}`, { method: 'POST', headers, body }] };
  }
  const headers = { Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  return {
    model,
    auth: vendor === 'openai' ? [`${base}/models`, { headers }] : null,
    billing: [`${base}${CHAT_PATHS[vendor]()}`, { method: 'POST', headers, body }],
  };
}

function verdict(auth, billing) {
  const all = [auth, billing].filter(Boolean);
  if (all.every((r) => r.status === 0)) return 'UNREACHABLE';
  if (all.some((r) => r.status === 401 || r.status === 403)) return 'AUTH_REJECTED';
  // Key and billing may be fine while the configured model no longer exists
  // (retired) — the router would fail every call on that vendor all the same.
  if (billing && (billing.status === 404 || /model[^"]{0,40}(not[ _]found|does not exist|not supported)|not_found_error/i.test(billing.text))) {
    return 'MODEL_NOT_FOUND';
  }
  if (billing && (billing.status === 402 || billing.status === 429 || BILLING_RE.test(billing.text))) {
    return BILLING_RE.test(billing.text) || billing.status === 402 ? 'NO_CREDIT' : 'RATE_LIMITED';
  }
  // MiniMax answers 200 with an in-body error envelope (see its adapter).
  if (billing && billing.status === 200 && /"status_code"\s*:\s*[1-9]/.test(billing.text)) {
    return /balance|quota|insufficient/i.test(billing.text) ? 'NO_CREDIT' : 'AUTH_REJECTED';
  }
  if (billing && billing.status >= 200 && billing.status < 300) return 'OK';
  return `HTTP_${billing ? billing.status : auth.status}`;
}

(async () => {
  const creds = describeVendorCredentials();
  const report = {};
  for (const [vendor, info] of Object.entries(creds)) {
    if (!info.set) { report[vendor] = { ...info, verdict: 'NOT_SET' }; continue; }
    const cfg = VENDOR_CREDENTIALS[vendor];
    const base = (process.env[cfg.baseVar] || cfg.defaultBase).replace(/\/+$/, '');
    const reqs = requestsFor(vendor, process.env[cfg.keyVar].trim(), base);
    const auth = reqs.auth ? await call(...reqs.auth) : null;
    const billing = await call(...reqs.billing);
    report[vendor] = {
      ...info,
      model: reqs.model,
      auth_status: auth ? auth.status : 'n/a',
      billing_status: billing.status,
      verdict: verdict(auth, billing),
      // Provider error text is not secret, and it is the evidence.
      detail: billing.status >= 200 && billing.status < 300 && !/"status_code"\s*:\s*[1-9]/.test(billing.text)
        ? undefined
        // Providers echo a masked key ("sk-proj-*ummy"); drop even that.
        : billing.text.replace(/sk-[\w-]*\*+[\w-]*/g, '[key]').replace(/\s+/g, ' ').slice(0, 180),
    };
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const [vendor, r] of Object.entries(report)) {
      console.log(`\n${vendor.toUpperCase()}  →  ${r.verdict}`);
      console.log(`  key:       ${r.key_var} ${r.set ? `set · ${r.type || 'unknown-type'} · len ${r.length} · fp ${r.fp}${r.suspicious ? ' · ⚠ whitespace/quotes' : ''}` : 'NOT SET'}`);
      console.log(`  endpoint:  ${r.endpoint} (${r.endpoint_source})`);
      if (r.model) console.log(`  model:     ${r.model}  (what the router sends; override with ${vendor.toUpperCase()}_FAST_MODEL)`);
      if (r.set) console.log(`  probes:    auth=${r.auth_status} billing=${r.billing_status}`);
      if (r.detail) console.log(`  provider:  ${r.detail}`);
    }
    console.log('\nCompare fp with `supabase secrets list` (SHA256 column, first 10 chars) to see whether');
    console.log('two services share one account.');
  }

  const bad = Object.values(report).some((r) => r.set && r.verdict !== 'OK');
  process.exit(bad ? 1 : 0);
})();
