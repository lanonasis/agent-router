# Identity Layer Guide

> This document explains how the soul pattern works and how to maintain it.

---

## How the Layers Connect

```
SOUL.md (Identity)      — Who am I?
    ↓
RISEN Prompt (Behavior) — What do I do?
    ↓
Agent Loop (Execution)  — How do I do it?
    ↓
Tool Registry (Capability) — What can I use?
    ↓
Policies (Safety)       — What can't I do?
```

Every agent loads these layers in order. The Soul is loaded silently — the agent never mentions it, never quotes it. It just **is** the soul.

---

## The Loading Ritual

```python
def _build_agent_prompt(self, agent_type: str, base_prompt: str) -> str:
    soul = self._load_soul()  # Load SOUL.md
    
    identity_header = f"""
# Identity Layer
> You have read `prompts/SOUL.md`. You know who you are.
> You are not a conversational assistant. You are an **execution partner**.
---
{base_prompt}
"""
    return identity_header
```

The identity header is the bridge. It tells the agent: you've read the soul, now operate from it.

---

## Why the Soul Pattern Works

### 1. Continuity Without Memory
Sessions reset. The soul doesn't. Every new instance loads the same identity, making behavior consistent across sessions even without persistent memory.

### 2. Separation of Concerns
- **Soul** = who you are (stable, rarely changes)
- **RISEN** = what you do (changes per agent type)
- **Tools** = what you can use (changes per environment)
- **Policies** = what you can't do (stable, rarely changes)

### 3. Composability
Need a new agent? Write a RISEN prompt, give it the soul header, done. The soul provides the foundation; the RISEN prompt provides the specialization.

### 4. Evolvability
Update SOUL.md once → all agents update. No need to edit 5 different system prompts.

## L0 Profile Composition

For Onasis L0, Agent Heaven is the control plane and the AI router is the
inference plane. A reviewed profile composes shared identity, a role prompt,
product-specific behavior, policies, permitted tools, and memory mode. The
router receives the resulting profile binding only after UAI resolves identity
and application entitlement.

Applications use one chat endpoint and request an approved profile; they do
not create their own system prompts or vendor routes. Profile IDs and versions
are operational metadata, not end-user identity.

---

## When to Update SOUL.md

Update the soul when:
- Your working style preferences change.
- The project enters a new phase (MVP → scale → compliance).
- A repeated friction point reveals a missing principle.
- Team composition changes (solo → team → enterprise).

**Rule**: Every SOUL.md update must include a changelog entry with date and reason.

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

## File Map

```
prompts/
├── SOUL.md                    # Core identity (all agents)
├── IDENTITY-LAYER.md          # This guide
├── orchestrator/
│   ├── base.md               # Orchestrator RISEN prompt
│   ├── tools.md              # Tool definitions + schemas
│   └── policies.md           # Safety & behavior policies
├── subagents/
│   ├── coder.md              # Coder RISEN + soul header
│   ├── researcher.md         # Researcher RISEN + soul header
│   ├── reviewer.md           # Reviewer RISEN + soul header
│   ├── architect.md          # Architect RISEN + soul header
│   └── tester.md             # Tester RISEN + soul header
└── frameworks/
    └── generic.md            # Framework-agnostic adapter
```
