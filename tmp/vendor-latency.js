#!/usr/bin/env node
/**
 * Provider Latency Benchmark
 *
 * Measures latency (ms) for every active AI vendor via their healthCheck()
 * adapters, plus end-to-end latency against the live router.
 *
 * Vendor list is read dynamically from VENDOR_REGISTRY (vendors/index.js)
 * instead of a hardcoded list, so newly-registered vendors (e.g. openclaw,
 * hermes) are benchmarked automatically without editing this script.
 *
 * Usage: node tmp/vendor-latency.js [--iterations N] [--include-stubs]
 *   N = number of rounds (default 5, min 1, max 20)
 *   --include-stubs = also benchmark vendors with status: 'stub' (not
 *     selected by the router today, e.g. deepseek/hermes)
 */

const path = require("path");
const VENDORS_ROOT = path.join(
  __dirname,
  "../services/onasis-ai-router/vendors",
);
const { VENDOR_REGISTRY } = require(VENDORS_ROOT);
const INCLUDE_STUBS = process.argv.includes("--include-stubs");
const VENDOR_NAMES = Object.entries(VENDOR_REGISTRY)
  .filter(([, cfg]) => cfg.status === "active" || INCLUDE_STUBS)
  .map(([id]) => id);
const PORT = 8000;
const BASE_URL = `http://localhost:${PORT}`;
// /api/v1/ai-chat resolves auth via the auth-gateway (core/ai-service-router.js
// authenticateRequest), which accepts X-API-Key. Source it from env — never hardcode.
const API_KEY = process.env.MEMORY_API_KEY || process.env.AI_ROUTER_API_KEY || "";
const ITERATIONS = process.argv
  .find((a) => a.startsWith("--iterations="))
  ?.split("=")[1]
  ? parseInt(
      process.argv.find((a) => a.startsWith("--iterations="))?.split("=")[1],
      10,
    )
  : 5;

// Helpers
function fmt(n) {
  if (n === null || n === undefined || !isFinite(n)) return "N/A";
  return `${n.toFixed(1)}ms`;
}

function stats(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0];
  const max = sorted[n - 1];
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const p95 = sorted[Math.floor(n * 0.95)] ?? max;
  return { min, max, mean, p95, count: n };
}

// Vendor health-check runner
async function benchmarkVendor(vendorName, iterations = 3) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Vendor: ${vendorName.toUpperCase()}`);
  console.log(`${"=".repeat(60)}`);

  try {
    const vendorModule = require(
      path.join(VENDORS_ROOT, vendorName, "adapter"),
    );
    if (typeof vendorModule.healthCheck !== "function") {
      console.log(`  WARN: No healthCheck() in adapter`);
      return null;
    }

    const results = [];
    for (let i = 0; i < iterations; i++) {
      const t0 = process.hrtime.bigint();
      let ok = false;
      try {
        ok = await vendorModule.healthCheck();
      } catch (e) {
        // network or other error
      }
      const elapsed = Number(process.hrtime.bigint() - t0) / 1_000_000;
      results.push({ elapsed, ok });
      console.log(`  [${i + 1}] ${fmt(elapsed)}  ${ok ? "OK" : "FAIL"}`);
    }

    const vals = results.map((r) => r.elapsed);
    const s = stats(vals);
    const okCount = results.filter((r) => r.ok).length;

    console.log(`\n  Summary (${results.length} samples, ${okCount} ok):`);
    console.log(`    min: ${fmt(s.min)}   max: ${fmt(s.max)}`);
    console.log(`    mean: ${fmt(s.mean)}   p95: ${fmt(s.p95)}`);

    return { vendor: vendorName, ...s, okRate: okCount / results.length };
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    return { vendor: vendorName, ok: false, error: e.message };
  }
}

// Router end-to-end benchmark
async function benchmarkRouter(iterations = 3) {
  console.log(`\n${"=".repeat(60)}`);
  console.log("END-TO-END: Router (POST /api/v1/ai-chat)");
  console.log(`${"=".repeat(60)}`);

  if (!API_KEY) {
    console.log(
      "  WARN: no MEMORY_API_KEY/AI_ROUTER_API_KEY in env — requests will be unauthenticated (expect 401)",
    );
  }

  const payload = {
    messages: [{ role: "user", content: "Say hello in 3 words." }],
    use_case: "ask-ai",
  };

  const results = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    let ok = false;
    let code = 0;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/ai-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      code = res.status;
      ok = res.ok;
      await res.text();
    } catch (e) {
      code = e.code === "TIMEOUT" ? 408 : 0;
    }
    const elapsed = Number(process.hrtime.bigint() - t0) / 1_000_000;
    results.push({ elapsed, ok, code });
    console.log(
      `  [${i + 1}] ${fmt(elapsed)}  status=${code}  ${ok ? "OK" : "FAIL"}`,
    );
  }

  const vals = results.map((r) => r.elapsed);
  const s = stats(vals);
  console.log(
    `\n  Summary (${results.length} samples, ${results.filter((r) => r.ok).length} ok):`,
  );
  console.log(`    min: ${fmt(s.min)}   max: ${fmt(s.max)}`);
  console.log(`    mean: ${fmt(s.mean)}   p95: ${fmt(s.p95)}`);

  return {
    vendor: "router (e2e)",
    ...s,
    okRate: results.filter((r) => r.ok).length / results.length,
  };
}

// Main
async function main() {
  console.log(
    `\n+------------------------------------------------------------+`,
  );
  console.log("|  Onasis AI Vendor Latency Benchmark                        |");
  console.log(
    `|  Iterations: ${ITERATIONS}  |  Host: localhost:${PORT}                  |`,
  );
  console.log(`+------------------------------------------------------------+`);

  // Check router is up
  try {
    const t0 = process.hrtime.bigint();
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(5_000) });
    await res.text();
    console.log(
      `\nRouter alive: ${fmt(Number(process.hrtime.bigint() - t0) / 1_000_000)}`,
    );
  } catch {
    console.error("\nRouter not reachable at " + BASE_URL);
    console.error("  Make sure the ai-router service is running.");
    process.exit(1);
  }

  // Benchmark each vendor
  const vendorResults = [];
  for (const vendor of VENDOR_NAMES) {
    const r = await benchmarkVendor(vendor, Math.min(ITERATIONS, 5));
    if (r) vendorResults.push(r);
  }

  // End-to-end
  const e2e = await benchmarkRouter(ITERATIONS);
  if (e2e) vendorResults.push(e2e);

  // Final table
  console.log(`\n${"=".repeat(60)}`);
  console.log("  FINAL TABLE");
  console.log(`${"=".repeat(60)}`);
  console.log(
    `  ${"Vendor".padEnd(18)} ${"Min".padEnd(10)} ${"Max".padEnd(10)} ${"Mean".padEnd(10)} ${"P95".padEnd(10)} ${"OK Rate"}`,
  );
  console.log(`  ${"-".repeat(58)}`);
  for (const r of vendorResults) {
    if (r.error) {
      console.log(`  ${r.vendor.padEnd(18)} ${"ERROR".padEnd(58)}`);
    } else {
      console.log(
        `  ${r.vendor.padEnd(18)} ` +
          `${fmt(r.min).padEnd(10)} ` +
          `${fmt(r.max).padEnd(10)} ` +
          `${fmt(r.mean).padEnd(10)} ` +
          `${fmt(r.p95).padEnd(10)} ` +
          `${(r.okRate * 100).toFixed(0)}%`,
      );
    }
  }
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
