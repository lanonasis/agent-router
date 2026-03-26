# Tool Registry — Definitions & Schemas

> These tools are available to all agents. Each tool has an approval level,
> JSON schema for validation, and execution constraints.

---

## Approval Levels

| Level | Meaning | Agent Behavior |
|-------|---------|----------------|
| `auto` | No approval needed | Execute immediately |
| `notify` | Execute, then inform user | Log the action |
| `approve` | Wait for user approval | Present plan, pause |
| `critical` | Requires explicit typed confirmation | Present risk assessment, wait |

---

## Project Boundary Enforcement

> **All file and shell operations are scoped to `PROJECT_ROOT` by default.**
> Access outside `PROJECT_ROOT` is only allowed when a tool's `boundary_override`
> explicitly permits it; otherwise it is **blocked**.

### Path Validation (applied before every file/shell tool call)

```python
def validate_path(path: str, project_root: str) -> str:
    """Resolve and validate that path is within project_root.
    Raises SecurityError if path escapes the boundary."""
    resolved = os.path.realpath(os.path.join(project_root, path))
    if not resolved.startswith(os.path.realpath(project_root)):
        raise SecurityError(
            f"Path '{path}' resolves to '{resolved}' which is "
            f"outside project root '{project_root}'"
        )
    return resolved
```

### Rules
1. **All paths are resolved to absolute** via `realpath` before any operation.
2. **Symlinks are followed and re-validated** — a symlink inside the project that points outside is rejected.
3. **`..` traversal is resolved, then checked** — `src/../../etc/passwd` resolves and fails.
4. **`PROJECT_ROOT` is set at session init** and cannot be changed by tool calls.
5. **Paths outside `PROJECT_ROOT` require the tool's `boundary_override` level** (for example, `approve` or `critical`) or are **BLOCKED**.

### Protected Paths (never writable; read rules vary by tool)
- `.env`, `.env.*` — secrets files (read-only via `read_file`, never writable)
- `.git/` — git internals (read-only via git CLI tools instead)
- `node_modules/` — managed by package manager only (never writable)
- Any file matching patterns in `.gitignore` that are secrets-related (read-only)

---

## File Operations

### read_file
Read the contents of a file.

```json
{
  "name": "read_file",
  "approval": "auto",
  "boundary": "PROJECT_ROOT",
  "boundary_override": "critical",
  "schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Path relative to PROJECT_ROOT (resolved and validated before execution)"
      },
      "lines": {
        "type": "object",
        "properties": {
          "start": { "type": "integer", "minimum": 1 },
          "end": { "type": "integer", "minimum": 1 }
        },
        "description": "Optional line range to read"
      }
    },
    "required": ["path"]
  }
}
```

### write_file
Create a new file or overwrite an existing one.

```json
{
  "name": "write_file",
  "approval": "approve",
  "boundary": "PROJECT_ROOT",
  "boundary_override": "BLOCKED",
  "protected_paths": [".env", ".env.*", ".git/**", "node_modules/**"],
  "approval_override": {
    "notify": ["*.test.*", "*.spec.*", "*.md", "*.txt"],
    "approve": ["src/**", "lib/**", "packages/**"]
  },
  "schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Path relative to PROJECT_ROOT (resolved and validated before execution)"
      },
      "content": {
        "type": "string",
        "description": "Full content of the file"
      },
      "overwrite": {
        "type": "boolean",
        "default": false,
        "description": "Whether to overwrite if file exists"
      }
    },
    "required": ["path", "content"]
  }
}
```

**Write approval escalation**: If `overwrite: true` and the target file exists, approval escalates one level (notify → approve, approve → critical). Writing outside `PROJECT_ROOT` is always **BLOCKED** — not even `critical` approval can override this.

### edit_file
Apply targeted edits to an existing file.

