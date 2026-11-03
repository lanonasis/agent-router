/**
 * Router profile manifests: generation, local validation, AI-refinement merge.
 *
 * Mirrors services/onasis-ai-router/core/profile-resolver.js:
 *   - REQUIRED_MANIFEST_FIELDS
 *   - validateManifest(): no system/developer message roles
 * and the `allowedTools` CEILING semantics in core/ai-service-router.js (a
 * manifest can only narrow what the lane offers, never widen it).
 *
 * Pure TypeScript with type-only imports so `scripts/check-profile-manifest.mjs`
 * can run it under Node type stripping.
 */
import type { RouterCatalog } from "@/services/routerCatalog";

/** Same list as REQUIRED_MANIFEST_FIELDS in the router's profile-resolver.js. */
export const REQUIRED_MANIFEST_FIELDS = [
  "profileId",
  "applicationId",
  "version",
  "status",
  "publicModel",
  "roleTemplate",
  "identityTemplate",
  "allowedTools",
  "memoryMode",
  "allowedMessageRoles",
  "limits",
] as const;

export interface ProfileLimits {
  maxInputTokens: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
}

export interface ProfileManifest {
  profileId: string;
  applicationId: string;
  version: string;
  status: string;
  publicModel: string;
  roleTemplate: string;
  identityTemplate: string;
  policyDocuments: string[];
  allowedTools: string[];
  memoryMode: string;
  allowedMessageRoles: string[];
  allowedContextFields: string[];
  boundUseCase: string;
  limits: ProfileLimits;
}

/** Catalog data the helpers use when the router serves it. */
export type CatalogLike = Partial<Pick<RouterCatalog, "personas" | "knownTools">> | null | undefined;

export interface LocalValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface GeneratedManifest {
  manifest: ProfileManifest;
  rationale: string[];
}

/** Used when /api/v1/catalog is not deployed. Mirrors USE_CASES in vendors/index.js (minus the tool-proxy passthrough). */
export const STATIC_USE_CASES: { useCase: string; description: string }[] = [
  { useCase: "landing-guide", description: "Onboarding AI guide on landing pages" },
  { useCase: "ask-ai", description: 'Quick "Ask AI" button on index and dashboard pages' },
  { useCase: "dashboard-assistant", description: "Dashboard and metrics assistant" },
  { useCase: "support-chat", description: "Customer support chat" },
  { useCase: "content-generation", description: "Writing and content generation" },
  { useCase: "code-assist", description: "Code assistance and refactoring" },
  { useCase: "memory-analysis", description: "Memory recall and analysis" },
  { useCase: "memory-analysis-json", description: "Memory analysis with structured JSON output" },
  { useCase: "repl-nlp", description: "Natural-language CLI / terminal commands" },
];

export const READ_ONLY_MEMORY_TOOLS = ["memory.search", "memory.list", "memory.get"];
export const STATIC_KNOWN_TOOLS = [...READ_ONLY_MEMORY_TOOLS, "memory.write"];
export const DEFAULT_USE_CASE = "ask-ai";

const SLUG_RE = /^[a-z0-9-]{3,48}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const KNOWN_STATUSES = ["draft", "active", "disabled", "deprecated"];
const FORBIDDEN_ROLES = ["system", "developer"];

// ── use-case inference ───────────────────────────────────────────────────────

interface IntentRule {
  useCase: string;
  /** Regexes; each match adds `weight`. Phrases weigh more than single words. */
  patterns: { re: RegExp; weight: number; label: string }[];
}

const w = (re: RegExp, label: string, weight = 1) => ({ re, weight, label });

