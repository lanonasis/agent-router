/**
 * SHARED CONTRACT — router catalog, profile validation and lane statistics.
 *
 * One file, written before the parallel work started, so the router endpoints
 * and the three dashboard features that consume them agree on one shape.
 * Change the shape here and in services/onasis-ai-router/core/catalog.js
 * together.
 *
 * Invariant (router CLAUDE.md): nothing here carries a vendor id, model name
 * or API key. Lanes are described by use case, never by who serves them.
 */
import { routerAuthHeaders, type RouterSettings } from "@/lib/routerSettings";

// ── GET /api/v1/catalog  (public: no credential required) ────────────────────

/** A persona the router is actually serving right now: one per use case. */
export interface LivePersona {
  /** Use case id, e.g. "memory-analysis". The stable key. */
  useCase: string;
  description: string;
  /** Prompt corpus role this lane composes (e.g. "researcher"), or null. */
  role: string | null;
  /** Lane prompt key under agent_model_files/lanes (e.g. "memory-intelligence"). */
  laneKey: string | null;
  /** Tool names offered by default on this lane (memory.search, …). */
  tools: string[];
  streamable: boolean;
  /** "active" when at least one healthy vendor can serve the lane right now. */
  status: "active" | "degraded" | "unavailable";
  /** Usable vendor slots right now / declared slots. Counts only, never names. */
  servingCapacity: { available: number; declared: number };
}

/** A provisioned profile manifest (profiles/*.json), as the router loaded it. */
export interface LiveProfile {
  profileId: string;
  applicationId: string;
  version: string;
  status: string;
  boundUseCase: string;
  allowedTools: string[];
  memoryMode: string;
}

export interface RouterCatalog {
  personas: LivePersona[];
  profiles: LiveProfile[];
  /** Every tool name the router knows how to offer (for manifest validation). */
  knownTools: string[];
  generatedAt: string;
}

// ── POST /api/v1/profiles/validate  (public: validates, never persists) ──────

export interface ProfileValidationResult {
  valid: boolean;
  /** Blocking problems — the router would refuse to load this manifest. */
  errors: string[];
  /** Non-blocking advice (e.g. tool narrower than the lane offers). */
  warnings: string[];
  /** The manifest as the router normalised it, when valid. */
  normalised?: Record<string, unknown>;
}

// ── GET /api/v1/ops/lane-stats  (credential required, same as ops/activity) ──

export interface LaneStat {
  useCase: string;
  total: number;
  completed: number;
  /** Served after at least one vendor failed over. Counts as a success. */
  recovered: number;
  failed: number;
  inProgress: number;
  /** (completed + recovered) / (total - inProgress), 0..1, null when no finished requests. */
  successRate: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  lastSeenAt: string | null;
}

export interface LaneStatsResponse {
  scope: "all" | "organization";
  /** Window the stats cover: the in-memory buffer, plus persisted days if enabled. */
  window: { from: string | null; to: string; source: "buffer" | "persisted" };
  lanes: LaneStat[];
  timestamp: string;
}

export class RouterCatalogError extends Error {
  constructor(
    public kind: "no-credential" | "unauthorized" | "not-deployed" | "unreachable" | "http",
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new RouterCatalogError("unreachable", "The router can't be reached from this browser.");
  }
  if (res.status === 401 || res.status === 403) throw new RouterCatalogError("unauthorized", "The router rejected the credential.");
  if (res.status === 404) throw new RouterCatalogError("not-deployed", "This router version doesn't have this endpoint yet.");
  if (!res.ok) throw new RouterCatalogError("http", `Router answered HTTP ${res.status}.`);
  return res.json() as Promise<T>;
}

export function fetchRouterCatalog(settings: RouterSettings): Promise<RouterCatalog> {
  return call<RouterCatalog>(`${settings.url}/api/v1/catalog`, { headers: { Accept: "application/json" } });
}

export function validateProfileManifest(settings: RouterSettings, manifest: unknown): Promise<ProfileValidationResult> {
  return call<ProfileValidationResult>(`${settings.url}/api/v1/profiles/validate`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ manifest }),
  });
}

export function fetchLaneStats(settings: RouterSettings): Promise<LaneStatsResponse> {
  const headers = routerAuthHeaders(settings);
  if (!Object.keys(headers).length) {
    return Promise.reject(new RouterCatalogError("no-credential", "Add a router API key in Settings to read lane statistics."));
  }
  return call<LaneStatsResponse>(`${settings.url}/api/v1/ops/lane-stats`, {
    headers: { Accept: "application/json", ...headers },
  });
}