```json
{
  "name": "edit_file",
  "approval": "approve",
  "boundary": "PROJECT_ROOT",
  "boundary_override": "BLOCKED",
  "protected_paths": [".env", ".env.*", ".git/**", "node_modules/**"],
  "schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Path relative to PROJECT_ROOT (resolved and validated before execution)"
      },
      "edits": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "old_text": {
              "type": "string",
              "description": "Exact text to find (must be unique in file)"
            },
            "new_text": {
              "type": "string",
              "description": "Replacement text"
            }
          },
          "required": ["old_text", "new_text"]
        },
        "description": "Array of find-and-replace operations"
      }
    },
    "required": ["path", "edits"]
  }
}
```

**Note**: `edit_file` approval was elevated from `notify` to `approve`. Edits are mutations — they deserve the same approval gate as writes.

### list_directory
List files and directories at a given path.

```json
{
  "name": "list_directory",
  "approval": "auto",
  "boundary": "PROJECT_ROOT",
  "boundary_override": "approve",
  "schema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Path relative to PROJECT_ROOT"
      },
      "depth": {
        "type": "integer",
        "default": 2,
        "minimum": 1,
        "maximum": 5,
        "description": "How many levels deep to list"
      },
      "include_hidden": {
        "type": "boolean",
        "default": false
      }
    },
    "required": ["path"]
  }
}
```

---

## Shell Operations

### execute_command
Run a shell command scoped to the project root.

```json
{
  "name": "execute_command",
  "approval": "approve",
  "boundary": "PROJECT_ROOT",
  "boundary_override": "BLOCKED",
  "execution_model": "allowlist_first",
  "allowed_commands": {
    "auto": {
      "read_only": ["ls", "cat", "head", "tail", "wc", "grep", "find", "echo", "pwd", "which", "file", "stat", "diff"],
      "version_checks": ["node --version", "npm --version", "python3 --version", "git --version"],
      "git_read": ["git status", "git log", "git diff", "git branch", "git remote -v", "git show"]
    },
    "notify": {
      "build_test": ["npm test", "npm run lint", "npm run build", "npm run typecheck", "npx vitest", "npx tsc --noEmit"],
      "git_stage": ["git add", "git commit"]
    },
    "approve": {
      "install": ["npm install", "npm ci", "pip install"],
      "git_push": ["git push", "git merge", "git rebase", "git checkout", "git switch"]
    },
    "critical": {
      "destructive": ["git reset", "git force-push", "npm publish", "docker build", "docker push"]
    }
  },
  "blocked_patterns": [
    "rm -rf",
    "rm -r /",
    "rm -r ~",
    ":(){ :|:& };:",
    "mkfs",
    "dd if=",
    "> /dev/",
    "chmod -R 777",
    "curl * | sh",
    "curl * | bash",
    "wget * | sh",
    "wget * | bash",
    "eval $(",
    "sudo",
    "su -",
    "DROP DATABASE",
    "DROP TABLE",
    "TRUNCATE",
    "DELETE FROM",
    "shutdown",
    "reboot",
    "systemctl stop",
    "kill -9",
    "pkill",
    "nohup",
    ">/dev/null 2>&1 &",
    "disown"
  ],
  "validation_rules": {
    "require_working_directory": true,
    "working_directory_must_be_within": "PROJECT_ROOT",
    "reject_chained_commands_unless_approved": true,
    "max_pipe_depth": 3,
    "reject_backgrounding": true,
    "reject_redirects_outside_project": true
  },
  "schema": {
    "type": "object",
    "properties": {
      "command": {
        "type": "string",
        "description": "Shell command to execute (validated against allowlist)"
      },
      "working_directory": {
        "type": "string",
        "default": "PROJECT_ROOT",
        "description": "Must be within PROJECT_ROOT (required, defaults to PROJECT_ROOT)"
      },
      "timeout_seconds": {
        "type": "integer",
        "default": 30,
        "maximum": 120
      }
    },
    "required": ["command"]
  }
}
```