const INTENT_RULES: IntentRule[] = [
  {
    useCase: "memory-analysis",
    patterns: [
      w(/\bmemor(?:y|ies)\b/, "memory", 2),
      w(/\brecall(?:s|ing)?\b/, "recall", 2),
      w(/\bnotes?\b/, "notes", 1),
      w(/\bremember(?:s|ing)?\b/, "remember", 1),
      w(/\bwhat did i (?:save|write|note)\b/, "what did I save", 3),
      w(/\bsaved (?:items|notes|context)\b/, "saved items", 2),
    ],
  },
  {
    useCase: "code-assist",
    patterns: [
      w(/\bcode\b|\bcoding\b/, "code", 2),
      w(/\brefactor(?:s|ing)?\b/, "refactor", 2),
      w(/\bbugs?\b|\bdebug(?:ging)?\b/, "bug/debug", 2),
      w(/\bpull requests?\b|\bPRs?\b/i, "pull request", 2),
      w(/\bunit tests?\b|\btypescript\b|\bpython\b|\bfunction(?:s)?\b/, "programming terms", 1),
      w(/\bcode review\b/, "code review", 3),
    ],
  },
  {
    useCase: "content-generation",
    patterns: [
      w(/\bwrit(?:e|es|ing)\b/, "write", 2),
      w(/\bblog(?:s)?\b/, "blog", 2),
      w(/\bcopy(?:writing)?\b/, "copy", 2),
      w(/\barticles?\b|\bnewsletters?\b|\bdrafts?\b|\bsocial posts?\b/, "article/draft", 1),
      w(/\bcontent\b/, "content", 1),
    ],
  },
  {
    useCase: "support-chat",
    patterns: [
      w(/\bsupport\b/, "support", 2),
      w(/\bcustomers?\b/, "customer", 2),
      w(/\bhelp ?desk\b|\btickets?\b|\bfaq\b/, "helpdesk/ticket/FAQ", 2),
      w(/\bhelp(?:ing)? users?\b|\btroubleshoot(?:ing)?\b/, "help users", 1),
    ],
  },
  {
    useCase: "landing-guide",
    patterns: [
      w(/\bonboard(?:s|ing)?\b/, "onboarding", 2),
      w(/\blanding\b/, "landing", 2),
      w(/\bwelcome\b|\bvisitors?\b|\bgetting started\b/, "welcome/visitors", 1),
    ],
  },
  {
    useCase: "dashboard-assistant",
    patterns: [
      w(/\bdashboards?\b/, "dashboard", 2),
      w(/\bmetrics?\b/, "metrics", 2),
      w(/\banalytics\b|\bkpis?\b|\bcharts?\b|\busage stats\b/, "analytics/KPI", 1),
    ],
  },
  {
    useCase: "repl-nlp",
    patterns: [
      w(/\bcli\b/, "CLI", 2),
      w(/\bterminal\b/, "terminal", 2),
      w(/\bshell\b|\brepl\b/, "shell/REPL", 2),
      w(/\bcommands?\b/, "commands", 1),
      w(/\bnatural[- ]language commands?\b/, "natural-language commands", 3),
    ],
  },
];

export interface UseCaseScore {
  useCase: string;
  score: number;
  matched: string[];
}

export function scoreUseCases(task: string): UseCaseScore[] {
  const text = task.toLowerCase();
  return INTENT_RULES.map((rule) => {
    let score = 0;
    const matched: string[] = [];
    for (const p of rule.patterns) {
      // The PR pattern is case-insensitive by design; the rest run on lowercased text.
      if (p.re.test(p.re.flags.includes("i") ? task : text)) {
        score += p.weight;
        matched.push(p.label);
      }
    }
    return { useCase: rule.useCase, score, matched };
  }).sort((a, b) => b.score - a.score);
}

// ── helpers ──────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "to", "for", "of", "in", "on", "with", "that", "this", "my", "our", "your",
  "is", "are", "be", "i", "we", "you", "it", "as", "at", "by", "from", "can", "will", "should", "please",
  "agent", "assistant", "bot", "profile", "want", "need", "help", "me", "users", "user",
]);

export function slugifyTask(task: string): string {
  const words = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((x) => x && !STOPWORDS.has(x));
  let slug = words.slice(0, 4).join("-");
  if (slug.length > 48) slug = slug.slice(0, 48).replace(/-+$/, "");
  if (slug.length < 3) slug = slug ? `profile-${slug}` : "new-profile";
  return slug.slice(0, 48).replace(/-+$/, "") || "new-profile";
}

function personaFor(catalog: CatalogLike, useCase: string) {
  return catalog?.personas?.find((p) => p.useCase === useCase) ?? null;
}

/** Use cases to offer in pickers: live personas when available, else the static list. */
export function listUseCases(catalog?: CatalogLike): { useCase: string; description: string }[] {
  const live = catalog?.personas;
  if (live && live.length) return live.map((p) => ({ useCase: p.useCase, description: p.description }));
  return STATIC_USE_CASES;
}

function knownUseCaseIds(catalog: CatalogLike): string[] {
  return listUseCases(catalog).map((u) => u.useCase);
}

function knownToolSet(catalog: CatalogLike): { tools: string[]; live: boolean } {
  const live = catalog?.knownTools;
  return live && live.length ? { tools: live, live: true } : { tools: STATIC_KNOWN_TOOLS, live: false };
}

