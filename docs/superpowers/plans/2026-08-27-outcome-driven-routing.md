# Outcome-Driven Routing Implementation Plan

> ## Status: COMPLETE (Phases 1–3) — as-built runbook
>
> **Last verified: 2026-10-11.** All twelve tasks landed on 2026-08-27. This
> document is **not open work** — it is the reference for what was built, why each
> decision was made, and how to verify it still holds. If you have been handed
> this to *implement*, check "As-built record" first: most of it is done.
>
> **Two things to know before you touch this code:**
>
> 1. **The structure has eroded.** `core/ai-service-router.js` was 688 lines when
>    this plan completed; it is **1638 lines** as of 2026-10-07. The modules below
>    still exist and are still used, but new logic has been accreting back into
>    the router. See "Standing invariants" — this is the failure mode this plan
>    existed to prevent.
> 2. **Every path in this document was hardcoded to one host.** Command blocks now
>    use `$REPO`, because `/opt/lanonasis/shared_services/...` does not exist on
>    this host — a `cd` into it fails silently and everything after runs in the
>    wrong directory. See "Known path drift" at the end for the other files that
>    still carry it.
>
> Every task below is retained verbatim as the record of *how* each piece was
> built, including the reasoning that is not recoverable from the code.

## Read this first — which document answers what

| You need… | Read |
|---|---|
| Why this exists; the four defects; the measured evidence | `docs/superpowers/specs/2026-08-27-outcome-driven-routing-design.md` |
| What to change, step by step; the reasoning behind each step | **this file** |
| What is broken, what is fixed, what is still open | `docs/superpowers/specs/2026-08-27-open-findings-tracker.md` |
| Streaming, caller identity, the three things called "persona" | `docs/superpowers/specs/2026-08-27-streaming-and-identity-notes.md` |
| How the router behaves as a *service* (routes, vendors, ops) | `services/onasis-ai-router/CLAUDE.md` |


**Goal:** Make `onasis-ai-router` dispatch on observed vendor outcomes instead of on declared config, so a vendor returning an error string inside an HTTP 200 no longer short-circuits the fallback chain.

**Architecture:** Decompose the 1726-line `core/ai-service-router.js` into focused modules (pure moves, no behaviour change), then add a vendor response contract that turns unusable 200s into throws, then replace the flat circuit breaker with outcome-typed cooldowns and latency-aware chain ordering.

**Tech Stack:** Node.js ≥22, CommonJS, Express 4, `node:test` + `node:assert/strict`, winston, undici. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-outcome-driven-routing-design.md`

**Scope:** This plan covers **Phases 1–3** of the spec (§12): module extraction, response contract, typed scoreboard. Phases 4 (capability health) and 5 (lane typing) follow in a second plan — Phase 3 changes the scoreboard API that Phase 4 consumes, so specifying Phase 4's code now would be speculative. Phases 1–3 deliver working, independently valuable software: Phase 2 removes the user-visible symptom, Phase 3 stops it recurring.

## Global Constraints

- **Working directory — set `$REPO` once, use it everywhere.** Every command block
  below is written as `cd "$REPO"`, because this path is **host-dependent** and
  hardcoding one host's layout is what made the original version unusable:

  ```bash
  # Development / archive host (this machine). Git root:
  export REPO=/opt/lanonasis/secondary-service/onasis-agent-haven
  # Production host — the layout this document was originally written against:
  #   export REPO=/opt/lanonasis/shared_services/onasis-agent-haven
  ```

  Service directory is `$REPO/services/onasis-ai-router`. All `git` commands run
  from the git root; all `npm` commands from the service directory.

  > **Corrected 2026-10-11.** The original text hardcoded
  > `/opt/lanonasis/shared_services/onasis-agent-haven`. That tree **does not exist
  > on this host at all** (the service is not deployed here), so an agent following
  > it verbatim would `cd` into nothing — the failure is silent and every subsequent
  > command then runs in the wrong directory. It is not "stale" so much as
  > **host-specific**: it may well still be correct on the production host. Hence a
  > variable rather than a second hardcoded path. The same defect appears in
  > `README.md`, `services/onasis-ai-router/README.md`,
  > `services/onasis-ai-router/docs/VENDOR-CONFIGURATION.md`, `CLAUDE.md`, and
  > `infra/pm2/onasis-ai-router.ecosystem.js` — see "Known path drift" at the end.
  > The sibling `shared_services/onasis_ai_router/` directory that `CLAUDE.md`
  > tracked as open item 4 has since been removed; that open item is resolved.
- **Branch:** `refactor/outcome-driven-routing` (already created, spec committed as `0e22554`).
- **Node ≥22.19.0**, CommonJS (`require`/`module.exports`) — this service is not ESM.
- **No new runtime dependencies.** Existing in-memory patterns (Map-based caches, breaker state) are the precedent.
- **Privacy invariant — never regress:** vendor ids, model names, endpoints and API keys must never appear in client responses or in info-level logs. Existing `sanitizeVendorResponse()` is the enforcement point.
- **Do not touch** the tool-call id-zipping logic (`core/ai-service-router.js` ~lines 300–410, commit `5eed764`) or the `supabase-edge` deprecation.
- **Tests must be deterministic and free** — use fakes, never live vendors. Live probes stay in manual scripts.
- **Never run `git checkout`/`reset` on `/opt/paperclip-runtime`** (unrelated service on this host with an uncommitted hotfix).
- **Deploy/restart after any phase lands:**
  ```bash
  export $(grep DOTENV_PRIVATE_KEY_PRODUCTION \
    /opt/lanonasis/secondary-service/onasis-agent-haven/services/onasis-ai-router/.env.keys | xargs)
  systemctl restart onasis-ai-router
  ```
  Confirm it came back before walking away:
  `systemctl is-active onasis-ai-router && command curl -s http://127.0.0.1:8000/health`
  (use `command curl`, not bare `curl` — a shell wrapper on this host rewrites plain
  `curl` output into a schema stub instead of running the request).

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `core/vendor-scoreboard.js` | Circuit state, outcome classification, latency stats, chain filtering |
| `core/memory-prefetch.js` | Memory brief prefetch, cache, in-flight dedup |
| `core/middleware.js` | `authenticateRequest`, `trackUsage` Express middleware |
| `core/tool-loop.js` | Tool-call extraction, execution, follow-up pass |
| `core/chain-executor.js` | Vendor chain walk, per-vendor budgets, outcome reporting |
| `vendors/_shared/response-contract.js` | `assertUsableCompletion`, `VendorContractError` |
| `test/response-contract.test.js` | Contract unit tests |
| `test/vendor-scoreboard.test.js` | Scoreboard unit tests (injected clock) |
| `test/chain-executor.test.js` | Chain fall-through integration tests (fake adapters) |

**Modified:**

| File | Change |
|---|---|
| `core/ai-service-router.js` | Shrinks from 1726 → ~200 lines; composes the modules above |
| `vendors/index.js` | `errorSentinels` per vendor; export `VENDOR_REGISTRY` unchanged |
| `vendors/*/adapter.js` | Each `chat()` returns through `assertUsableCompletion()` |
| `package.json` | `test` script discovers `test/` |

**Boundary rule:** the tool implementations (`toolMemorySearch`, `toolCodeRead`, …) move to `core/tools/` only if `core/tool-loop.js` exceeds ~400 lines after extraction. Task 4 decides based on the actual line count — do not split preemptively.

---

## Tasks 1–5: Extraction (Phase 1)

These are **pure moves**. TDD does not apply — there is no new behaviour to drive out. The verification is that the existing suite passes unchanged, which makes it a characterization check. Move code verbatim; resist the urge to improve it. Any behaviour change here is a bug.

### Task 1: Extract the circuit breaker into `core/vendor-scoreboard.js`

**Files:**
- Create: `core/vendor-scoreboard.js`
- Modify: `core/ai-service-router.js` (remove lines ~413–441, `_vendorBreaker` init at ~line 56)
- Test: `test/vendor-scoreboard.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `class VendorScoreboard` with `isOpen(vendorId): boolean`, `recordFailure(vendorId): void`, `recordSuccess(vendorId): void`. Constructor takes `{ now }` where `now` is a `() => number` clock defaulting to `Date.now`. Tasks 9–12 extend this class; Task 12 consumes it from `chain-executor`.

- [ ] **Step 1: Write the characterization test**

Create `test/vendor-scoreboard.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { VendorScoreboard } = require('../core/vendor-scoreboard');

