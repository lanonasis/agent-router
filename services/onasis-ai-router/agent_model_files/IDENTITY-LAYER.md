# Identity Layer Guide

> This document explains how the soul pattern works and how to maintain it.

---

## How the Layers Connect

```
SOUL.md (Identity)         — Who am I?
    ↓
Role Prompt (Behavior)     — What do I do?
    ↓
Tool Registry (Capability) — What can I use?
    ↓
Policies (Safety)          — What can't I do?
    ↓
Runtime / Agent Loop       — How do I act on it?
```

Every agent loads these layers in order. The soul is loaded silently. The
agent should not talk about it as a document; it should operate from it.

---

## The Loading Ritual

```python
def build_agent_prompt(agent_prompt: str) -> str:
    soul = load_file("${PROMPTS_ROOT}/SOUL.md")

    return f"""
# Identity
You have read `${PROMPTS_ROOT}/SOUL.md`. You know who you are.
You are not a conversational assistant. You are an execution partner.

---

{agent_prompt}
"""
```

The identity header is the bridge. It tells the agent: you've read the soul,
now operate from it.

---

## Why the Soul Pattern Works

### 1. Continuity Without Memory
Sessions reset. The soul does not. Behavior stays consistent even when the
runtime has no persistent conversational memory.

### 2. Separation of Concerns
- **Soul** = who the agent is
- **Role prompt** = what the agent does
- **Tools** = what the agent can use
- **Policies** = what the agent must not do

### 3. Composability
Need a new agent? Write a new role prompt, keep the same soul, and the agent
inherits the same values and operating style.

### 4. Evolvability
Update `SOUL.md` once and every agent improves without rewriting each prompt.

---

## When to Update SOUL.md

Update the soul when:
- Working style preferences change.
- The project enters a new phase.
- Repeated friction reveals a missing principle.
- The team changes and the collaboration model shifts.

**Rule**: Every `SOUL.md` update must include a date and a reason.

---

## Agent Souls (Quick Reference)

| Agent | Soul Summary | Temperature |
|-------|-------------|-------------|
| **Coder** | Ships clean, tested code. Precise with types. | 0.2 |
| **Researcher** | Finds signal in noise. Cites everything. | 0.5 |
| **Reviewer** | Constructive critic. Always provides fixes. | 0.3 |
| **Architect** | Thinks in systems. Makes tradeoffs visible. | 0.6 |
| **Tester** | Breaks things so users don't. Zero flaky tests. | 0.2 |
| **Orchestrator** | Coordinates quality and momentum. Calm, decisive. | 0.4 |

---

## Source-of-Truth Workflow

This template supports two-way sync:
- `sync-source-of-truth.py`: extract individual files from `SOURCE-OF-TRUTH.md`
- `build-source-of-truth.py`: rebuild `SOURCE-OF-TRUTH.md` from the individual files

Section names in `SOURCE-OF-TRUTH.md` map directly to file paths such as
`orchestrator/base.md` and `subagents/coder.md`.

---

## File Map

```
prompts/
├── SOUL.md                    # Shared identity layer
├── IDENTITY-LAYER.md          # This guide
├── SOURCE-OF-TRUTH.md         # Canonical single-file reference
├── build-source-of-truth.py   # Rebuilds SOURCE-OF-TRUTH.md
├── sync-source-of-truth.py    # Extracts individual files from it
├── orchestrator/
│   ├── base.md                # Orchestrator base prompt
│   ├── tools.md               # Tool registry and schemas
│   └── policies.md            # Safety and behavior policies
├── subagents/
│   ├── architect.md           # System design specialist
│   ├── coder.md               # Language-agnostic implementation specialist
│   ├── coder-ts.md            # TypeScript specialization example
│   ├── researcher.md          # Evidence gathering specialist
│   ├── reviewer.md            # Code review specialist
│   └── tester.md              # Test generation specialist
└── frameworks/
    └── generic.md             # Framework adapter examples
```

<!-- CUSTOMIZE: Update the file map if you add language variants or framework-specific adapters. -->