const WRITE_INTENT_RE = /\b(save|saves|saving|remember|store|stores|storing|note down|write (?:it )?to memory|persist)\b/i;

// ── generation ───────────────────────────────────────────────────────────────

export function generateManifest(taskDescription: string, catalog?: CatalogLike): GeneratedManifest {
  const task = taskDescription.trim();
  const rationale: string[] = [];

  // 1. boundUseCase
  const scores = scoreUseCases(task);
  const ids = knownUseCaseIds(catalog);
  const best = scores[0];
  let boundUseCase = DEFAULT_USE_CASE;
  if (best && best.score > 0) {
    boundUseCase = best.useCase;
    const tied = scores.filter((s) => s.score === best.score && s.useCase !== best.useCase);
    rationale.push(
      `boundUseCase = ${boundUseCase}: task mentions ${best.matched.map((m) => `"${m}"`).join(", ")} (score ${best.score}).` +
        (tied.length ? ` Tied with ${tied.map((t) => t.useCase).join(", ")}; kept the first by intent priority.` : ""),
    );
  } else {
    rationale.push(`boundUseCase = ${DEFAULT_USE_CASE}: no intent keywords matched, so the general-purpose lane is the safe default.`);
  }
  if (!ids.includes(boundUseCase)) {
    rationale.push(`The router's live catalog does not list "${boundUseCase}"; falling back to ${DEFAULT_USE_CASE}.`);
    boundUseCase = ids.includes(DEFAULT_USE_CASE) ? DEFAULT_USE_CASE : ids[0] ?? DEFAULT_USE_CASE;
  }

  // 2. allowedTools
  const persona = personaFor(catalog, boundUseCase);
  const known = knownToolSet(catalog).tools;
  const laneTools = persona ? persona.tools : READ_ONLY_MEMORY_TOOLS;
  rationale.push(
    persona
      ? `Lane "${boundUseCase}" offers ${laneTools.length ? laneTools.join(", ") : "no tools"} (from the live catalog); allowedTools is a ceiling, so it starts there.`
      : `No live catalog entry for "${boundUseCase}"; defaulting allowedTools to the read-only memory tools.`,
  );
  let allowedTools = laneTools.filter((t) => known.includes(t) && t !== "memory.write");
  if (laneTools.includes("memory.write")) {
    rationale.push("memory.write is dropped from the lane default: a profile should not gain write access without an explicit reason.");
  }
  const wantsWrite = WRITE_INTENT_RE.test(task);
  if (wantsWrite && boundUseCase === "repl-nlp" && known.includes("memory.write")) {
    allowedTools = [...allowedTools, "memory.write"];
    rationale.push("memory.write added: the task asks to save/remember something and the lane is repl-nlp.");
  } else if (wantsWrite) {
    rationale.push(
      `Task mentions saving, but memory.write is only granted on the repl-nlp lane (this one is ${boundUseCase}); kept read-only. Edit allowedTools by hand if you really need it.`,
    );
  } else {
    rationale.push("memory.write excluded: the task does not ask to save anything.");
  }

  // 3. identity
  const profileId = slugifyTask(task);
  rationale.push(`profileId/applicationId = "${profileId}": slug of the first meaningful words in the task (must match ^[a-z0-9-]{3,48}$).`);
  rationale.push('Defaults: version 1.0.0, status "draft", publicModel "lzero", roleTemplate "generic", memoryMode "user-scoped" (each caller sees only their own memory).');
  rationale.push('allowedMessageRoles = user, assistant, tool: the router refuses manifests that permit system or developer roles.');
  rationale.push("limits: 8000 input tokens, 1200 output tokens, 60s timeout (same as the l0-concierge manifest).");

  const manifest: ProfileManifest = {
    profileId,
    applicationId: profileId,
    version: "1.0.0",
    status: "draft",
    publicModel: "lzero",
    roleTemplate: "generic",
    identityTemplate: "IDENTITY-LAYER.md",
    policyDocuments: ["policies.md"],
    allowedTools,
    memoryMode: "user-scoped",
    allowedMessageRoles: ["user", "assistant", "tool"],
    allowedContextFields: ["locale", "surface"],
    boundUseCase,
    limits: { maxInputTokens: 8000, maxOutputTokens: 1200, requestTimeoutMs: 60000 },
  };

  return { manifest, rationale };
}