test('circuit opens after threshold consecutive failures', () => {
  let clock = 1000;
  const sb = new VendorScoreboard({ now: () => clock });
  assert.equal(sb.isOpen('openclaw'), false);
  sb.recordFailure('openclaw');
  sb.recordFailure('openclaw');
  assert.equal(sb.isOpen('openclaw'), false, 'below threshold of 3');
  sb.recordFailure('openclaw');
  assert.equal(sb.isOpen('openclaw'), true, 'at threshold of 3');
});

test('circuit closes after the cooldown elapses', () => {
  let clock = 1000;
  const sb = new VendorScoreboard({ now: () => clock });
  sb.recordFailure('x'); sb.recordFailure('x'); sb.recordFailure('x');
  assert.equal(sb.isOpen('x'), true);
  clock += 30001;
  assert.equal(sb.isOpen('x'), false, 'past the 30s cooldown');
});

test('success decays the failure count by 2', () => {
  let clock = 1000;
  const sb = new VendorScoreboard({ now: () => clock });
  sb.recordFailure('y'); sb.recordFailure('y'); sb.recordFailure('y');
  assert.equal(sb.isOpen('y'), true);
  sb.recordSuccess('y');
  assert.equal(sb.isOpen('y'), false, 'failCount decayed 3 -> 1');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from the service directory:
```bash
node --test test/vendor-scoreboard.test.js
```
Expected: FAIL — `Cannot find module '../core/vendor-scoreboard'`.

- [ ] **Step 3: Create the module by moving the existing logic verbatim**

Create `core/vendor-scoreboard.js`. The bodies come from `core/ai-service-router.js` lines 415–441 — copy the logic and the existing comments, changing only `this._vendorBreaker` to `this._state`:

```js
'use strict';

/**
 * Per-vendor circuit breaker and outcome statistics.
 *
 * Extracted verbatim from core/ai-service-router.js (2026-08-27). Behaviour is
 * unchanged in this commit; outcome typing and latency-aware ordering arrive in
 * later tasks of the same plan.
 *
 * The clock is injectable so cooldown behaviour is unit-testable without sleeps.
 */
class VendorScoreboard {
  constructor({ now = Date.now } = {}) {
    this._now = now;
    // vendorId -> { failCount, lastFailedAt }
    this._state = new Map();
  }

  isOpen(vendorId) {
    const state = this._state.get(vendorId);
    if (!state) return false;
    const COOLDOWN_MS = parseInt(process.env.VENDOR_CIRCUIT_COOLDOWN_MS || '30000', 10);
    const FAIL_THRESHOLD = parseInt(process.env.VENDOR_CIRCUIT_THRESHOLD || '3', 10);
    return state.failCount >= FAIL_THRESHOLD &&
           (this._now() - state.lastFailedAt) < COOLDOWN_MS;
  }

  recordFailure(vendorId) {
    const state = this._state.get(vendorId) || { failCount: 0, lastFailedAt: 0 };
    state.failCount += 1;
    state.lastFailedAt = this._now();
    this._state.set(vendorId, state);
  }

  recordSuccess(vendorId) {
    // Decay failure count on success instead of immediate reset.
    // This prevents flaky vendors (90% failure rate) from staying in rotation.
    const state = this._state.get(vendorId);
    if (!state) return;
    state.failCount = Math.max(0, state.failCount - 2);
    if (state.failCount === 0) {
      this._state.delete(vendorId);
    } else {
      this._state.set(vendorId, state);
    }
  }
}

module.exports = { VendorScoreboard };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test test/vendor-scoreboard.test.js
```
Expected: PASS, 3/3.

- [ ] **Step 5: Point the router at the new module**

In `core/ai-service-router.js`:
1. Add near the other requires at the top: `const { VendorScoreboard } = require('./vendor-scoreboard');`
2. Replace the constructor line `this._vendorBreaker = new Map();` with `this._scoreboard = new VendorScoreboard();`
3. Delete the three methods `_isCircuitOpen`, `_circuitFailure`, `_circuitSuccess` (lines ~415–441) and the `// ── Circuit Breaker ──` banner comment.
4. Replace the three call sites: `this._isCircuitOpen(` → `this._scoreboard.isOpen(`, `this._circuitSuccess(` → `this._scoreboard.recordSuccess(`, `this._circuitFailure(` → `this._scoreboard.recordFailure(`.

Verify no stragglers remain:
```bash
grep -n "_vendorBreaker\|_isCircuitOpen\|_circuitFailure\|_circuitSuccess" core/ai-service-router.js
```
Expected: no output.

- [ ] **Step 6: Update the test script to discover `test/`**

In `package.json`, change the `test` script to:
```json
"test": "node --test test-vendor-responsiveness.js test/*.test.js"
```

- [ ] **Step 7: Run the full suite**

```bash
npm test
```
Expected: PASS. The pre-existing `test-vendor-responsiveness.js` assertions must still pass — that is the characterization check for this pure move.

- [ ] **Step 8: Commit**

```bash
cd "$REPO"
git add services/onasis-ai-router/core/vendor-scoreboard.js \
        services/onasis-ai-router/test/vendor-scoreboard.test.js \
        services/onasis-ai-router/core/ai-service-router.js \
        services/onasis-ai-router/package.json
git commit -m "onasis-ai-router: extract circuit breaker to core/vendor-scoreboard.js

Pure move, no behaviour change. Adds an injectable clock so cooldown
behaviour is unit-testable without sleeps.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Extract memory prefetch into `core/memory-prefetch.js`

**Files:**
- Create: `core/memory-prefetch.js`
- Modify: `core/ai-service-router.js` (remove lines ~618–700, cache init at ~lines 55–57)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `class MemoryPrefetch` with `async brief(req, messages, body): Promise<string>` (returns `''` when disabled or on failure — never throws). Constructor: `new MemoryPrefetch({ apiBaseUrl, memorySearchPath, topK, timeoutMs, enabled, maxChars, logger })`.

- [ ] **Step 1: Move the code**

Create `core/memory-prefetch.js` containing, moved verbatim from `core/ai-service-router.js`: `prefetchMemoryBrief` (→ `brief`), `_executePrefetchFetch`, and the brief-formatting helper at ~line 690. Move the `prefetchCache` and `_prefetchInflight` Maps into the constructor as `this._cache` and `this._inflight`. Replace each `this.<config>` read with the constructor-injected equivalent.

There is no new behaviour, so there is no new unit test — `npm test` plus a live smoke check is the verification.

- [ ] **Step 2: Wire it into the router**

In `core/ai-service-router.js`:
1. `const { MemoryPrefetch } = require('./memory-prefetch');`
2. In the constructor, after the existing config reads:
```js
this._prefetch = new MemoryPrefetch({
  apiBaseUrl:        this.apiBaseUrl,
  memorySearchPath:  this.memorySearchPath,
  topK:              this.memoryPrefetchTopK,
  timeoutMs:         this.memoryPrefetchTimeoutMs,
  enabled:           this.prefetchEnabled,
  maxChars:          this.maxPrefetchChars,
  logger:            this.logger,
});
```
3. Delete `this.prefetchCache` and `this._prefetchInflight`.
4. Replace the call site at ~line 219 with `const prefetchBrief = await this._prefetch.brief(req, incomingMessages, body);`
5. Delete the moved methods.

- [ ] **Step 3: Verify nothing dangles**

```bash
grep -n "prefetchCache\|_prefetchInflight\|_executePrefetchFetch\|prefetchMemoryBrief" core/ai-service-router.js
```
Expected: no output.

- [ ] **Step 4: Run the full suite**

```bash
npm test
```
Expected: PASS.

- [ ] **Step 5: Live smoke check**

Prefetch is best-effort and swallows its own errors, so a broken wiring is silent. Confirm it still runs:

```bash
export $(grep DOTENV_PRIVATE_KEY_PRODUCTION .env.keys | xargs)
systemctl restart onasis-ai-router
sleep 3
curl -s -m 20 http://127.0.0.1:8000/health -o /dev/null -w '%{http_code}\n'
journalctl -u onasis-ai-router --since "1 min ago" --no-pager | grep -i "prefetch\|error" | tail -5
```
Expected: `200`, and no `Memory prefetch failed` beyond what was present before the change.

- [ ] **Step 6: Commit**

```bash
cd "$REPO"
git add services/onasis-ai-router/core/memory-prefetch.js \
        services/onasis-ai-router/core/ai-service-router.js
git commit -m "onasis-ai-router: extract memory prefetch to core/memory-prefetch.js

Pure move, no behaviour change. Cache and in-flight dedup move with it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract Express middleware into `core/middleware.js`

**Files:**
- Create: `core/middleware.js`
- Modify: `core/ai-service-router.js` (remove lines ~1444–1570)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createAuthMiddleware({ authGatewayUrl, authTimeoutMs, logger }) → (req, res, next)` and `createUsageTracker({ logger }) → (req, res, next)`. Both are factories returning Express middleware; they replace the class-property arrow functions so `this` is no longer captured.

- [ ] **Step 1: Move the code**

Create `core/middleware.js`. Move `authenticateRequest` (line ~1444) and `trackUsage` (line ~1509) verbatim, converting each class-property arrow function into a factory that closes over the config it needs. Keep the existing comments about the Redis auth cache TTL and the "hashing is not a security boundary" note — they explain non-obvious decisions.

Both continue to require `getAuthCache` from `./auth-cache` and `fetchWithRetry` from `../vendors/_shared/http-client`.

- [ ] **Step 2: Wire it into the router**

In `core/ai-service-router.js`:
1. `const { createAuthMiddleware, createUsageTracker } = require('./middleware');`
2. In the constructor:
```js
this.authenticateRequest = createAuthMiddleware({
  authGatewayUrl: this.authGatewayUrl,
  authTimeoutMs:  this.authTimeoutMs,
  logger:         this.logger,
});
this.trackUsage = createUsageTracker({ logger: this.logger });
```
Assigning to the same property names means the six `getRoutes()` call sites (lines ~1605–1712) need no edit.
3. Delete the two moved class properties.

- [ ] **Step 3: Run the full suite**

```bash
npm test
```
Expected: PASS.

- [ ] **Step 4: Live auth check**

Auth is on the hot path of every request; a break here takes the service down. Verify a request without credentials still gets a clean 401, not a 500:

```bash
export $(grep DOTENV_PRIVATE_KEY_PRODUCTION .env.keys | xargs)
systemctl restart onasis-ai-router
sleep 3
curl -s -m 10 -o /dev/null -w '%{http_code}\n' \
  -X POST http://127.0.0.1:8000/api/v1/ai-chat \
  -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}'
```
Expected: `401` (the pre-change behaviour). A `500` means `this` was captured incorrectly during the move.

- [ ] **Step 5: Commit**

```bash
cd "$REPO"
git add services/onasis-ai-router/core/middleware.js \
        services/onasis-ai-router/core/ai-service-router.js
git commit -m "onasis-ai-router: extract auth + usage middleware to core/middleware.js

Pure move. Class-property arrow functions become factories; route wiring
is unchanged because the property names are preserved.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Extract the tool loop into `core/tool-loop.js`

**Files:**
- Create: `core/tool-loop.js`
- Possibly create: `core/tools/memory.js`, `core/tools/code.js` (only if the size rule below triggers)
- Modify: `core/ai-service-router.js` (remove lines ~727–1343)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `class ToolLoop` with `extractToolCalls(response): Array<{id, name, args}>`, `async executeToolCalls(toolCalls, req, offeredTools): Promise<Array<{name, result}>>`, and `getOfferedTools(req): Array<object>`. Constructor takes the tool-related config (`apiBaseUrl`, memory paths, `routerTimeoutMs`, `maxToolResultChars`, `toolSummarizeEnabled`, `softToolParseEnabled`, `logger`).

**Do not move** the follow-up-pass logic at lines ~300–410. That is tightly coupled to the tool-call id-zipping contract from commit `5eed764` and stays in the router until Task 5 moves it as part of `chain-executor`.

- [ ] **Step 1: Move the code**

Move verbatim into `core/tool-loop.js`: `extractToolCalls` (~727), the soft-parse helper (~747), `executeToolCalls` (~799), `executeToolCallWithRetry` (~808), `executeToolCall` (~828), the nine `toolX()` implementations (~923–1343), `summarizeToolPayload` (~1344), and the read-only tool declarations at ~line 538.

Preserve every comment in the `toolCodeWrite` / `toolCodeRunCommand` region — those document safety constraints on tools that mutate the filesystem and run commands.

- [ ] **Step 2: Apply the size rule**

```bash
wc -l core/tool-loop.js
```
If the result is **≤ 400**, leave it as one file and skip to Step 3.
If **> 400**, split the nine tool implementations out: `core/tools/memory.js` (`toolMemorySearch`, `toolMemoryGet`, `toolMemoryWrite`) and `core/tools/code.js` (`toolCodeRead`, `toolCodeWrite`, `toolCodeRunCommand`, `toolCodeScanDependencies`, `toolCodeFindRelated`). Each exports plain functions taking `(args, req, ctx)` where `ctx` carries the config the method previously read off `this`. `tool-loop.js` requires and dispatches to them.

- [ ] **Step 3: Wire it into the router**

In `core/ai-service-router.js`:
1. `const { ToolLoop } = require('./tool-loop');`
2. Construct `this._toolLoop = new ToolLoop({ ... })` with the config listed in **Interfaces** above.
3. Replace call sites: `this.extractToolCalls(` → `this._toolLoop.extractToolCalls(`, `this.executeToolCalls(` → `this._toolLoop.executeToolCalls(`. The follow-up pass at ~line 308 keeps its structure and only changes which object it calls.
4. Delete the moved methods.

- [ ] **Step 4: Verify nothing dangles**

```bash
grep -n "^  async tool\|^  extractToolCalls\|^  async executeToolCall" core/ai-service-router.js
```
Expected: no output.

- [ ] **Step 5: Run the full suite**

```bash
npm test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd "$REPO"
git add services/onasis-ai-router/core/tool-loop.js services/onasis-ai-router/core/tools \
        services/onasis-ai-router/core/ai-service-router.js
git commit -m "onasis-ai-router: extract tool execution to core/tool-loop.js

Pure move. The follow-up-pass id-zipping logic (5eed764) deliberately
stays in the router for now — it moves with chain-executor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Extract the chain walk into `core/chain-executor.js`

**Files:**
- Create: `core/chain-executor.js`
- Modify: `core/ai-service-router.js` (remove lines ~230–300 and the follow-up pass ~300–410)

**Interfaces:**
- Consumes: `VendorScoreboard` (Task 1), `ToolLoop` (Task 4).
- Produces: `class ChainExecutor` with:
  ```js
  async run({ useCase, messages, promptBundle, temperature, maxTokens, tools })
    // → { adapterResponse, selectedVendor }
    // throws the last error when every vendor in the chain fails
  ```
  Constructor: `new ChainExecutor({ scoreboard, logger })`. Task 12 adds scoreboard-based filtering inside `run()`; Tasks 6–8 rely on `run()` continuing the loop when an adapter throws.

- [ ] **Step 1: Move the chain loop**

Move the `for` loop over `vendorChain` (lines ~230–300) into `ChainExecutor.run()` verbatim, including the fallback-timeout-ratio block and its comment explaining why vendors are not raced in parallel. Replace `this._scoreboard` with the injected `this._scoreboard`, and `this.logger` with the injected logger.

`run()` calls `resolveVendorChainForUseCase(useCase)` from `../vendors` itself.

- [ ] **Step 2: Wire it into the router**

In `core/ai-service-router.js`:
1. `const { ChainExecutor } = require('./chain-executor');`
2. `this._chain = new ChainExecutor({ scoreboard: this._scoreboard, logger: this.logger });`
3. In `handleOllamaChat`, replace the inlined loop with:
```js
const { adapterResponse, selectedVendor } = await this._chain.run({
  useCase, messages, promptBundle, temperature, maxTokens, tools,
});
```

- [ ] **Step 3: Confirm the router shrank as intended**

```bash
wc -l core/ai-service-router.js
```
Expected: roughly 200–300 lines, down from 1726. If it is still over 400, a concern was missed — check what remains against the File Structure table above before continuing.

- [ ] **Step 4: Run the full suite**

```bash
npm test
```
Expected: PASS.

- [ ] **Step 5: Full live verification of Phase 1**

This is the last extraction task, so verify the whole service end-to-end before moving on:

```bash
export $(grep DOTENV_PRIVATE_KEY_PRODUCTION .env.keys | xargs)
systemctl restart onasis-ai-router
sleep 3
systemctl is-active onasis-ai-router
curl -s -m 30 http://127.0.0.1:8000/health -o /tmp/h.json -w '%{http_code}\n'
node -e "const d=require('/tmp/h.json');console.log(Object.keys(d.services.ai).join(', '))"
```
Expected: `active`, `200`, and all five vendor ids listed. Behaviour must be identical to before Phase 1 — including the defects, which Phase 2 fixes.

- [ ] **Step 6: Commit**

```bash
cd "$REPO"
git add services/onasis-ai-router/core/chain-executor.js \
        services/onasis-ai-router/core/ai-service-router.js
git commit -m "onasis-ai-router: extract vendor chain walk to core/chain-executor.js

Completes the Phase 1 decomposition: core/ai-service-router.js drops from
1726 lines to route wiring and composition only. No behaviour change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tasks 6–8: Response contract (Phase 2)

This is where the user-visible symptom disappears.

### Task 6: Build the response contract

**Files:**
- Create: `vendors/_shared/response-contract.js`
- Test: `test/response-contract.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `class VendorContractError extends Error` with properties `vendorId` and `reason` (`'empty_content' | 'error_sentinel' | 'incomplete_turn'`), and `assertUsableCompletion(normalised, { vendorId, sentinels }) → normalised`. `normalised` is the adapter shape `{ message: { role, content }, done, done_reason, tool_calls, usage }`. Tasks 7, 8 and 9 all consume this.

- [ ] **Step 1: Write the failing tests**

Create `test/response-contract.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertUsableCompletion,
  VendorContractError,
} = require('../vendors/_shared/response-contract');