**Command validation pipeline** (applied in order):
1. **Blocked pattern check** — reject if any blocked pattern appears anywhere in the command string (substring match, case-insensitive).
2. **Allowlist match** — the command's base executable must appear in the allowlist. Unknown commands default to `approve` level.
3. **Chain/pipe analysis** — commands using `&&`, `||`, `;`, or `|` are decomposed; each segment is validated independently. If any segment fails, the entire command is rejected.
4. **Working directory validation** — `working_directory` is resolved via `realpath` and must be within `PROJECT_ROOT`.
5. **Output redirect check** — redirects (`>`, `>>`) must target paths within `PROJECT_ROOT`.

**Unrecognized commands**: Any command not in the allowlist defaults to `approve` approval level and gets logged with a `[UNRECOGNIZED_CMD]` audit tag. This prevents the allowlist from becoming a blocker while maintaining visibility.

---

## Search Operations

### search_code
Search for patterns across the codebase.

```json
{
  "name": "search_code",
  "approval": "auto",
  "schema": {
    "type": "object",
    "properties": {
      "pattern": {
        "type": "string",
        "description": "Search pattern (supports regex)"
      },
      "path": {
        "type": "string",
        "default": ".",
        "description": "Directory to search in"
      },
      "file_pattern": {
        "type": "string",
        "description": "Glob pattern for file types (e.g., '*.ts')"
      },
      "max_results": {
        "type": "integer",
        "default": 20,
        "maximum": 100
      }
    },
    "required": ["pattern"]
  }
}
```

### search_semantic
Semantic search over project files using embeddings.

```json
{
  "name": "search_semantic",
  "approval": "auto",
  "schema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Natural language query"
      },
      "scope": {
        "type": "string",
        "enum": ["project", "workspace", "memory"],
        "default": "project"
      },
      "top_k": {
        "type": "integer",
        "default": 5,
        "maximum": 20
      }
    },
    "required": ["query"]
  }
}
```

---

## Web Operations

### web_search
Search the web for information.

```json
{
  "name": "web_search",
  "approval": "auto",
  "schema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query"
      },
      "max_results": {
        "type": "integer",
        "default": 5,
        "maximum": 10
      }
    },
    "required": ["query"]
  }
}
```

### web_fetch
Fetch content from a URL.

```json
{
  "name": "web_fetch",
  "approval": "notify",
  "schema": {
    "type": "object",
    "properties": {
      "url": {
        "type": "string",
        "format": "uri",
        "description": "URL to fetch"
      },
      "extract_text": {
        "type": "boolean",
        "default": true,
        "description": "Whether to extract text content"
      }
    },
    "required": ["url"]
  }
}
```

---

## Memory Operations

### memory_read
Read from the agent's memory store (LanOnasis).

```json
{
  "name": "memory_read",
  "approval": "auto",
  "schema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Semantic search query for memory"
      },
      "tags": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Filter by tags"
      },
      "top_k": {
        "type": "integer",
        "default": 5
      }
    },
    "required": ["query"]
  }
}
```

### memory_write
Write to the agent's memory store.

```json
{
  "name": "memory_write",
  "approval": "notify",
  "schema": {
    "type": "object",
    "properties": {
      "content": {
        "type": "string",
        "description": "Content to store"
      },
      "tags": {
        "type": "array",
        "items": { "type": "string" }
      },
      "metadata": {
        "type": "object",
        "description": "Additional metadata"
      },
      "continuity_key": {
        "type": "string",
        "description": "Idempotency key to prevent duplicate writes"
      }
    },
    "required": ["content", "continuity_key"]
  }
}
```

---

## Tool Execution Rules

1. **One tool per iteration.** Never chain tool calls without analyzing results.
2. **Validate before calling.** Check schema compliance before execution.
3. **Handle failures gracefully.** If a tool fails, log the error, do not retry more than once automatically.
4. **Respect approval levels.** Never bypass — even in "auto" mode, the approval level defines the contract.
5. **Blocked patterns are absolute.** No override, no exception, no workaround.

---

*Loaded by: tool_registry.py → load_tool_definitions()*
