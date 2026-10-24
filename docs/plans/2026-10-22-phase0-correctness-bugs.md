# Phase 0 — Close the Correctness Bugs (R1–R3)

**Source:** `docs/2026-10-22-voltagent-adoption-evaluation.md` §6 (opportunity cost)
**Priority:** P0 — all three defects actively return wrong data to models in production
**Scope:** `services/onasis-ai-router/core/tool-loop.js` only. No new dependencies.
**Guardrail:** Do not change behaviour for healthy memory. The fix only affects error paths.

---

## R1 — A memory error is indistinguishable from memory content (correctness)

**Defect:** `toolMemorySearch` / `toolMemoryGet` / `toolMemoryWrite` call `response.json()`
and pass the result to `formatToolPayload()` **without ever checking `response.ok`**. An
upstream that answers `401`/`403`/`500` with a JSON error envelope reaches the model as
a successful tool result, and the model summarises an error object as though it were the
user's memories.

Only a non-JSON body (or a transport failure) reaches the `catch` — which is why this
has stayed invisible. The failure mode depends on the error body's content type.

**Fix:**
- Check `response.ok`; treat non-2xx as a failure with a stable shape.
- Distinguish "memory service is unwell" from "no memories matched" in the payload,
  so the model can say which happened.
- Regression test: memory API returns `500 {"error":...}` → the tool result must
  not be presented as memories.

---

## R2 — The retry wrapper never fires for memory tools (resilience)

**Defect:** `executeToolCallWithRetry` retries **only when the attempt throws**. Every
memory tool catches its own errors and *returns* an error payload instead, so the retry
is unreachable for precisely the tools it was written for. The memory path gets one
attempt, not two, while the code reads as though it gets two.

**Fix:**
- Have `toolMemory*` throw a typed error on transport/5xx failures, and reserve the
  returned-error shape for validation problems (missing ids, unoffered tool).
- Or move the retry inside the tool. Either way the wrapper and the tools must agree
  on which failures are retryable.
- Decision: **throw on transport/5xx**. Keep returned-error for validation failures.
  This lets the existing retry wrapper work without duplicating logic.

---

## R3 — Sequential tool calls multiply the memory timeout (latency)

**Defect:** `executeToolCalls` is a sequential loop and each memory call aborts at
`routerTimeoutMs` — default **15000 ms**. Three tool calls against a slow memory service
is up to **45 s** before synthesis even begins, against nginx's 60 s `proxy_read_timeout`;
synthesis then runs on the remaining half-budget.

**Fix:**
- Run independent tool calls concurrently (bounded, e.g. 2–3 at a time), rather than
  serially.
- Re-examine the 15 s default — generous for a search, and paid once per call.

---

## Tasks

| # | Task | Risk |
|---|---|---|
| T1 | **Fix R1: check `response.ok` in all three memory tools** — distinct payload for "unwell" vs "no matches", regression test on `500` | Low — small, well-scoped, easy to verify |
| T2 | **Fix R2: make memory tools throw on transport/5xx failures** — keeps validation errors as returned-payload so retry wrapper fires | Low — follows same error-handling pattern |
| T3 | **Fix R3: bounded concurrency in `executeToolCalls`** — concurrent with a configurable max (default 3), regression test on 3 parallel calls | Medium — changes execution model, needs careful testing |

### Execution notes for implementers

- **Do NOT change any vendor adapter or chain-executor logic.** These bugs live entirely
  in the tool execution path. If you feel the need to change vendor fallback behaviour,
  stop — that is a different concern (already handled by the scoreboard in `chain-executor.js`).
- **Preserve the existing `catch` + error-payload return.** The router's philosophy is
  "the model should be told a tool failed rather than have the whole request fail."
  R1 is about the payload being *indistinguishable* from success, not about changing
  the return shape.
- **Tests must be deterministic and free.** Fake the memory API responses, never hit the
  live service. The test file already exists at `core/tool-loop.test.js` (check if it
  exists, if not create it under `test/`).
- **The tool definitions are at lines ~95–230 in `tool-loop.js`.** The memory tool
  implementations start at lines ~464 (toolMemorySearch), ~494 (toolMemoryGet), ~546
  (toolMemoryWrite).
- **`executeToolCalls` is at line ~324** and `executeToolCallWithRetry` at line ~333.
- **Do NOT run `git checkout` / `reset` / `restore` / `stash` on any file you did not
  author** — you share the worktree with already-completed waves; reverting one loses
  that wave's work.
- **If a factual premise in this brief turns out to be wrong — a version does not
  behave as stated, an API is missing, a file is not where the brief says — STOP and
  report the contradiction with evidence. Do not improvise around a broken premise.**
