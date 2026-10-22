'use strict';

const fs = require('fs');
const path = require('path');

const VALID_PROMPT_MODES = new Set(['runtime', 'hybrid', 'embedded']);
const DEFAULT_PROMPT_MODE = 'hybrid';

const BUNDLED_PROMPTS_ROOT = path.resolve(__dirname, '../agent_model_files');
const LANE_DIR = 'lanes';

const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);

/**
 * The single use-case → prompt table.
 *
 * Until 2026-09-11 a use case was registered in two unrelated places: the role
 * prompt here, and the lane prompt as a string literal in `vendors/index.js`
 * keyed by `USE_CASES[uc].systemPromptKey`. Two maps over the same key space,
 * with nothing comparing them — adding a use case and updating only one side
 * produced a lane that silently composed against the wrong half, and the
 * failure surfaced as persona drift rather than an error.
 *
 * Both halves are declared here now. `lane` names a file under `lanes/` in the
 * model-file corpus; `role` names one under `subagents/`.
 * `test/prompt-system-merge.test.js` asserts every use case in `USE_CASES`
 * resolves both, so the next use case cannot be half-registered.
 */
const DEFAULT_USE_CASE_PROMPTS = Object.freeze({
  'landing-guide':       Object.freeze({ role: 'subagents/researcher.md', lane: 'onboarding' }),
  'ask-ai':              Object.freeze({ role: 'subagents/researcher.md', lane: 'concise-helper' }),
  'dashboard-assistant': Object.freeze({ role: 'subagents/researcher.md', lane: 'full-assistant' }),
  'support-chat':        Object.freeze({ role: 'subagents/reviewer.md',   lane: 'support' }),
  'content-generation':  Object.freeze({ role: 'subagents/researcher.md', lane: 'creative' }),
  'code-assist':         Object.freeze({ role: 'subagents/coder.md',      lane: 'technical' }),
  'memory-analysis':     Object.freeze({ role: 'subagents/researcher.md', lane: 'memory-intelligence' }),
  'memory-analysis-json': Object.freeze({ role: 'subagents/researcher.md', lane: 'memory-analysis-json' }),
  'repl-nlp':            Object.freeze({ role: 'subagents/coder.md',      lane: 'repl-assistant' }),
  default:               Object.freeze({ role: 'subagents/researcher.md', lane: 'concise-helper' }),
});

const DEFAULT_USE_CASE_ROLE_MAP = Object.freeze(
  Object.fromEntries(
    Object.entries(DEFAULT_USE_CASE_PROMPTS).map(([useCase, entry]) => [useCase, entry.role])
  )
);

const DEFAULT_USE_CASE_LANE_MAP = Object.freeze(
  Object.fromEntries(
    Object.entries(DEFAULT_USE_CASE_PROMPTS).map(([useCase, entry]) => [useCase, entry.lane])
  )
);

class PromptComposer {
  constructor(config = {}) {
    this.promptsRoot = this.resolvePromptsRoot(
      config.promptsRoot ||
      process.env.PROMPTS_ROOT ||
      process.env.OLLAMA_PROMPTS_ROOT ||
      path.resolve(__dirname, '../agent_model_files')
    );
    this.promptMode = this.resolvePromptMode(
      config.promptMode ||
      process.env.PROMPT_IDENTITY_MODE ||
      process.env.OLLAMA_PROMPT_MODE
    );
    this.promptLabel = path.relative(process.cwd(), this.promptsRoot) || this.promptsRoot;
    this.fileCache = new Map();
    this.laneFallbackWarned = false;
    this.roleMap = this.resolveMap(
      config.roleMap || process.env.PROMPT_USE_CASE_ROLE_MAP,
      DEFAULT_USE_CASE_ROLE_MAP
    );
    this.laneMap = this.resolveMap(
      config.laneMap || process.env.PROMPT_USE_CASE_LANE_MAP,
      DEFAULT_USE_CASE_LANE_MAP
    );
  }

  resolvePromptsRoot(candidate) {
    if (!candidate || typeof candidate !== 'string') {
      return path.resolve(__dirname, '../agent_model_files');
    }

    return path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(process.cwd(), candidate);
  }