// ── validation ───────────────────────────────────────────────────────────────

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Mirrors the router's required fields and the server-side validate endpoint's rules. */
export function validateManifestLocally(manifest: unknown, catalog?: CatalogLike): LocalValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { valid: false, errors: ["Manifest must be a JSON object."], warnings };
  }
  const m = manifest as Record<string, unknown>;

  // Required fields (router: REQUIRED_MANIFEST_FIELDS, checked with `=== undefined`).
  const missing = REQUIRED_MANIFEST_FIELDS.filter((f) => m[f] === undefined);
  if (missing.length) errors.push(`Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);

  for (const f of ["profileId", "applicationId"] as const) {
    if (m[f] !== undefined && (typeof m[f] !== "string" || !SLUG_RE.test(m[f] as string))) {
      errors.push(`${f} must match ^[a-z0-9-]{3,48}$.`);
    }
  }
  for (const f of ["version", "publicModel", "roleTemplate", "identityTemplate", "memoryMode", "status"] as const) {
    if (m[f] !== undefined && (typeof m[f] !== "string" || !(m[f] as string).trim())) errors.push(`${f} must be a non-empty string.`);
  }
  if (typeof m.version === "string" && m.version.trim() && !SEMVER_RE.test(m.version)) {
    warnings.push(`version "${m.version}" is not semver (expected e.g. 1.0.0).`);
  }
  if (typeof m.status === "string" && m.status.trim() && !KNOWN_STATUSES.includes(m.status)) {
    warnings.push(`status "${m.status}" is not one of ${KNOWN_STATUSES.join(", ")}.`);
  }
  if (m.profileId !== undefined && m.applicationId !== undefined && m.profileId !== m.applicationId) {
    warnings.push("profileId and applicationId differ; entitlements are matched against the profile, so check this is intended.");
  }

  // Message roles
  if (m.allowedMessageRoles !== undefined) {
    if (!isStringArray(m.allowedMessageRoles)) errors.push("allowedMessageRoles must be an array of strings.");
    else {
      const bad = m.allowedMessageRoles.filter((r) => FORBIDDEN_ROLES.includes(r));
      if (bad.length) errors.push(`allowedMessageRoles may not permit ${bad.join("/")}: this re-opens the system-prompt injection hole the router closes.`);
      if (!m.allowedMessageRoles.length) warnings.push("allowedMessageRoles is empty; no caller message could be accepted.");
    }
  }

  // Optional arrays
  for (const f of ["policyDocuments", "allowedContextFields"] as const) {
    if (m[f] !== undefined && !isStringArray(m[f])) errors.push(`${f} must be an array of strings.`);
  }

  // Limits
  if (m.limits !== undefined) {
    const l = m.limits as Record<string, unknown> | null;
    if (!l || typeof l !== "object" || Array.isArray(l)) errors.push("limits must be an object.");
    else {
      for (const k of ["maxInputTokens", "maxOutputTokens", "requestTimeoutMs"]) {
        const v = l[k];
        if (v === undefined) warnings.push(`limits.${k} is not set; the router default applies.`);
        else if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || !Number.isInteger(v)) errors.push(`limits.${k} must be a positive integer.`);
      }
    }
  }

  // Bound use case
  const ids = knownUseCaseIds(catalog);
  if (m.boundUseCase === undefined) {
    warnings.push("boundUseCase is not set; the profile will not be bound to a lane (the router does not require it, but profiles are meant to bind one).");
  } else if (typeof m.boundUseCase !== "string" || !ids.includes(m.boundUseCase)) {
    errors.push(`boundUseCase "${String(m.boundUseCase)}" is not a known use case (${ids.join(", ")}).`);
  }

  // Tools: subset of known tools, ceiling vs the lane
  if (m.allowedTools !== undefined) {
    if (!isStringArray(m.allowedTools)) errors.push("allowedTools must be an array of strings.");
    else {
      const tools = m.allowedTools;
      const { tools: known, live } = knownToolSet(catalog);
      const unknown = m.allowedTools.filter((t) => !known.includes(t));
      if (unknown.length) {
        const msg = `allowedTools contains tools the router does not know: ${unknown.join(", ")}.`;
        if (live) errors.push(msg);
        else warnings.push(`${msg} (checked against the built-in list: the live catalog was not available).`);
      }
      const dupes = m.allowedTools.filter((t, i, a) => a.indexOf(t) !== i);
      if (dupes.length) warnings.push(`allowedTools lists ${[...new Set(dupes)].join(", ")} more than once.`);

      const persona = typeof m.boundUseCase === "string" ? personaFor(catalog, m.boundUseCase) : null;
      if (persona) {
        const notOffered = m.allowedTools.filter((t) => !persona.tools.includes(t));
        if (notOffered.length) {
          warnings.push(`Ceiling: ${notOffered.join(", ")} ${notOffered.length > 1 ? "are" : "is"} not offered by lane "${persona.useCase}", so listing ${notOffered.length > 1 ? "them" : "it"} has no effect (allowedTools can only narrow).`);
        }
        const narrowed = persona.tools.filter((t) => !tools.includes(t));
        if (narrowed.length) {
          warnings.push(`This profile narrows lane "${persona.useCase}": ${narrowed.join(", ")} will be withheld.`);
        }
      }
      if (m.allowedTools.includes("memory.write")) {
        warnings.push("memory.write lets the model save on the user's behalf; keep it for lanes where saving is the point (e.g. repl-nlp).");
      }
      if (!m.allowedTools.length) warnings.push("allowedTools is empty: the profile will offer no tools at all.");
    }
  }

  if (m.memoryMode === "global") {
    warnings.push('memoryMode "global" shares memory across callers; "user-scoped" is the safe default.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── AI refinement ────────────────────────────────────────────────────────────

/** Fields a refinement may change. Identity-bearing fields stay validated; everything else is ignored. */
export const REFINABLE_FIELDS = [
  "profileId",
  "applicationId",
  "boundUseCase",
  "allowedTools",
  "memoryMode",
  "policyDocuments",
  "allowedContextFields",
  "limits",
] as const;

/** A USER-role prompt: the router rejects `system` messages from callers. */
export function buildRefinePrompt(task: string, draft: ProfileManifest, catalog?: CatalogLike): string {
  const useCases = listUseCases(catalog).map((u) => `${u.useCase} (${u.description})`).join("; ");
  const tools = knownToolSet(catalog).tools.join(", ");
  return [
    "You are helping configure an AI router profile manifest. Reply with ONE JSON object and nothing else.",
    `Task the profile is for: ${task.trim()}`,
    `Allowed boundUseCase values: ${useCases}.`,
    `Known tools (allowedTools must be a subset): ${tools}. Prefer read-only tools; only include memory.write if the task clearly requires saving.`,
    `You may set only these keys: ${REFINABLE_FIELDS.join(", ")}.`,
    "profileId and applicationId must match ^[a-z0-9-]{3,48}$. limits is {maxInputTokens, maxOutputTokens, requestTimeoutMs} as positive integers.",
    `Current draft: ${JSON.stringify(draft)}`,
  ].join("\n");
}

/** Pull the first JSON object out of free text (fenced block or bare braces). Returns null on failure. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  const candidates: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1]);
  candidates.push(text);
  for (const c of candidates) {
    const start = c.indexOf("{");
    if (start < 0) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          const parsed = JSON.parse(c.slice(start, i + 1));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
        } catch {
          /* try next candidate */
        }
        break;
      }
    }
  }
  return null;
}

/** Merge only known, well-typed fields from an untrusted draft. Returns the merged manifest and which keys changed. */
export function mergeRefinement(base: ProfileManifest, draft: Record<string, unknown>): { manifest: ProfileManifest; applied: string[]; ignored: string[] } {
  const next: ProfileManifest = { ...base, limits: { ...base.limits } };
  const applied: string[] = [];
  const ignored: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  for (const key of Object.keys(draft)) {
    const value = draft[key];
    if (!(REFINABLE_FIELDS as readonly string[]).includes(key)) {
      ignored.push(key);
      continue;
    }
    let ok = false;
    switch (key) {
      case "profileId":
      case "applicationId":
        if (typeof value === "string" && SLUG_RE.test(value)) { next[key] = value; ok = true; }
        break;
      case "boundUseCase":
      case "memoryMode":
        if (typeof value === "string" && value.trim()) { next[key] = value.trim(); ok = true; }
        break;
      case "allowedTools":
      case "policyDocuments":
      case "allowedContextFields":
        if (isStringArray(value)) { next[key] = [...new Set(value)]; ok = true; }
        break;
      case "limits":
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const l = value as Record<string, unknown>;
          for (const k of ["maxInputTokens", "maxOutputTokens", "requestTimeoutMs"] as const) {
            if (typeof l[k] === "number" && Number.isInteger(l[k]) && (l[k] as number) > 0) { next.limits[k] = l[k] as number; ok = true; }
          }
        }
        break;
    }
    if (!ok) ignored.push(key);
    else if (!same(base[key as keyof ProfileManifest], next[key as keyof ProfileManifest])) applied.push(key);
  }
  return { manifest: next, applied, ignored };
}
