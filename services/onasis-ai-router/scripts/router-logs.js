#!/usr/bin/env node
'use strict';

/**
 * router-logs — summarise onasis-ai-router health from its journald logs.
 *
 * The service logs structured JSON, one object per line, which is precise but
 * unreadable at a glance. This aggregates the lines that actually indicate a
 * problem so you can answer "is anything broken, and which vendor?" in one
 * command instead of eyeballing a raw journal.
 *
 * Usage:
 *   node scripts/router-logs.js                 # last 1 hour
 *   node scripts/router-logs.js --since "24h"   # any systemd time spec
 *   node scripts/router-logs.js --since "2026-08-19 12:00"
 *   node scripts/router-logs.js --tail          # follow live, decoded
 *   node scripts/router-logs.js --json          # machine-readable summary
 *
 * Exit codes (for cron/monitoring):
 *   0  healthy — no chain-exhaustion errors
 *   1  degraded — some vendors failing but requests still succeeded
 *   2  failing — at least one "All vendors in chain failed"
 */

const { execFileSync, spawn } = require('child_process');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const UNIT = process.env.ROUTER_UNIT || 'onasis-ai-router.service';
const SINCE = valOf('--since', '1 hour ago');

// ── live follow ────────────────────────────────────────────────────────────
if (has('--tail')) {
  const p = spawn('journalctl', ['-u', UNIT, '-f', '-o', 'cat'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const rl = require('readline').createInterface({ input: p.stdout });
  rl.on('line', (line) => {
    const e = parse(line);
    if (!e) { console.log(line); return; }
    const tag = e.level === 'error' ? 'ERR ' : e.level === 'warn' ? 'WARN' : 'info';
    const bits = [e.vendorId, e.useCase, e.status, e.duration_ms && `${e.duration_ms}ms`]
      .filter(Boolean).join(' ');
    console.log(`${tag} ${e.message}${bits ? '  [' + bits + ']' : ''}${e.error ? '  ' + String(e.error).slice(0, 140) : ''}`);
  });
  return;
}

function parse(line) {
  const i = line.indexOf('{');
  if (i < 0) return null;
  try { return JSON.parse(line.slice(i)); } catch { return null; }
}

let raw = '';
try {
  raw = execFileSync('journalctl', ['-u', UNIT, '--since', SINCE, '-o', 'cat', '--no-pager'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  console.error(`Could not read journal for ${UNIT}: ${err.message}`);
  process.exit(2);
}

const vendorFail = new Map();   // vendorId -> {count, lastError, kinds:Map}
const circuitOpen = new Map();  // vendorId -> count
const chainFail = new Map();    // useCase  -> count
const completed = [];           // {status, duration_ms, useCase}
const toolLeaks = [];
const restarts = [];

for (const line of raw.split('\n')) {
  if (/Started .*Onasis AI Service Router|Stopping .*Onasis AI/.test(line)) restarts.push(line.slice(0, 60));
  const e = parse(line);
  if (!e || !e.message) continue;

  if (e.message.startsWith('Vendor failed')) {
    const v = e.vendorId || 'unknown';
    const s = vendorFail.get(v) || { count: 0, lastError: '', kinds: new Map() };
    s.count++;
    s.lastError = String(e.error || '').slice(0, 200);
    s.kinds.set(classify(s.lastError), (s.kinds.get(classify(s.lastError)) || 0) + 1);
    vendorFail.set(v, s);
  } else if (e.message.startsWith('Vendor circuit open')) {
    circuitOpen.set(e.vendorId, (circuitOpen.get(e.vendorId) || 0) + 1);
  } else if (e.message.startsWith('All vendors in chain failed')) {
    chainFail.set(e.useCase || 'unknown', (chainFail.get(e.useCase || 'unknown') || 0) + 1);
  } else if (e.message === 'AI request completed') {
    completed.push({ status: e.status, duration_ms: e.duration_ms });
  } else if (/re-emitted a tool call/.test(e.message)) {
    toolLeaks.push(e.tools ? e.tools.join(',') : '?');
  }
}

/** Turn a raw upstream error into an actionable category. */
function classify(err) {
  const s = err.toLowerCase();
  if (/no credits|credit balance|insufficient_quota|402/.test(s)) return 'OUT OF CREDIT — billing action needed';
  if (/model use not permitted|no api key|unauthorized|401|403|expired/.test(s)) return 'AUTH/CREDENTIAL — re-auth needed';
  if (/not found|404/.test(s)) return 'MODEL/ROUTE NOT FOUND — config drift';
  if (/aborted|timeout|timed out/.test(s)) return 'TIMEOUT — too slow or hung';
  if (/rate limit|429/.test(s)) return 'RATE LIMITED';
  if (/econnrefused|enotfound|socket|network/.test(s)) return 'UNREACHABLE — service down?';
  return 'other';
}

const ok = completed.filter((c) => c.status === 200).length;
const bad = completed.filter((c) => c.status && c.status !== 200).length;
const durs = completed.map((c) => c.duration_ms).filter((n) => typeof n === 'number').sort((a, b) => a - b);
const pct = (p) => (durs.length ? durs[Math.min(durs.length - 1, Math.floor(durs.length * p))] : null);

const summary = {
  unit: UNIT,
  since: SINCE,
  requests: { ok, failed: bad, total: completed.length },
  latency_ms: { p50: pct(0.5), p95: pct(0.95), max: durs[durs.length - 1] ?? null },
  vendor_failures: [...vendorFail].map(([v, s]) => ({
    vendor: v, count: s.count, kinds: [...s.kinds].map(([k, n]) => `${k} (${n})`), lastError: s.lastError,
  })),
  circuit_open_skips: [...circuitOpen].map(([v, n]) => ({ vendor: v, count: n })),
  chain_exhausted: [...chainFail].map(([u, n]) => ({ useCase: u, count: n })),
  tool_call_leaks_suppressed: toolLeaks.length,
  restarts: restarts.length,
};

if (has('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const line = (s = '') => console.log(s);
  line(`onasis-ai-router — last: ${SINCE}`);
  line('='.repeat(64));
  line(`requests   ${ok} ok / ${bad} failed  (${completed.length} logged)`);
  if (durs.length) line(`latency    p50 ${summary.latency_ms.p50}ms · p95 ${summary.latency_ms.p95}ms · max ${summary.latency_ms.max}ms`);
  if (restarts.length) line(`restarts   ${restarts.length}`);
  line();

  if (!vendorFail.size && !chainFail.size) {
    line('No vendor failures. Nothing needs attention.');
  }

  if (vendorFail.size) {
    line('VENDOR FAILURES  (which endpoint is failing, and why)');
    line('-'.repeat(64));
    for (const [v, s] of [...vendorFail].sort((a, b) => b[1].count - a[1].count)) {
      line(`  ${v.padEnd(14)} ${String(s.count).padStart(4)}x`);
      for (const [k, n] of s.kinds) line(`      → ${k}  ×${n}`);
      if (s.lastError) line(`      last: ${s.lastError.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
    line();
  }

  if (circuitOpen.size) {
    line('CIRCUIT BREAKER OPEN  (vendor tripped out, being skipped)');
    line('-'.repeat(64));
    for (const [v, n] of circuitOpen) line(`  ${v.padEnd(14)} skipped ${n}x`);
    line();
  }

  if (chainFail.size) {
    line('!! CHAIN EXHAUSTED — users got errors. THIS NEEDS ATTENTION.');
    line('-'.repeat(64));
    for (const [u, n] of chainFail) line(`  ${u.padEnd(22)} ${n}x — every vendor for this use case failed`);
    line();
  }

  if (toolLeaks.length) {
    line(`tool-call leaks suppressed: ${toolLeaks.length} (model re-emitted a tool call instead of prose)`);
    line();
  }

  line('Verdict: ' + (chainFail.size ? 'FAILING — users are seeing errors'
    : vendorFail.size ? 'DEGRADED — fallbacks absorbing failures, users still served'
    : 'HEALTHY'));
}

process.exit(chainFail.size ? 2 : vendorFail.size ? 1 : 0);
