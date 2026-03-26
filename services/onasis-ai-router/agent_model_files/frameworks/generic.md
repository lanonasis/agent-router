# Framework Adapter — Generic

> This adapter translates the agent architecture into framework-specific
> configurations. Use this for Ollama Modelfiles, raw API calls, or any
> LLM interface that doesn't have a dedicated adapter.

---

## Loading the Soul

Every agent session starts with the same ritual:

```
1. Load SOUL.md        → "Who am I?"
2. Load role prompt     → "What do I do?"
3. Load project context → "Where am I?"
```

### For Ollama (Modelfile)

```modelfile
FROM llama3.1:8b

PARAMETER temperature 0.3
PARAMETER top_k 20
PARAMETER top_p 0.85
PARAMETER num_ctx 8192
PARAMETER repeat_penalty 1.1
PARAMETER stop "## END"
PARAMETER stop "---DONE---"

SYSTEM """
[Contents of SOUL.md]

[Contents of the appropriate subagent prompt, e.g., coder.md]

You are operating in the context of: [project name]
Current working directory: [path]
Available tools: [tool list from tools.md]
"""
```

### For Claude API (Messages)

```python
messages = [
    {
        "role": "system",
        "content": f"""
{soul_content}

---

{agent_risen_prompt}

---

Project: {project_name}
Working Directory: {working_dir}
"""
    },
    {
        "role": "user",
        "content": task_description
    }
]
```

### For CrewAI

```python
from crewai import Agent, Task, Crew

coder_agent = Agent(
    role="Senior Software Engineer",
    goal="Write clean, tested, production-grade code",
    backstory=f"{soul_content}\n\n{coder_prompt}",
    verbose=True,
    allow_delegation=False,
    llm=llm_instance,  # Ollama or Claude
    tools=[file_read, file_write, shell_exec, code_search],
)
```

---

## Parameter Profiles

Different agents benefit from different temperature/creativity settings.

### Coder Profile
```
temperature: 0.2       # Precise, deterministic output
top_k: 20              # Narrow vocabulary selection
top_p: 0.8             # Conservative sampling
num_ctx: 8192          # Enough for medium files
repeat_penalty: 1.1    # Avoid repetitive patterns
```

### Researcher Profile
```
temperature: 0.5       # Moderate creativity for synthesis
top_k: 40              # Broader vocabulary for diverse sources
top_p: 0.9             # More varied phrasing
num_ctx: 8192          # Handle multiple sources
repeat_penalty: 1.0    # Allow natural repetition in analysis
```

### Reviewer Profile
```
temperature: 0.3       # Consistent, reliable feedback
top_k: 30              # Moderate vocabulary
top_p: 0.85            # Balanced sampling
num_ctx: 8192          # Handle large diffs
repeat_penalty: 1.1    # Avoid repetitive feedback patterns
```

### Architect Profile
```
temperature: 0.6       # Creative exploration of options
top_k: 50              # Wide vocabulary for design
top_p: 0.9             # Varied approaches
num_ctx: 16384         # Handle complex system descriptions
repeat_penalty: 1.0    # Allow pattern description
```

### Tester Profile
```
temperature: 0.2       # Deterministic test generation
top_k: 20              # Precise assertions
top_p: 0.8             # Conservative
num_ctx: 8192          # Handle test + source
repeat_penalty: 1.2    # Vary test cases, avoid copy-paste tests
```

---

## Context Window Management

### Priority Order (when context is tight)

The default priority order below can be overridden per agent via the
`context_priority` field in your runtime config. This matters because different
agents have different relationships with memory — a Researcher drawing on
prior findings needs memory more than a Coder with the full file already loaded.

**Default order**:
1. **SOUL.md** — Always loaded (identity is non-negotiable).
2. **Role prompt** — The agent's RISEN prompt.
3. **Relevant files** — Code being worked on.
4. **Task description** — What to do.
5. **Conversation history** — Recent exchanges (trimmed to last 3-5 turns).
6. **Memory context** — Retrieved from `${MEMORY_BACKEND_NAME}` or equivalent (top 3-5 results).