  resolvePromptMode(candidate) {
    const legacyEmbedded = (process.env.USE_EMBEDDED_PROMPT || '').toLowerCase() === 'true';
    const fallback = legacyEmbedded ? 'embedded' : DEFAULT_PROMPT_MODE;
    const resolved = String(candidate || fallback).trim().toLowerCase();
    return VALID_PROMPT_MODES.has(resolved) ? resolved : DEFAULT_PROMPT_MODE;
  }

  /**
   * Merge a map override over its defaults.
   *
   * Accepts either a JSON string (the env-var form) or an object (the
   * constructor form). It used to take only the string: passing an object to
   * the constructor parsed nothing, hit the `typeof !== 'string'` guard, and
   * returned the defaults — so `new PromptComposer({ roleMap: {...} })` looked
   * configured and silently was not.
   */
  resolveMap(rawOverride, defaults) {
    if (!rawOverride) {
      return defaults;
    }

    let parsed = rawOverride;
    if (typeof rawOverride === 'string') {
      try {
        parsed = JSON.parse(rawOverride);
      } catch (_) {
        return defaults;
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return defaults;
    }
    return { ...defaults, ...parsed };
  }

  readFileFromRoot(root, relativePath) {
    if (!relativePath || typeof relativePath !== 'string') {
      return null;
    }

    const cacheKey = `${root}::${relativePath}`;
    if (this.fileCache.has(cacheKey)) {
      return this.fileCache.get(cacheKey);
    }

    const absolutePath = path.resolve(root, relativePath);
    try {
      const content = fs.readFileSync(absolutePath, 'utf8').split(CRLF).join(LF).trim();
      const normalized = content.replaceAll('${PROMPTS_ROOT}', this.promptLabel);
      this.fileCache.set(cacheKey, normalized);
      return normalized;
    } catch (_) {
      this.fileCache.set(cacheKey, null);
      return null;
    }
  }

  readPromptFile(relativePath) {
    return this.readFileFromRoot(this.promptsRoot, relativePath);
  }

  /**
   * Read a lane prompt, falling back to the bundled corpus when the configured
   * one has no `lanes/` directory.
   *
   * The fallback exists because `PROMPTS_ROOT` is pointed at other corpora for
   * measurement — `capture-corpus-parity.js` composes every lane against
   * `packages/agent-model-files`, which carries role prompts but no lanes. A
   * missing lane file there should not blank the system prompt on a live
   * request, so the bundled copy answers and says so once. Failing loudly
   * instead would turn a measurement run into an outage; failing silently
   * would ship an unbranded assistant. One warning is the middle.
   */
  readLaneFile(laneKey) {
    if (!laneKey || typeof laneKey !== 'string') {
      return null;
    }

    const relativePath = `${LANE_DIR}/${laneKey}.md`;
    const configured = this.readFileFromRoot(this.promptsRoot, relativePath);
    if (configured !== null) {
      return configured;
    }

    if (path.resolve(this.promptsRoot) === BUNDLED_PROMPTS_ROOT) {
      return null;
    }

    const bundled = this.readFileFromRoot(BUNDLED_PROMPTS_ROOT, relativePath);
    if (bundled !== null && !this.laneFallbackWarned) {
      this.laneFallbackWarned = true;
      console.warn(
        `[prompt-composer] no ${LANE_DIR}/ in ${this.promptLabel}; ` +
        'reading lane prompts from the bundled corpus instead'
      );
    }
    return bundled;
  }

  resolveLaneKey(useCase) {
    if (Object.prototype.hasOwnProperty.call(this.laneMap, useCase)) {
      return this.laneMap[useCase];
    }
    return this.laneMap.default || null;
  }

  /**
   * The lane prompt for a `systemPromptKey`, with the same last-resort fallback
   * `vendors/index.js` applied when it owned these strings.
   */
  lanePromptForKey(laneKey) {
    const direct = this.readLaneFile(laneKey);
    if (direct) {
      return direct;
    }
    const fallbackKey = this.laneMap.default;
    return fallbackKey && fallbackKey !== laneKey ? this.readLaneFile(fallbackKey) : null;
  }

  lanePromptForUseCase(useCase) {
    return this.lanePromptForKey(this.resolveLaneKey(useCase));
  }

  resolveRolePromptPath(useCase) {
    if (Object.prototype.hasOwnProperty.call(this.roleMap, useCase)) {
      return this.roleMap[useCase];
    }
    return this.roleMap.default || null;
  }

  buildCompactRolePrompt(rolePrompt) {
    if (!rolePrompt || typeof rolePrompt !== 'string') {
      return null;
    }

    const boundaryPatterns = [
      '\n## Instructions',
      '\n## Steps',
      '\n## Expectation',
      '\n## Narrowing',
    ];

    let cutoff = rolePrompt.length;
    for (const pattern of boundaryPatterns) {
      const index = rolePrompt.indexOf(pattern);
      if (index !== -1) {
        cutoff = Math.min(cutoff, index);
      }
    }

    return rolePrompt.slice(0, cutoff).trim() || null;
  }

  compose({ useCase, runtimePrompt }) {
    const trimmedRuntimePrompt = typeof runtimePrompt === 'string' ? runtimePrompt.trim() : '';
    const soulPrompt = this.readPromptFile('SOUL.md');
    const rolePromptPath = this.resolveRolePromptPath(useCase);
    const rolePrompt = rolePromptPath ? this.readPromptFile(rolePromptPath) : null;
    const compactRolePrompt = this.buildCompactRolePrompt(rolePrompt);

    const richSections = [];
    if (soulPrompt) {
      richSections.push(`## Shared Identity\n${soulPrompt}`);
    }
    if (rolePrompt) {
      richSections.push(`## Role Prompt\n${rolePrompt}`);
    }
    if (trimmedRuntimePrompt) {
      richSections.push(`## Runtime Instructions\n${trimmedRuntimePrompt}`);
    }

    const richPrompt = richSections.join('\n\n').trim() || null;
    const compactSections = [];
    if (compactRolePrompt) {
      compactSections.push(`## Role Prompt\n${compactRolePrompt}`);
    } else if (rolePrompt) {
      compactSections.push(`## Role Prompt\n${rolePrompt}`);
    } else if (soulPrompt) {
      compactSections.push(`## Shared Identity\n${soulPrompt}`);
    }
    if (trimmedRuntimePrompt) {
      compactSections.push(`## Runtime Instructions\n${trimmedRuntimePrompt}`);
    }
    const compactPrompt = compactSections.join('\n\n').trim() || null;
    const runtimeOnlyPrompt = trimmedRuntimePrompt || null;

    return {
      mode: this.promptMode,
      promptsRoot: this.promptsRoot,
      promptLabel: this.promptLabel,
      rolePromptPath,
      usesSoul: Boolean(soulPrompt),
      usesRolePrompt: Boolean(rolePrompt),
      runtimePromptLength: runtimeOnlyPrompt ? runtimeOnlyPrompt.length : 0,
      compactPromptLength: compactPrompt ? compactPrompt.length : 0,
      richPromptLength: richPrompt ? richPrompt.length : 0,
      compactPrompt,
      richPrompt,
      runtimeOnlyPrompt,
      systemPromptForVendor(vendorId) {
        if (this.mode === 'runtime') {
          return this.runtimeOnlyPrompt;
        }

        if (vendorId === 'ollama' && this.mode === 'embedded') {
          return null;
        }

        if (vendorId === 'ollama') {
          return this.compactPrompt || this.richPrompt || this.runtimeOnlyPrompt;
        }

        return this.richPrompt || this.runtimeOnlyPrompt;
      },
    };
  }

  getConfigSnapshot() {
    return {
      mode: this.promptMode,
      promptsRoot: this.promptsRoot,
      promptLabel: this.promptLabel,
      roleMap: this.roleMap,
      laneMap: this.laneMap,
    };
  }
}

module.exports = {
  PromptComposer,
  DEFAULT_USE_CASE_PROMPTS,
  DEFAULT_USE_CASE_ROLE_MAP,
  DEFAULT_USE_CASE_LANE_MAP,
};
