# Corpus merge — per-file adjudication

**Measured 2026-10-22 against the live tree. Read before executing the merge.**

`docs/CORPUS-MERGE.md` (measured 2026-09-11) recorded the shape of this merge and
left one question open: *which side wins, per file?* This document answers it
file by file, from the current tree, and states what still needs a human decision.

The `COMPARISON-PLAN.md` framing ("prompts exist triplicated", "adopt
`packages/agent-model-files` as canonical, point the router at it") is **wrong on
both counts**. Correcting it first, because the wrong version loses content.

---

## 1. It is not triplicated — it is two corpora plus a generated mirror

| Path | What it actually is | Read by |
|---|---|---|
| `packages/agent-model-files/` | **Canonical.** Flat layout. Has `SOURCE-OF-TRUTH.md` with `## BEGIN/## END` section markers. | The Agent Haven app, via the Vite alias `@agent-model-files` → `packages/agent-model-files`. CI: `npm run check:agent-model-files`. |
| `apps/onasis-agent-haven/docs/agent_model_files/` | **A generated mirror**, not a third corpus. Produced by `sync-source-of-truth.py --output-dir …` and verified in CI. Byte-identical to the package for 11 of 12 files. | Nothing at runtime. Only the CI check and the `check:agent-model-files` script. |
| `services/onasis-ai-router/agent_model_files/` | **The router's own corpus.** Nested layout (`lanes/`, `subagents/`, `orchestrator/`, `frameworks/`). This is what the router actually composes from. | `core/prompt-composer.js` → `BUNDLED_PROMPTS_ROOT`. |

Measured: the package copy and the app copy are identical for 11 of 12 shared
files. The only difference is `SOURCE-OF-TRUTH.md`, where the app's generated
copy is **missing 5 L0 sections** that the canonical package has. That is a
**stale mirror**, not a third source of truth.

Two consequences:

- The Agent Haven app is **already** reading the canonical package. It is not
  decoupled from it, and there is no app-side import to rewire.
- "Delete the redundant `apps/.../docs/agent_model_files` directory" would
  break the CI check that produces it. It is an output directory, not a source.

## 2. The two real corpora are different authoring systems

This is the finding that changes the plan. They are **not** an old and a new
version of the same document. They are two incompatible prompt frameworks:

| | Canonical package | Router corpus (live) |
|---|---|---|
| Structure | **RISEN** — `R`ole / `I`nstructions / `S`teps / `E`xpectation / `N`arrowing, in every agent file | Narrative prose — `## Core Identity`, `## Domain Risk Posture`, `## The Philosophy`, plus `## Examples` / `## Status` / `## Confidence Levels` |
| Size | Smaller (109–511 lines/file) | **Larger** (239–587 lines/file) — richer prose, more examples |
| L0 platform boundary | **Present** | **ABSENT** |
| Layout | Flat | Nested (`orchestrator/`, `subagents/`, `frameworks/`, `lanes/`) |
| Lane prompts | **No `lanes/` directory at all** | 9 lane files |
| `coder-ts.md` | absent | present |
| Source of truth | `SOURCE-OF-TRUTH.md` with `## BEGIN/## END` markers, sections named flat (`base.md`, `coder.md`) | `SOURCE-OF-TRUTH.md` with the same markers, sections named **nested** (`orchestrator/base.md`, `subagents/coder.md`) — 12 sections vs 11 |

Both corpora round-trip through their own `SOURCE-OF-TRUTH.md` consistently.
They are two self-consistent systems that describe the same agents differently.

**The RISEN structure is present in all 6 package agent files and in none of the
6 router agent files.** That is the cleanest single indicator of which is which.

## 3. Per-file adjudication

"Router wins" on raw line count, but the package holds content the router
does not. Measured section-level diff, package-only headings:

| File | pkg | router | Package-only content the router **lacks** |
|---|---|---|---|
| `SOUL.md` | 109 | 239 | `## Onasis L0 Platform Boundary`, `## Security Boundaries` |
| `IDENTITY-LAYER.md` | 120 | 130 | `## L0 Profile Composition` |
| `base.md` | 150 | 186 | RISEN (R/I/S/E/N) + 8 more sections |
| `policies.md` | 159 | 345 | `## 1. Execution Safety` … `## 6. Agent Interaction Policies` (numbered policy set) |
| `tools.md` | 511 | 587 | `## L0 Router Capability Boundary`, per-tool sections |
| `generic.md` | 290 | 290 | none — **tie**, only formatting differs |
| `architect.md` | 144 | 350 | RISEN + 19 more |
| `coder.md` | 115 | 122 | RISEN + 8 more |
| `researcher.md` | 141 | 219 | RISEN + 16 more |
| `reviewer.md` | 141 | 225 | RISEN + 13 more |
| `tester.md` | 184 | 374 | RISEN + 12 more |

### Recommendation: **union, router as the base**

Do **not** adopt the package wholesale. `CORPUS-MERGE.md` measured that
adoption removes 24–36% of the composed prompt on every lane — and the
mechanism is now understood: the package's RISEN files are *shorter* and
*structurally different*, so adopting them discards the router's narrative
prose, its worked examples, and its confidence-level ladders.

Instead:

1. **Base = router corpus.** Preserves live persona byte-for-byte. No
   regression on any lane, no re-record of the effective-prompt baseline for
   persona reasons.
2. **Add the package's unique content** into the router corpus, per file:
   - The L0 Platform Boundary text into the router's `SOUL.md`.
   - The L0 Profile Composition text into the router's `IDENTITY-LAYER.md`.
   - The L0 Router Capability Boundary into the router's `tools.md`.
   - The numbered policy set (`## 1.`–`## 6.`) into the router's `policies.md`.
   - Decide per agent file whether RISEN adds anything the router's prose
     lacks. **This is the judgement call** — see §5.
3. **Add `lanes/` to the canonical package** so it can serve as the single
   source, then point the router at it.
4. **Flatten the canonical package's role map** — `CORPUS-MERGE.md` already
   established the layout is not the obstacle: with a flattened role map every
   role file resolves, zero unresolved lookups. `subagents/researcher.md` →
   `researcher.md` is mechanical.
5. **Resolve `SOURCE-OF-TRUTH.md` naming.** The two corpora name their
   sections differently (flat vs nested). The canonical package's sections are
   flat and its sync script is the CI-verified one, so the merged corpus should
   use **flat** section names, and the router's `build-source-of-truth.py`
   `SECTIONS` table must be updated to match.

## 4. Why the L0 Platform Boundary gap matters

This is the one item in the whole merge that is not a tidiness question.

The router's live `SOUL.md` does **not** contain the L0 Platform Boundary. That
text says, among other things:

> - Auth Gateway UAI resolves the caller, organization, and application
>   entitlement before the request is composed.
> - Never invent credentials, authorization scope, vendor names, model names,
>   workspace names, or private memories.
> - State user-facing identity only through the approved profile.

The live router is a production service that fronts both concierges. The
persona it composes today contains **no** instruction about UAI entitlement
resolution and **no** prohibition on inventing authorization scope or
disclosing vendor identity. The prohibition on vendor disclosure is enforced
in code (`sanitizeVendorResponse()`), but the persona does not carry the
entitlement rule at all.

**This is a live compliance gap, independent of the merge.** It is worth
fixing on its own merits before any restructuring: it is a ~12-line addition
to the router's `SOUL.md` that is currently only in the canonical package.

Two caveats before acting:

- Adding it changes the composed prompt, so `capture-prompt-baseline.js` will
  fail. That failure is the review artifact — read the diff, then re-record
  deliberately. Do not let a guard "go green" by accident.
- The router is not running on this host (`systemctl is-active
  onasis-ai-router` → `inactive`, and the unit is not installed here), so the
  deployed impact is a deployment step, not a live edit. It runs from
  `/opt/lanonasis/shared_services/...` on the production host.

## 5. What still needs a human decision

The per-file judgement the plan asks for cannot be automated, because it is a
question about which persona is *correct*, not which is newer:

1. **RISEN vs narrative for the 6 agent files.** The package's RISEN files are
   terse and prescriptive. The router's are longer, with worked examples and
   explicit confidence ladders. Do the agent prompts keep RISEN and gain the
   router's examples, or keep the narrative and gain RISEN's structure?
   Both are defensible; they produce materially different agents.
2. **`generic.md`** — the two are the same length and differ only in
   formatting. Either side is fine; pick one and delete the other.
3. **Whether the merged corpus is genuinely one file per agent**, or whether
   `subagents/coder-ts.md` (router-only) is a 12th agent file the package
   should adopt.

## 6. Execution order (when the decisions above are made)

1. Add the L0 Platform Boundary + L0 Profile Composition + L0 Router
   Capability Boundary to the router corpus. Re-record the effective-prompt
   baseline **deliberately**, after reading the diff. *(This is also the
   standalone compliance fix from §4 — it can land on its own.)*
2. Copy the router's `lanes/` into the canonical package.
3. Flatten the canonical package's role map and update
   `core/prompt-composer.js` to read from `packages/agent-model-files`.
4. Update `build-source-of-truth.py`'s `SECTIONS` table for flat naming.
5. Update `scripts/capture-corpus-parity.js` — with one corpus there is no
   parity left to hold, so the `PAIRS` table and the script itself should be
   retired, not maintained.
6. Delete the router's corpus copy; delete the app's generated mirror and
   point CI at the package only.
7. Update `.github/workflows/agent-model-files.yml` — its `paths:` filter
   currently includes `apps/onasis-agent-haven/docs/agent_model_files/**`.

Steps 3–7 change what the router composes from and **must** be validated with
the effective-prompt baseline showing a reviewed, understood diff — not a
silent change.

## 7. Corrections to the comparison framing

For whoever reads `COMPARISON-PLAN.md` next:

- "Prompts exist triplicated" → **two** corpora plus a CI-generated mirror.
- "Wire the router's `prompt-composer.js` to import from
  `packages/agent-model-files`" → the router already has a configurable
  `PROMPTS_ROOT`; the work is content adjudication, not import rewiring.
- "Run `test/corpus-parity.test.js` to verify zero persona regression" → the
  parity script asserts *divergence*, not equality, and will need replacing
  rather than passing. `prompt-baseline.test.js` is the real persona guard.
- The router composes **no** `SOURCE-OF-TRUTH.md` into a live prompt — it
  reads `SOUL.md` + a role file + a lane file. `SOURCE-OF-TRUTH.md` is a
  registry/assembly artifact, so a change to it does not by itself change
  live persona.