**Per-agent overrides** (set in your runtime config, for example `${AGENT_CONFIG_PATH}`):

```yaml
agents:
  coder:
    context_priority: [soul, role, files, task, history, memory]
    # Memory is least critical — coder works from files
  researcher:
    context_priority: [soul, role, memory, task, files, history]
    # Memory is elevated — prior research findings are high-value context
  architect:
    context_priority: [soul, role, memory, files, task, history]
    # Memory is elevated — prior design decisions inform new ones
  reviewer:
    context_priority: [soul, role, files, task, memory, history]
    # Standard — review needs the code first, memory for pattern context
  tester:
    context_priority: [soul, role, files, task, history, memory]
    # Standard — tests derive from code, not memory
  orchestrator:
    context_priority: [soul, role, task, memory, history, files]
    # Memory elevated — orchestrator needs project history for routing decisions
```

### When Context Overflows

Apply these rules in order, respecting the agent's `context_priority` (drop from the bottom of the priority list first):

1. Summarize conversation history instead of including full text.
2. Load only the relevant functions/classes from files, not entire files.
3. Trim memory to top-3 results instead of top-5.
4. If still over budget, drop the lowest-priority item per the agent's `context_priority`.
5. **Never drop SOUL.md or the role prompt** — these are always positions 1-2 regardless of override.

> **Note**: Memory context is **not** inherently disposable. For agents operating
> on a durable memory platform, prior session context can be the difference
> between a correct decision and a redundant one. The old "drop memory first"
> rule is replaced by per-agent priority ordering.

---

## Tool Integration Pattern

```python
def build_tool_context(tools: list[str]) -> str:
    """Build tool descriptions for the system prompt."""
    tool_defs = load_tool_definitions()  # From tools.md

    relevant = [t for t in tool_defs if t["name"] in tools]

    lines = ["## Available Tools\n"]
    for tool in relevant:
        lines.append(f"### {tool['name']}")
        lines.append(f"Approval: {tool['approval']}")
        lines.append(f"Schema: ```json\n{json.dumps(tool['schema'], indent=2)}\n```")
        lines.append("")

    return "\n".join(lines)
```

---

## Ollama Modelfile Templates

### Quick-Start: Coder Agent
```modelfile
FROM llama3.1:8b
PARAMETER temperature 0.2
PARAMETER num_ctx 8192
PARAMETER top_k 20
PARAMETER top_p 0.8
PARAMETER repeat_penalty 1.1

SYSTEM """
You are a senior software engineer. You ship clean, tested code.
You are calm under pressure, precise with types, allergic to TODOs.

Core principles: Move fast, stay clean, build trust, compound leverage.

Before writing any code:
1. Read existing code in the affected area.
2. Match existing patterns and conventions.
3. Identify the smallest correct change.

Quality bar:
- Explicit error handling. Tests alongside code.
- No console.log in production code.
- No hardcoded values that should be config.

When you're done, output your code between markers:
## CODE START
[your code]
## CODE END
"""

MESSAGE user Write a utility function to validate email addresses with proper types.
MESSAGE assistant ## CODE START
/**
 * Validates an email address using RFC 5322 simplified pattern.
 * Returns a discriminated union for type-safe error handling.
 */

type EmailValidationResult =
  | { valid: true; normalized: string }
  | { valid: false; error: string };

export function validateEmail(input: unknown): EmailValidationResult {
  if (typeof input !== "string") {
    return { valid: false, error: "Email must be a string" };
  }

  const trimmed = input.trim().toLowerCase();

  if (trimmed.length === 0) {
    return { valid: false, error: "Email cannot be empty" };
  }

  if (trimmed.length > 254) {
    return { valid: false, error: "Email exceeds maximum length of 254 characters" };
  }

  const pattern = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

  if (!pattern.test(trimmed)) {
    return { valid: false, error: "Invalid email format" };
  }

  return { valid: true, normalized: trimmed };
}
## CODE END
```

---

*Loaded by: ${PROMPT_BUILDER_NAME}*
