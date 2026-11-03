'use strict';

/**
 * Public service catalog, profile-manifest validation and lane statistics.
 *
 * Shapes are fixed by the shared contract in the dashboard
 * (apps/onasis-agent-haven/src/services/routerCatalog.ts) — change both
 * together.
 *
 * Hard invariant (CLAUDE.md): nothing produced here may carry a vendor id, a
 * model name or a key. Vendors appear ONLY as counts (servingCapacity). Every
 * function is pure and takes its collaborators as arguments so the tests can
 * inject health, tools and entries without booting the router.
 */

const { validateManifest } = require('./profile-resolver');

const toolName = (t) => (t && (t.function ? t.function.name : t.name)) || null;

/** "subagents/researcher.md" -> "researcher"; null stays null. */
function roleName(rolePath) {
  if (!rolePath || typeof rolePath !== 'string') return null;
  return rolePath.replace(/^.*\//, '').replace(/\.md$/, '') || null;
}

/** Union of every tool name the router can offer, sorted. */
function collectKnownTools(...definitionLists) {
  const names = new Set();
  for (const list of definitionLists) {
    for (const def of list || []) {
      const n = toolName(def);
      if (n) names.add(n);
    }
  }
  return [...names].sort();
}

/**
 * @param {object} deps
 * @param {object} deps.useCases                USE_CASES
 * @param {(uc:string)=>{role:?string,laneKey:?string}} deps.laneInfo
 * @param {(uc:string)=>string[]} deps.toolsForUseCase  tool names offered by default
 * @param {(uc:string)=>string[]} deps.declaredVendors  INTERNAL ids; only counted
 * @param {(uc:string)=>string[]} deps.eligibleVendors  INTERNAL ids that resolve active
 * @param {(vendorId:string)=>boolean} deps.isUnhealthy
 * @param {object[]} deps.profiles              loaded manifests
 * @param {string[]} deps.knownTools
 * @param {()=>Date} [deps.now]
 */
function buildCatalog(deps) {
  const now = deps.now || (() => new Date());
  const personas = Object.entries(deps.useCases).map(([useCase, cfg]) => {
    const declaredIds = deps.declaredVendors(useCase) || [];
    const eligible = deps.eligibleVendors(useCase) || [];
    const declared = declaredIds.length || eligible.length;
    const available = Math.min(declared, eligible.filter((id) => !deps.isUnhealthy(id)).length);
    const status = available === 0 ? 'unavailable' : available < declared ? 'degraded' : 'active';
    const lane = deps.laneInfo(useCase) || {};
    return {
      useCase,
      description: String(cfg.description || ''),
      role: lane.role || null,
      laneKey: lane.laneKey || cfg.systemPromptKey || null,
      tools: [...(deps.toolsForUseCase(useCase) || [])],
      streamable: Boolean(cfg.streamable),
      status,
      servingCapacity: { available, declared },
    };
  });

  const profiles = (deps.profiles || []).map((m) => ({
    profileId: m.profileId,
    applicationId: m.applicationId,
    version: m.version,
    status: m.status,
    boundUseCase: m.boundUseCase,
    allowedTools: Array.isArray(m.allowedTools) ? [...m.allowedTools] : [],
    memoryMode: m.memoryMode,
  }));

  return {
    personas,
    profiles,
    knownTools: [...deps.knownTools],
    generatedAt: now().toISOString(),
  };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate a submitted profile manifest. Never persists, never throws.
 *
 * @param {*} manifest
 * @param {object} deps
 * @param {object} deps.useCases
 * @param {string[]} deps.knownTools
 * @param {(uc:string)=>string[]} deps.toolsForUseCase
 * @param {(uc:string)=>boolean} deps.writesAllowed   lane permits memory writes
 * @returns {{status:number, result:{valid:boolean,errors:string[],warnings:string[],normalised?:object}}}
 */
function validateProfile(manifest, deps) {
  if (!isPlainObject(manifest)) {
    return {
      status: 400,
      result: { valid: false, errors: ['manifest must be a JSON object'], warnings: [] },
    };
  }

  const errors = [];
  const warnings = [];

  // The loader's own check first, so "valid" here means "the router would load it".
  try {
    validateManifest(manifest, 'submitted manifest');
  } catch (e) {
    errors.push(e && e.message ? e.message : 'manifest failed validation');
  }

  const tools = Array.isArray(manifest.allowedTools) ? manifest.allowedTools : null;
  if (manifest.allowedTools !== undefined && !tools) errors.push('allowedTools must be an array of tool names');
  if (manifest.allowedMessageRoles !== undefined && !Array.isArray(manifest.allowedMessageRoles)) {
    errors.push('allowedMessageRoles must be an array');
  }
  if (manifest.limits !== undefined && !isPlainObject(manifest.limits)) errors.push('limits must be an object');

  const bound = manifest.boundUseCase;
  const laneKnown = typeof bound === 'string' && Object.prototype.hasOwnProperty.call(deps.useCases, bound);
  if (!laneKnown) {
    errors.push(bound === undefined
      ? 'boundUseCase is required'
      : `boundUseCase '${String(bound)}' is not a use case this router serves`);
  }

  if (tools) {
    const known = new Set(deps.knownTools);
    const offered = laneKnown ? new Set(deps.toolsForUseCase(bound)) : null;
    for (const t of tools) {
      if (typeof t !== 'string') { errors.push('allowedTools entries must be strings'); continue; }
      if (!known.has(t)) { errors.push(`allowedTools: '${t}' is not a tool this router knows`); continue; }
      if (offered && !offered.has(t)) {
        warnings.push(`profile allowedTools is a ceiling; ${t} is not offered on ${bound}, so it will never be available`);
      }
    }
    if (tools.includes('memory.write') && laneKnown && !deps.writesAllowed(bound)) {
      warnings.push(`memory.write is listed but ${bound} does not permit memory writes`);
    }
  }

  const maxOut = isPlainObject(manifest.limits) ? manifest.limits.maxOutputTokens : undefined;
  if (laneKnown && typeof maxOut === 'number' && maxOut > deps.useCases[bound].maxTokens) {
    warnings.push(`limits.maxOutputTokens (${maxOut}) is above the ${bound} lane ceiling (${deps.useCases[bound].maxTokens}); it will be clamped`);
  }

  if (manifest.publicModel !== undefined && manifest.publicModel !== 'lzero') {
    warnings.push(`publicModel '${String(manifest.publicModel)}' is not 'lzero', the only public model name`);
  }

  const valid = errors.length === 0;
  const result = { valid, errors, warnings };
  if (valid) result.normalised = JSON.parse(JSON.stringify(manifest));
  return { status: 200, result };
}

/** Nearest-rank percentile of an ascending-sorted array. */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

/**
 * Aggregate activity entries into per-lane statistics.
 * In-progress entries count toward `total`/`inProgress` only; they never
 * affect success rate or latency. Entries with no useCase land in "unknown".
 */
function aggregateLaneStats(entries) {
  const lanes = new Map();
  for (const e of entries || []) {
    if (!e) continue;
    const key = e.useCase || 'unknown';
    let l = lanes.get(key);
    if (!l) {
      l = { useCase: key, total: 0, completed: 0, recovered: 0, failed: 0, inProgress: 0, lat: [], last: null };
      lanes.set(key, l);
    }
    const s = e.status;
    if (s === 'completed') l.completed += 1;
    else if (s === 'recovered') l.recovered += 1;
    else if (s === 'failed') l.failed += 1;
    else if (s === 'in_progress') l.inProgress += 1;
    else continue;
    l.total += 1;
    if (s !== 'in_progress' && typeof e.durationMs === 'number' && Number.isFinite(e.durationMs)) l.lat.push(e.durationMs);
    if (e.startedAt && (!l.last || String(e.startedAt) > l.last)) l.last = String(e.startedAt);
  }
  return [...lanes.values()]
    .filter((l) => l.total > 0)
    .map((l) => {
      const finished = l.total - l.inProgress;
      const sorted = l.lat.slice().sort((a, b) => a - b);
      return {
        useCase: l.useCase,
        total: l.total,
        completed: l.completed,
        recovered: l.recovered,
        failed: l.failed,
        inProgress: l.inProgress,
        successRate: finished > 0 ? (l.completed + l.recovered) / finished : null,
        avgLatencyMs: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
        p95LatencyMs: percentile(sorted, 0.95),
        lastSeenAt: l.last,
      };
    })
    .sort((a, b) => b.total - a.total || a.useCase.localeCompare(b.useCase));
}

module.exports = { buildCatalog, validateProfile, aggregateLaneStats, collectKnownTools, roleName, percentile };