const ok = (content, extra = {}) => ({
  message: { role: 'assistant', content },
  done: true, done_reason: 'stop', tool_calls: [], usage: {}, ...extra,
});

test('accepts a normal completion', () => {
  const r = ok('The capital of France is Paris.');
  assert.equal(assertUsableCompletion(r, { vendorId: 'minimax' }), r);
});

test('rejects empty content with no tool calls', () => {
  assert.throws(
    () => assertUsableCompletion(ok('   '), { vendorId: 'minimax' }),
    (e) => e instanceof VendorContractError && e.reason === 'empty_content',
  );
});

test('accepts empty content WHEN tool calls are present', () => {
  const r = ok('', { tool_calls: [{ id: 'c1', function: { name: 'memory_search' } }] });
  assert.equal(assertUsableCompletion(r, { vendorId: 'minimax' }), r);
});

test('rejects an incomplete turn: finish_reason length with no content', () => {
  assert.throws(
    () => assertUsableCompletion(ok('', { done_reason: 'length' }), { vendorId: 'openclaw' }),
    (e) => e instanceof VendorContractError && e.reason === 'incomplete_turn',
  );
});

test("rejects OpenClaw's real gateway error string (regression fixture)", () => {
  const sentinels = [/^⚠️\s*Agent couldn't generate a response/i];
  assert.throws(
    () => assertUsableCompletion(
      ok("⚠️ Agent couldn't generate a response. Please try again."),
      { vendorId: 'openclaw', sentinels },
    ),
    (e) => e instanceof VendorContractError && e.reason === 'error_sentinel',
  );
});

test('a sentinel matching mid-sentence prose does not false-positive', () => {
  const sentinels = [/^⚠️\s*Agent couldn't generate a response/i];
  const r = ok("If the agent couldn't generate a response, retry the request.");
  assert.equal(assertUsableCompletion(r, { vendorId: 'openclaw', sentinels }), r);
});

test('never leaks vendor identity into the error message', () => {
  try {
    assertUsableCompletion(ok(''), { vendorId: 'openclaw' });
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(/openclaw/i.test(e.message), false, 'vendorId belongs on the property, not the message');
    assert.equal(e.vendorId, 'openclaw');
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test test/response-contract.test.js
```
Expected: FAIL — `Cannot find module '../vendors/_shared/response-contract'`.

- [ ] **Step 3: Implement the module**

Create `vendors/_shared/response-contract.js`:

```js
'use strict';

/**
 * Vendor response contract.
 *
 * A vendor returning HTTP 200 does not mean it returned a usable completion.
 * OpenClaw intermittently returns 200 whose content is the gateway's own error
 * string ("⚠️ Agent couldn't generate a response."), which the router served to
 * users as the answer while never falling through to a healthy vendor.
 *
 * Rules 1 and 2 below are generic. Rule 3 (sentinels) is a per-vendor blocklist
 * and is deliberately a fast path for known failures, NOT the strategy — the
 * durable defence is the scoreboard, which demotes a vendor on repeated
 * contract violations regardless of whether the string is recognised.
 */

class VendorContractError extends Error {
  constructor(message, { vendorId, reason }) {
    super(message);
    this.name = 'VendorContractError';
    this.vendorId = vendorId;
    this.reason = reason;
  }
}

/**
 * @param {{message:{role:string,content:string}, done_reason?:string, tool_calls?:Array}} normalised
 * @param {{vendorId:string, sentinels?:RegExp[]}} opts
 * @returns {object} the same object, when usable
 * @throws {VendorContractError}
 */
function assertUsableCompletion(normalised, { vendorId, sentinels = [] }) {
  const content = typeof normalised?.message?.content === 'string'
    ? normalised.message.content.trim()
    : '';
  const hasToolCalls = Array.isArray(normalised?.tool_calls) && normalised.tool_calls.length > 0;

  // A tool-call turn legitimately carries no prose — it must not throw.
  if (hasToolCalls) return normalised;

  if (!content) {
    // An empty turn stopped by the token cap is the incomplete-turn signature:
    // the model spent its budget on reasoning and emitted no assistant message.
    const reason = normalised?.done_reason === 'length' ? 'incomplete_turn' : 'empty_content';
    throw new VendorContractError(`Vendor returned an unusable completion (${reason})`, {
      vendorId, reason,
    });
  }

  for (const sentinel of sentinels) {
    if (sentinel.test(content)) {
      throw new VendorContractError('Vendor returned a gateway error string as content', {
        vendorId, reason: 'error_sentinel',
      });
    }
  }

  return normalised;
}

module.exports = { assertUsableCompletion, VendorContractError };
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test test/response-contract.test.js
```
Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
cd "$REPO"
git add services/onasis-ai-router/vendors/_shared/response-contract.js \
        services/onasis-ai-router/test/response-contract.test.js
git commit -m "onasis-ai-router: add vendor response contract

Turns an unusable HTTP 200 into a throw so the chain can fall through.
Includes OpenClaw's real gateway error string as a permanent regression
fixture. Not yet wired into any adapter.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Wire the contract into every active adapter

**Files:**
- Modify: `vendors/index.js` (add `errorSentinels` to the registry)
- Modify: `vendors/openclaw/adapter.js`, `vendors/minimax/adapter.js`, `vendors/openai/adapter.js`, `vendors/anthropic/adapter.js`, `vendors/ollama/adapter.js`

**Interfaces:**
- Consumes: `assertUsableCompletion` (Task 6).
- Produces: every active adapter's `chat()` either returns a contract-valid response or throws. Task 8 depends on this.

- [ ] **Step 1: Declare sentinels in the registry**

In `vendors/index.js`, add to the `openclaw` entry (alongside `status`, `adapter`, `models`):

```js
     // The gateway rewrites an incomplete agent turn into a 200 whose content
     // is this string (see journal: "stopReason=length ... surfacing error to
     // user"). Verified live 2026-08-26. A blocklist entry, not the strategy —
     // see vendors/_shared/response-contract.js.
     errorSentinels: [/^⚠️\s*Agent couldn't generate a response/i],
```

No other vendor has a known sentinel. Do not invent any — an unverified sentinel risks rejecting valid prose.

- [ ] **Step 2: Route each adapter's return through the contract**

In each of the five adapters, add the require alongside the existing `http-client` require:

```js
const { assertUsableCompletion } = require('../_shared/response-contract');
```

Then wrap the final return of `chat()`. For `vendors/openclaw/adapter.js`, the last line of `chat()` becomes:

```js
  const raw = await response.json();
  return assertUsableCompletion(normaliseResponse(raw, agentId), {
    vendorId: 'openclaw',
    sentinels: internalRequest.errorSentinels,
  });
```

Apply the same pattern to the other four, each passing its own `vendorId` (`'minimax'`, `'openai'`, `'anthropic'`, `'ollama'`) and `sentinels: internalRequest.errorSentinels`.

- [ ] **Step 3: Pass sentinels through the chain executor**

In `core/chain-executor.js`, add to the `internalRequest` object built inside the loop:

```js
          errorSentinels: VENDOR_REGISTRY[vendor._vendorId]?.errorSentinels,
```

Add `VENDOR_REGISTRY` to the existing `require('../vendors')` destructure at the top of the file.

- [ ] **Step 4: Run the full suite**

```bash
npm test
```
Expected: PASS. `test-vendor-responsiveness.js` asserts every active vendor exports `chat()` and `healthCheck()`; those must still hold.

- [ ] **Step 5: Commit**

```bash
cd "$REPO"
git add services/onasis-ai-router/vendors
git add services/onasis-ai-router/core/chain-executor.js
git commit -m "onasis-ai-router: enforce the response contract in every active adapter

OpenClaw's gateway error string now throws instead of being returned to
the user as the answer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Prove the chain falls through

**Files:**
- Test: `test/chain-executor.test.js`

**Interfaces:**
- Consumes: `ChainExecutor` (Task 5), `assertUsableCompletion` (Task 6).
- Produces: nothing consumed later — this is the acceptance test for Phase 2.

- [ ] **Step 1: Write the failing test**

Create `test/chain-executor.test.js`. It drives `assertUsableCompletion` through two fake adapters rather than reaching the network:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertUsableCompletion } = require('../vendors/_shared/response-contract');

const SENTINELS = [/^⚠️\s*Agent couldn't generate a response/i];

// Minimal stand-ins for the two vendors that matter. Each mimics its real
// adapter: normalise the upstream body, then assert the contract.
const fakeOpenclaw = {
  _vendorId: 'openclaw',
  _adapter: {
    async chat() {
      return assertUsableCompletion(
        { message: { role: 'assistant', content: "⚠️ Agent couldn't generate a response. Please try again." },
          done_reason: 'stop', tool_calls: [] },
        { vendorId: 'openclaw', sentinels: SENTINELS },
      );
    },
  },
};

const fakeMinimax = {
  _vendorId: 'minimax',
  _adapter: {
    async chat() {
      return assertUsableCompletion(
        { message: { role: 'assistant', content: 'Paris.' }, done_reason: 'stop', tool_calls: [] },
        { vendorId: 'minimax', sentinels: undefined },
      );
    },
  },
};

// The chain contract under test: try each vendor, stop at the first that does
// not throw. This mirrors ChainExecutor.run()'s loop.
async function walk(chain) {
  let lastError;
  for (const vendor of chain) {
    try {
      return { content: (await vendor._adapter.chat()).message.content, vendorId: vendor._vendorId };
    } catch (err) { lastError = err; }
  }
  throw lastError;
}

test('a sentinel response does not end the chain — the next vendor answers', async () => {
  const out = await walk([fakeOpenclaw, fakeMinimax]);
  assert.equal(out.vendorId, 'minimax');
  assert.equal(out.content, 'Paris.');
  assert.equal(/Agent couldn't generate/.test(out.content), false,
    'the gateway error string must never reach the caller');
});

test('when every vendor violates the contract, the chain throws', async () => {
  await assert.rejects(() => walk([fakeOpenclaw]), /unusable|gateway error/i);
});
```

- [ ] **Step 2: Run it**

```bash
node --test test/chain-executor.test.js
```
Expected: PASS — Task 7 already made the adapters throw. Had this test been written before Task 7, the first case would have returned OpenClaw's apology, which is the defect it guards against.

- [ ] **Step 3: Run the full suite and deploy**

```bash
npm test
export $(grep DOTENV_PRIVATE_KEY_PRODUCTION .env.keys | xargs)
systemctl restart onasis-ai-router
sleep 3
systemctl is-active onasis-ai-router
```
Expected: PASS, then `active`.

- [ ] **Step 4: Live confirmation against the real gateway**

Phase 2's whole purpose is that a user never sees the apology. Run the real chain repeatedly and confirm:

```bash
cat > /tmp/verify-phase2.js <<'EOF'
const { ChainExecutor } = require(`${process.env.REPO || '/opt/lanonasis/secondary-service/onasis-agent-haven'}/services/onasis-ai-router/core/chain-executor`);
const { VendorScoreboard } = require(`${process.env.REPO || '/opt/lanonasis/secondary-service/onasis-agent-haven'}/services/onasis-ai-router/core/vendor-scoreboard');
const ex = new ChainExecutor({ scoreboard: new VendorScoreboard(), logger: console });
(async () => {
  for (let i = 0; i < 12; i++) {
    const t0 = Date.now();
    try {
      const { adapterResponse, selectedVendor } = await ex.run({
        useCase: 'ask-ai',
        messages: [{ role: 'user', content: 'What is the capital of France?' }],
        promptBundle: { systemPromptForVendor: () => 'Answer in one sentence.' },
        temperature: 0.65, maxTokens: 350, tools: [],
      });
      const c = adapterResponse.message.content.trim();
      const bad = /Agent couldn't generate/i.test(c);
      console.log(`${i+1} ${String(Date.now()-t0).padStart(6)}ms via=${selectedVendor._vendorId.padEnd(9)} ${bad ? 'LEAKED' : 'ok'} ${JSON.stringify(c.slice(0,60))}`);
    } catch (e) { console.log(`${i+1} ALL-FAILED ${e.message.slice(0,80)}`); }
  }
})();
EOF
export $(grep DOTENV_PRIVATE_KEY_PRODUCTION .env.keys | xargs)
/usr/bin/dotenvx run --no-armor -f .env.production -- node /tmp/verify-phase2.js
```
Expected: **zero `LEAKED` rows.** Rows may show `via=openclaw` (it usually succeeds) or `via=minimax` (it fell through) — both are correct. The failure this guards against is any row containing the apology text.

- [ ] **Step 5: Commit**

```bash
cd "$REPO"
git add services/onasis-ai-router/test/chain-executor.test.js
git commit -m "onasis-ai-router: acceptance test for chain fall-through

Guards the Phase 2 defect: a vendor returning a gateway error string in a
200 must not end the chain.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tasks 9–12: Typed scoreboard (Phase 3)

### Task 9: Classify failures by cause

**Files:**
- Modify: `core/vendor-scoreboard.js`
- Test: `test/vendor-scoreboard.test.js`

**Interfaces:**
- Consumes: `VendorContractError` (Task 6).
- Produces: `classifyFailure(err) → 'billing' | 'auth' | 'contract' | 'transient'`, exported from `core/vendor-scoreboard.js`. Tasks 10 and 12 consume it.

- [ ] **Step 1: Write the failing tests**

Append to `test/vendor-scoreboard.test.js`:

```js
const { classifyFailure } = require('../core/vendor-scoreboard');
const { VendorContractError } = require('../vendors/_shared/response-contract');

test('classifies real billing failures observed on this host', () => {
  // Verbatim from live probes, 2026-08-26.
  assert.equal(classifyFailure(new Error(
    'OpenAI adapter: upstream returned 429 — { "error": { "message": "You have no credits remaining."')), 'billing');
  assert.equal(classifyFailure(new Error(
    'Anthropic adapter: upstream returned 400 — {"error":{"message":"Your credit balance is too low to access the Anthropic API."')), 'billing');
});

test('classifies auth failures', () => {
  assert.equal(classifyFailure(new Error('adapter: upstream returned 401 — unauthorized')), 'auth');
  assert.equal(classifyFailure(new Error('adapter: upstream returned 403 — forbidden')), 'auth');
});

test('classifies contract violations', () => {
  assert.equal(
    classifyFailure(new VendorContractError('unusable', { vendorId: 'openclaw', reason: 'error_sentinel' })),
    'contract');
});

test('classifies everything else as transient', () => {
  assert.equal(classifyFailure(new Error('upstream returned 503 — service unavailable')), 'transient');
  assert.equal(classifyFailure(new Error('The operation was aborted due to timeout')), 'transient');
  assert.equal(classifyFailure(new Error('ECONNRESET')), 'transient');
});

test('a 429 that is NOT a credit problem is transient, not billing', () => {
  // MiniMax plan-exhaustion vs ordinary rate limiting must not be conflated:
  // one deserves an hours-long cooldown, the other seconds.
  assert.equal(classifyFailure(new Error('upstream returned 429 — Too Many Requests, slow down')), 'transient');
});
```

- [ ] **Step 2: Run to verify failure**

```bash
node --test test/vendor-scoreboard.test.js
```
Expected: FAIL — `classifyFailure is not a function`.

- [ ] **Step 3: Implement**

Add to `core/vendor-scoreboard.js`, above the class:

```js
const { VendorContractError } = require('../vendors/_shared/response-contract');

// Matched against the adapter's error message, which embeds the upstream body.
// Patterns come from failures observed live on this host, 2026-08-26.
const BILLING_PATTERNS = [
  /no credits remaining/i,
  /insufficient[_ ]quota/i,
  /credit balance is too low/i,
  /credit_balance_exhausted/i,
  /usage limit reached/i,
  /returned 402\b/,
];
const AUTH_PATTERNS = [/returned 40[13]\b/, /unauthorized/i, /invalid api key/i];

/**
 * Classify a vendor failure so the breaker can pick a proportionate cooldown.
 * A billing outage lasts days; a 503 lasts seconds. Treating them alike is why
 * dead vendors were retried every 30s indefinitely.
 */
function classifyFailure(err) {
  if (err instanceof VendorContractError) return 'contract';
  const message = String(err?.message || '');
  // Billing is checked before auth: a 402 or a credit message is unambiguous,
  // whereas some providers return 401-shaped bodies for exhausted accounts.
  if (BILLING_PATTERNS.some((p) => p.test(message))) return 'billing';
  if (AUTH_PATTERNS.some((p) => p.test(message))) return 'auth';
  return 'transient';
}
```

Export it: `module.exports = { VendorScoreboard, classifyFailure };`

- [ ] **Step 4: Run to verify pass**

```bash
node --test test/vendor-scoreboard.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "$REPO"
git add services/onasis-ai-router/core/vendor-scoreboard.js \
        services/onasis-ai-router/test/vendor-scoreboard.test.js
git commit -m "onasis-ai-router: classify vendor failures by cause

Billing, auth, contract and transient failures deserve different
cooldowns. Patterns taken from failures observed live on this host.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Apply per-class cooldowns

**Files:**
- Modify: `core/vendor-scoreboard.js`
- Test: `test/vendor-scoreboard.test.js`

**Interfaces:**
- Consumes: `classifyFailure` (Task 9).
- Produces: `recordFailure(vendorId, err)` — the second parameter is new and optional; omitting it classifies as `transient`, preserving Task 1's behaviour. Task 12 passes the error.

- [ ] **Step 1: Write the failing tests**

Append to `test/vendor-scoreboard.test.js`:

```js
test('a billing failure opens the circuit immediately and holds it for an hour', () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });
  sb.recordFailure('openai', new Error('upstream returned 429 — You have no credits remaining.'));
  assert.equal(sb.isOpen('openai'), true, 'one billing failure is enough — no threshold');
  clock += 59 * 60 * 1000;
  assert.equal(sb.isOpen('openai'), true, 'still open at 59 minutes');
  clock += 2 * 60 * 1000;
  assert.equal(sb.isOpen('openai'), false, 'closed just past the 1h base cooldown');
});

test('repeat billing failures back off exponentially, capped at 12h', () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });
  const billing = () => new Error('insufficient_quota');
  for (let i = 0; i < 10; i++) { sb.recordFailure('openai', billing()); }
  clock += 11 * 3600 * 1000;
  assert.equal(sb.isOpen('openai'), true, 'still open at 11h');
  clock += 2 * 3600 * 1000;
  assert.equal(sb.isOpen('openai'), false, 'capped at 12h, not longer');
});

test('a contract failure counts AGAINST the vendor (D4 regression guard)', () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });
  const contract = () => new VendorContractError('unusable', { vendorId: 'openclaw', reason: 'error_sentinel' });
  sb.recordFailure('openclaw', contract());
  sb.recordFailure('openclaw', contract());
  assert.equal(sb.isOpen('openclaw'), true, 'two contract violations open the circuit');
});

test('transient failures keep the original forgiving behaviour', () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });
  const t = () => new Error('upstream returned 503');
  sb.recordFailure('minimax', t());
  sb.recordFailure('minimax', t());
  assert.equal(sb.isOpen('minimax'), false, 'below the threshold of 3');
  sb.recordFailure('minimax', t());
  assert.equal(sb.isOpen('minimax'), true);
  clock += 30_001;
  assert.equal(sb.isOpen('minimax'), false, '30s cooldown, unchanged');
});
```

- [ ] **Step 2: Run to verify failure**

```bash
node --test test/vendor-scoreboard.test.js
```
Expected: FAIL — billing failures currently need three occurrences and use the 30s cooldown.

- [ ] **Step 3: Implement**

Replace `isOpen` and `recordFailure` in `core/vendor-scoreboard.js`:

```js
  // Threshold and base cooldown per failure class. Billing and auth open on the
  // first failure because a second attempt cannot succeed — the account state
  // has to change externally.
  _policy(cls) {
    const int = (name, dflt) => parseInt(process.env[name] || String(dflt), 10);
    switch (cls) {
      case 'billing':
        return { threshold: 1, baseMs: int('VENDOR_BILLING_COOLDOWN_MS', 3600000), capMs: 12 * 3600000 };
      case 'auth':
        return { threshold: 1, baseMs: int('VENDOR_AUTH_COOLDOWN_MS', 3600000), capMs: 12 * 3600000 };
      case 'contract':
        return { threshold: 2, baseMs: int('VENDOR_CONTRACT_COOLDOWN_MS', 300000), capMs: 3600000 };
      default:
        return {
          threshold: int('VENDOR_CIRCUIT_THRESHOLD', 3),
          baseMs:    int('VENDOR_CIRCUIT_COOLDOWN_MS', 30000),
          capMs:     int('VENDOR_CIRCUIT_COOLDOWN_MS', 30000),
        };
    }
  }

  isOpen(vendorId) {
    const state = this._state.get(vendorId);
    if (!state) return false;
    const { threshold, baseMs, capMs } = this._policy(state.cls);
    if (state.failCount < threshold) return false;
    // Exponential backoff on repeats beyond the threshold, capped.
    const overshoot = state.failCount - threshold;
    const cooldownMs = Math.min(baseMs * Math.pow(2, overshoot), capMs);
    return (this._now() - state.lastFailedAt) < cooldownMs;
  }

  recordFailure(vendorId, err) {
    const cls = err ? classifyFailure(err) : 'transient';
    const prev = this._state.get(vendorId);
    // A change of class restarts the count — a billing outage after a transient
    // blip is a different problem, not a continuation of the old one.
    const state = prev && prev.cls === cls ? prev : { failCount: 0, lastFailedAt: 0, cls };
    state.failCount += 1;
    state.lastFailedAt = this._now();
    state.cls = cls;
    this._state.set(vendorId, state);
  }
```

`recordSuccess` is unchanged.

- [ ] **Step 4: Run to verify pass**

```bash
node --test test/vendor-scoreboard.test.js
```
Expected: PASS, including Task 1's original three tests (which call `recordFailure` without an error and so classify as `transient`).

- [ ] **Step 5: Commit**

```bash
cd "$REPO"
git add services/onasis-ai-router/core/vendor-scoreboard.js \
        services/onasis-ai-router/test/vendor-scoreboard.test.js
git commit -m "onasis-ai-router: proportionate cooldowns per failure class

Billing and auth failures open on the first occurrence and back off for
hours; contract violations for minutes; transient failures keep the
original 3-strikes/30s behaviour.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Track latency and demote slow-tail vendors

**Files:**
- Modify: `core/vendor-scoreboard.js`
- Test: `test/vendor-scoreboard.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `recordSuccess(vendorId, latencyMs)` (second parameter optional) and `orderChain(chain) → chain`, which filters open circuits and demotes vendors whose p95 exceeds `VENDOR_TAIL_DEMOTE_MS`. Task 12 consumes `orderChain`.

- [ ] **Step 1: Write the failing tests**

Append to `test/vendor-scoreboard.test.js`:

```js
const link = (id) => ({ _vendorId: id });

test('orderChain drops vendors whose circuit is open', () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });
  sb.recordFailure('openai', new Error('insufficient_quota'));
  const out = sb.orderChain([link('openai'), link('minimax')]);
  assert.deepEqual(out.map((v) => v._vendorId), ['minimax']);
});

test('orderChain preserves declared order when nothing is degraded', () => {
  const sb = new VendorScoreboard({ now: () => 1 });
  const out = sb.orderChain([link('openclaw'), link('minimax'), link('ollama')]);
  assert.deepEqual(out.map((v) => v._vendorId), ['openclaw', 'minimax', 'ollama']);
});

test('a vendor with a slow tail is demoted below a healthy alternative', () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });
  // openclaw: measured p50 ~3.4s but a 41.5s tail (live, 2026-08-26).
  for (const ms of [3000, 3200, 3400, 3600, 3800, 4000, 10000, 16000, 41500, 41500]) {
    sb.recordSuccess('openclaw', ms);
  }
  for (const ms of [1000, 2000, 2100, 2200, 2300, 3500, 4500]) {
    sb.recordSuccess('minimax', ms);
  }
  const out = sb.orderChain([link('openclaw'), link('minimax')]);
  assert.deepEqual(out.map((v) => v._vendorId), ['minimax', 'openclaw'],
    'openclaw p95 exceeds 15s while minimax stays below it');
});

test('demotion needs a healthy alternative — a lone slow vendor still runs', () => {
  const sb = new VendorScoreboard({ now: () => 1 });
  for (let i = 0; i < 10; i++) sb.recordSuccess('openclaw', 41500);
  const out = sb.orderChain([link('openclaw')]);
  assert.deepEqual(out.map((v) => v._vendorId), ['openclaw'],
    'a slow vendor beats no vendor');
});
```

- [ ] **Step 2: Run to verify failure**

```bash
node --test test/vendor-scoreboard.test.js
```
Expected: FAIL — `sb.orderChain is not a function`.

- [ ] **Step 3: Implement**

Add to `core/vendor-scoreboard.js`. Extend the constructor with `this._latency = new Map(); // vendorId -> number[]`, then:

```js
  /** Rolling window of recent successful-call latencies, newest last. */
  _recordLatency(vendorId, latencyMs) {
    if (!Number.isFinite(latencyMs)) return;
    const WINDOW = parseInt(process.env.VENDOR_LATENCY_WINDOW || '20', 10);
    const samples = this._latency.get(vendorId) || [];
    samples.push(latencyMs);
    if (samples.length > WINDOW) samples.shift();
    this._latency.set(vendorId, samples);
  }

  /** p95 of the rolling window, or null below the minimum sample count. */
  p95(vendorId) {
    const samples = this._latency.get(vendorId) || [];
    const MIN = parseInt(process.env.VENDOR_LATENCY_MIN_SAMPLES || '5', 10);
    if (samples.length < MIN) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  }

  /**
   * Filter and order a declared vendor chain by observed behaviour.
   *
   * Declared order is preference. It is overridden only when a vendor's p95
   * exceeds the tail budget AND a measured-faster alternative exists — the case
   * this service actually has, where medians overlap but tails diverge sharply
   * (openclaw p50 ~3.4s / max 41.5s vs minimax p50 ~2.2s / max 4.5s).
   */
  orderChain(chain) {
    const open = chain.filter((v) => !this.isOpen(v._vendorId));
    if (open.length < 2) return open;

    const TAIL_MS = parseInt(process.env.VENDOR_TAIL_DEMOTE_MS || '15000', 10);
    const isSlow = (v) => { const p = this.p95(v._vendorId); return p !== null && p > TAIL_MS; };
    const isKnownFast = (v) => { const p = this.p95(v._vendorId); return p !== null && p <= TAIL_MS; };

    // Only demote when a measured-fast alternative exists. Unmeasured vendors
    // keep their declared position — absence of data is not evidence of speed.
    if (!open.some(isKnownFast)) return open;

    const fast = open.filter((v) => !isSlow(v));
    const slow = open.filter(isSlow);
    return [...fast, ...slow];
  }
```

Update `recordSuccess` to accept latency, keeping the existing decay logic intact:

```js
  recordSuccess(vendorId, latencyMs) {
    this._recordLatency(vendorId, latencyMs);
    const state = this._state.get(vendorId);
    if (!state) return;
    state.failCount = Math.max(0, state.failCount - 2);
    if (state.failCount === 0) this._state.delete(vendorId);
    else this._state.set(vendorId, state);
  }
```

- [ ] **Step 4: Run to verify pass**

```bash
node --test test/vendor-scoreboard.test.js
```
Expected: PASS, all tests including Tasks 1, 9 and 10.

- [ ] **Step 5: Commit**

```bash
cd "$REPO"
git add services/onasis-ai-router/core/vendor-scoreboard.js \
        services/onasis-ai-router/test/vendor-scoreboard.test.js
git commit -m "onasis-ai-router: demote vendors on observed p95 tail latency

Declared vendorOrder stays the preference; it is overridden only when a
vendor's p95 exceeds the tail budget and a measured-faster alternative
exists. Addresses the 41.5s openclaw tail without hard-coding a claim
about medians that the data does not support.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Wire the scoreboard into the chain executor

**Files:**
- Modify: `core/chain-executor.js`
- Test: `test/chain-executor.test.js`

**Interfaces:**
- Consumes: `VendorScoreboard.orderChain`, `recordFailure(vendorId, err)`, `recordSuccess(vendorId, latencyMs)` (Tasks 10–11).
- Produces: nothing consumed later — this closes Phase 3.

- [ ] **Step 1: Write the failing test**

Append to `test/chain-executor.test.js`:

```js
const { VendorScoreboard } = require('../core/vendor-scoreboard');

test('the executor records latency on success and the error on failure', async () => {
  let clock = 1_000_000;
  const sb = new VendorScoreboard({ now: () => clock });

  // Simulate what ChainExecutor.run() must do around each attempt.
  const attempt = async (vendorId, fn) => {
    const t0 = clock;
    try { const r = await fn(); sb.recordSuccess(vendorId, clock - t0); return r; }
    catch (err) { sb.recordFailure(vendorId, err); throw err; }
  };

  await assert.rejects(() => attempt('openai', async () => {
    clock += 1000;
    throw new Error('upstream returned 429 — You have no credits remaining.');
  }));
  assert.equal(sb.isOpen('openai'), true, 'a billing failure must open the circuit immediately');

  for (let i = 0; i < 6; i++) {
    await attempt('minimax', async () => { clock += 2200; return 'ok'; });
  }
  assert.equal(sb.p95('minimax'), 2200);

  const ordered = sb.orderChain([{ _vendorId: 'openai' }, { _vendorId: 'minimax' }]);
  assert.deepEqual(ordered.map((v) => v._vendorId), ['minimax'],
    'the dead vendor is gone from the chain without any config edit');
});
```

- [ ] **Step 2: Run it**

```bash
node --test test/chain-executor.test.js
```
Expected: PASS — it exercises the scoreboard API directly. It documents the contract Step 3 must implement in `ChainExecutor`.

- [ ] **Step 3: Apply the same contract inside `ChainExecutor.run()`**

In `core/chain-executor.js`:

1. Order the chain before the loop:
```js
    const declaredChain = resolveVendorChainForUseCase(useCase);
    const vendorChain = this._scoreboard.orderChain(declaredChain);
    if (vendorChain.length === 0) {
      throw new Error('All AI vendors exhausted — no response available');
    }
```
2. Delete the now-redundant `if (this._scoreboard.isOpen(...)) continue;` guard at the top of the loop — `orderChain` has already filtered open circuits.
3. Time each attempt and report the outcome:
```js
        const attemptStartedAt = Date.now();
        adapterResponse = await vendor._adapter.chat(internalRequest, vendor._model);
        this._scoreboard.recordSuccess(vendor._vendorId, Date.now() - attemptStartedAt);
```
4. Pass the error to `recordFailure` in the `catch`:
```js
        this._scoreboard.recordFailure(vendor._vendorId, err);
```

- [ ] **Step 4: Run the full suite**

```bash
npm test
```
Expected: PASS.

- [ ] **Step 5: Live verification of Phase 3**

Re-run the Phase 2 verifier from Task 8, Step 4 — the scoreboard now persists across its 12 iterations because it shares one `ChainExecutor`:

```bash
export $(grep DOTENV_PRIVATE_KEY_PRODUCTION .env.keys | xargs)
/usr/bin/dotenvx run --no-armor -f .env.production -- node /tmp/verify-phase2.js
```
Expected: zero `LEAKED` rows, and — because `openai` and `anthropic` are genuinely credit-exhausted — no row should ever be served by them after their first attempt. If `via=` shows a mix of `openclaw` and `minimax` only, the scoreboard is working.

- [ ] **Step 6: Deploy and confirm**

```bash
export $(grep DOTENV_PRIVATE_KEY_PRODUCTION .env.keys | xargs)
systemctl restart onasis-ai-router
sleep 3
systemctl is-active onasis-ai-router
curl -s -m 30 http://127.0.0.1:8000/health -o /dev/null -w '%{http_code}\n'
```
Expected: `active`, `200`.

Note `/health` still reports liveness rather than capability — that is Phase 4, deliberately out of scope for this plan.

- [ ] **Step 7: Commit**

```bash
cd "$REPO"
git add services/onasis-ai-router/core/chain-executor.js \
        services/onasis-ai-router/test/chain-executor.test.js
git commit -m "onasis-ai-router: dispatch from the scoreboard

The chain is now filtered and ordered by observed outcomes before it is
walked, and every attempt reports its latency or its classified error.
Credit-exhausted vendors leave the chain on their own and rejoin on their
own when credit is restored.

Closes Phase 3 of the outcome-driven routing spec.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done criteria for this plan

- [x] `core/ai-service-router.js` is substantially reduced; the modules exist
      — **actual: 688 lines, down from 1726 (-60%).** The ~200–300 estimate in
      this plan was wrong: it never assigned a home to the response-formatting
      family (~125 lines), and its Task 4 note claimed the tool follow-up pass
      would move with `chain-executor`, which Task 5's own steps never did. Both
      remain in the router deliberately — moving the follow-up pass is not a
      pure move and carries the id-zipping contract from `5eed764`.
      `core/tool-loop.js` (855 lines) was also kept whole rather than split into
      `core/tools/*.js`, for the same "not a pure move" reason.
- [x] `npm test` passes: 42 tests, 37 pass, 0 fail, 5 skipped (credentialed live-chat tests, skipped by design), including the OpenClaw apology-string regression fixture
- [x] Zero `LEAKED` rows. Note the unforced 12-request run was served entirely by openclaw and so did not exercise the fall-through; `scripts/verify-fallthrough.js` forces it and shows 0/4 leaked, all served by minimax
- [x] `openai`/`anthropic` self-eject after one billing failure. `scripts/verify-circuit-eject.js`: run 1 28778ms -> run 2 1276ms (~22.5x)  [re-measured 2026-09-03; the earlier "26995ms -> 971ms (28x)" came from an ad-hoc variant, because the committed verify-circuit-eject.js referenced an undefined `R` and had never been runnable — fixed in 5293685]
- [x] Service `active`, `/health` 200, unauthenticated POST still 401

**Not** in scope, tracked for the follow-on plan: capability-based `/health` (spec §6), lane typing and the agent token floor (spec §7), and the L0 vendor (spec §10).

---

## As-built record (2026-10-11)

Where the delivered code diverged from what this plan specified. Read this before
treating any number or claim above as current.

| Item | Plan said | As built | Note |
|---|---|---|---|
| `core/ai-service-router.js` | ~200–300, then recorded **688** | **1638** | **Eroded.** See below. |
| `core/tool-loop.js` | split into `core/tools/*` if >400 lines | **938 lines, kept whole** | Boundary rule fired; deliberately not applied — splitting is not a pure move |
| Response-formatting family | assigned a home | **stayed in the router** | The plan never gave it one (~125 lines) |
| Tool follow-up pass | implied to move with `chain-executor` | **stayed in the router** | Not a pure move; carries the id-zipping contract from `5eed764` |
| `core/chain-executor.js` | new module | **271 lines, extracted** | Landed as specified |
| `core/vendor-scoreboard.js` | new module | **215 lines** | Landed as specified |
| `core/memory-prefetch.js` | new module | **176 lines** | Landed as specified |
| `core/middleware.js` | new module | **230 lines** | Landed as specified |
| `vendors/_shared/response-contract.js` | new module | **101 lines** | Landed as specified |

**Verification scripts referenced by the Done criteria — all present:**

| Script | Proves |
|---|---|
| `scripts/verify-fallthrough.js` | The chain falls through instead of serving an error string (forces the case; 0/4 leaked, served by `minimax`) |
| `scripts/verify-circuit-eject.js` | `openai`/`anthropic` self-eject after one billing failure (run 1 28778ms → run 2 1276ms) |
| `scripts/capture-prompt-baseline.js` | Prompt composition is unchanged (SOUL + role across 54 combinations) |
| `scripts/router-logs.js` | Classified failure summary; exit code backs an alert |

### The erosion — and why it matters more than any task above

`core/ai-service-router.js` line count over its life:

```
  1726   before this plan
   688   at plan completion            (109b525, 2026-08-27)
   821 → 999 → 1206 → … → 1638        (2026-09-03 → 2026-10-07)
```

Roughly **+950 lines in six weeks**, monotonically, after the extraction completed.
This was **not** a revert: every module above still exists and is still used. The
router regrew by accretion — new feature work landed in it rather than in a module.

That is precisely the defect this plan was written to fix, returning by a different
door. The phase-1 extraction bought a smaller file, not a smaller-file *habit*, and
nothing has been holding the line since. Two consequences worth stating plainly:

- The "~200-line router" mental model in this document and in the spec is **wrong
  today**. Budget your reading accordingly.
- Any new work in this area should be judged on *where the logic lands*, not only on
  whether it works. A correct feature added inline makes the next change harder.

## Standing invariants — do not regress these

1. **Privacy:** vendor ids, model names, endpoints and API keys never appear in a
   client response or an info-level log. `sanitizeVendorResponse()` is the enforcement
   point.
2. **The tool-call id-zipping contract** (`5eed764`) — the follow-up pass must replay
   a vendor's own `tool_calls[]` verbatim, and tool results must be zipped to it by
   index. Breaking this 400s on MiniMax and silently corrupts others.
3. **Never race vendors in parallel** (`chain-executor.js`): it would bill every paid
   vendor per fallback request for duplicate work.
4. **`supabase-edge` stays deprecated.** It inverted the architecture into a cycle
   with a consuming product and caused a persona leak. See `CLAUDE.md`.
5. **Tests must be deterministic and free** — fakes, never live vendors. Live probes
   belong in `scripts/`.
6. **Structure discipline (added 2026-10-11):** new logic goes into a module. If it
   must go into `core/ai-service-router.js`, say why in the commit message. The
   erosion above is the reason this rule exists.
7. **Never run `git checkout`/`reset` on `/opt/paperclip-runtime`** — unrelated
   service on this host with an uncommitted hotfix.

## Rollback

Each phase is a separate commit on `refactor/outcome-driven-routing`. The service
deploys from the working tree via systemd, so rollback is `git revert <phase>` then:

```bash
export $(grep DOTENV_PRIVATE_KEY_PRODUCTION \
  /opt/lanonasis/secondary-service/onasis-agent-haven/services/onasis-ai-router/.env.keys | xargs)
systemctl restart onasis-ai-router
systemctl is-active onasis-ai-router
```

Note: this plan landed on `main` long ago, so "rollback" is per-commit revert rather
than reverting a whole branch. Phases 1–3 are entangled with six weeks of later work
in the same file — reverting a phase today will conflict.

## Cross-references

- Design spec, phasing table and open configuration defaults:
  `docs/superpowers/specs/2026-08-27-outcome-driven-routing-design.md` §12, §13.
- Service behaviour, vendor roster, ops runbook: `services/onasis-ai-router/CLAUDE.md`.
- Consumer-facing HTTP contract: `services/onasis-ai-router/docs/INTEGRATION-GUIDE.md`.
- Convergence/profiles plan: `docs/L0-AGENT-HEAVEN-CONVERGENCE-PLAN.md`.

## Known path drift (2026-10-11)

`/opt/lanonasis/shared_services/...` is the **production host** layout. That tree
does not exist on this development/archive host, where the repo lives at
`/opt/lanonasis/secondary-service/onasis-agent-haven`. Every command block in this
document now uses `$REPO` — set it once (see Global Constraints) before running
anything.

These files still hardcode the production path, and on this host that is a silent
failure: the command or service starts in the wrong directory, or does not start.

| File | Where | Impact |
|---|---|---|
| `infra/pm2/onasis-ai-router.ecosystem.js` | line 11 | **Operational** — `cwd` points at a directory that does not exist here; pm2 cannot start the app from it |
| `README.md` | line 57 | Onboarding `cd` into a missing path |
| `services/onasis-ai-router/README.md` | line 90 | Same |
| `services/onasis-ai-router/docs/VENDOR-CONFIGURATION.md` | line 14 | Deploy command reading a `.env.keys` that is not there |
| `services/onasis-ai-router/CLAUDE.md` | lines 21, 26 | Declares the live path, and still describes the removed `shared_services/onasis_ai_router/` directory as present |

**Left unchanged deliberately.** Each needs one of two decisions, and neither is a
documentation call: either the path is host-specific and should be parameterised
(as this plan now does), or one of them is simply wrong and should be deleted.
`CLAUDE.md` is the service's primary orientation document — it should be corrected
by whoever owns the production layout, not mechanically.

**Why this matters more than it looks:** a wrong `cd` does not error. The command
runs, in the wrong directory, and the failure surfaces later as a confusing
"file not found" or a change that appears to have had no effect.
