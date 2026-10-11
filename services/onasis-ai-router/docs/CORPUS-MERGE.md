# Model-file corpus merge — measured state

**Measured 2026-09-11 against the live tree. Read this before planning phase 3.**

There are two model-file corpora. Convergence plan phase 2 calls for reconciling
them, and the word *reconcile* is doing real work: this is a merge with a
persona change attached, not a rename.

| | path | shape | provenance |
|---|---|---|---|
| Canonical | `packages/agent-model-files` | flat | created by `30be88c`, Agent Heaven owns it |
| Effective | `services/onasis-ai-router/agent_model_files` | nested | untouched since 2026-03-11; **this is what the router composes from** |

`core/prompt-composer.js` resolves `../agent_model_files`. The router declares no
dependency on the canonical package and imports it nowhere.

## What the merge would cost

`PROMPTS_ROOT` and `PROMPT_USE_CASE_ROLE_MAP` are already env-overridable, so the
switch can be measured without changing code. Composing every lane against each
corpus, `hybrid` mode, identical runtime instruction:

| use case | router | package | delta |
|---|---|---|---|
| landing-guide | 13394 | 10176 | −24% |
| ask-ai | 13394 | 10176 | −24% |
| dashboard-assistant | 13394 | 10176 | −24% |
| support-chat | 13779 | 8817 | **−36%** |
| content-generation | 13394 | 10176 | −24% |
| code-assist | 11549 | 8618 | −25% |
| memory-analysis | 13394 | 10176 | −24% |
| repl-nlp | 11549 | 8618 | −25% |

Two findings from that run:

**The layout is not the obstacle.** With a flattened role map, every role file
resolves — zero unresolved lookups. `subagents/researcher.md` → `researcher.md`
is mechanical.

**The content is.** All 12 shared files differ, and the router's copy is larger
in 11 of them. Adopting the package removes a quarter to a third of the composed
prompt on every lane. Whatever is in those lines is live persona today, on
traffic that includes both concierges.

So the sequencing is: decide what the extra content *is* before deciding whether
to drop it. The number to keep in view is −36% on `support-chat`, the lane that
diverges most.

## What is guarded, and what is not

- `capture-prompt-baseline.js` pins the **router** corpus by way of the composed
  prompt. Edit a file there and the effective-prompt baseline fails.
- `capture-corpus-parity.js` pins **both** corpora against each other. Before it,
  the canonical package was entirely unguarded: Agent Heaven could edit it and
  every check in this repo would still pass while the two drifted further apart.
- Neither asserts the corpora are *equal*. They are not, and an assertion that
  fails on day one gets skipped rather than fixed.

## Order of work

1. Review the divergence file by file and decide, per file, which side wins.
   `capture-corpus-parity.js --report` lists them with line counts.
2. Merge into `packages/agent-model-files` — the canonical side, so the result
   is owned where the plan says it should be owned.
3. Point `prompt-composer.js` at the package and flatten `DEFAULT_USE_CASE_ROLE_MAP`.
4. Re-run `capture-prompt-baseline.js --check`. It will fail; that failure is the
   review artifact. Read the diff before re-recording.
5. Delete the router's copy, and drop the `PAIRS` table here — with one corpus
   there is nothing left to hold in parity.
