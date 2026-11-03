// Pure status derivation for the router chain diagram. No runtime imports so
// it can be unit-checked under Node's type stripping.

export type LiveStatus = "ok" | "warn" | "crit" | "gap" | "unknown";

export interface BeatSample {
  /** epoch ms the probe finished */
  t: number;
  /** router answered with a parseable /health body */
  ok: boolean;
  latencyMs: number | null;
  /** router-reported status, null when unreachable */
  routerStatus: "healthy" | "degraded" | "unavailable" | null;
  /** e.g. "3/6", null when unreachable */
  vendorsHealthy: string | null;
}

/** One entry of /health `services.ai` (see core/vendor-health.js). */
export interface VendorHealthLike {
  status?: string;
  response_time?: number;
  reason?: string;
  stale?: boolean;
  circuit?: string;
}

export const REASON_MAX = 140;
export const BEAT_HISTORY = 30;

export function truncate(text: string, max = REASON_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

/** Push a sample, keeping the newest `max`. */
export function pushBeat(history: BeatSample[], sample: BeatSample, max = BEAT_HISTORY): BeatSample[] {
  return [...history, sample].slice(-max);
}

/**
 * Router node status from the beat history.
 *   last 2 beats failed -> gap (unreachable)
 *   last beat failed    -> warn (one blip is not an outage)
 *   router unavailable or 0 healthy vendors -> crit; degraded -> warn
 */
export function deriveRouterStatus(history: BeatSample[]): LiveStatus {
  const last = history[history.length - 1];
  if (!last) return "unknown";
  if (!last.ok) {
    const prev = history[history.length - 2];
    return prev && !prev.ok ? "gap" : "warn";
  }
  if (last.routerStatus === "unavailable") return "crit";
  const [healthy, total] = (last.vendorsHealthy ?? "").split("/").map(Number);
  if (total > 0 && healthy === 0) return "crit";
  if (last.routerStatus === "healthy") return "ok";
  return "warn";
}

export interface VendorNodeState {
  status: LiveStatus;
  /** short line shown on the node */
  meta: string;
  /** full explanation (reason truncated to 140 chars) for tooltip/inspector */
  note?: string;
  stale: boolean;
}

/** Map one vendor's /health entry to node state. Missing entry -> unknown. */
export function deriveVendorState(v: VendorHealthLike | undefined): VendorNodeState {
  if (!v) return { status: "unknown", meta: "not reported by /health", stale: false };
  const stale = v.stale === true;
  const ms = typeof v.response_time === "number" ? ` · ${v.response_time} ms` : "";
  const reason = v.reason ? truncate(String(v.reason)) : undefined;
  if (v.status === "unhealthy") {
    return {
      status: "crit",
      meta: `unhealthy${v.circuit === "open" ? " · circuit open" : ""}${stale ? " · stale" : ""}`,
      note: reason ?? "reported unhealthy",
      stale,
    };
  }
  if (v.status === "healthy") {
    return stale
      ? { status: "warn", meta: `healthy · stale${ms}`, note: "Last probe is older than the health TTL; the router is refreshing it.", stale }
      : { status: "ok", meta: `healthy${ms}`, stale };
  }
  return { status: "unknown", meta: stale ? "unknown · stale" : "unknown", note: reason, stale };
}

/**
 * Fold several vendors into one grouped node ("further vendors").
 * All unhealthy -> crit; some unhealthy or stale -> warn; all healthy -> ok.
 */
export function aggregateVendorStates(states: VendorNodeState[]): VendorNodeState {
  if (!states.length) return { status: "unknown", meta: "not reported by /health", stale: false };
  const n = states.length;
  const bad = states.filter((s) => s.status === "crit").length;
  const stale = states.filter((s) => s.stale).length;
  const unknown = states.filter((s) => s.status === "unknown").length;
  const meta = `${n - bad - unknown}/${n} healthy${stale ? ` · ${stale} stale` : ""}`;
  const notes = states.map((s) => s.note).filter(Boolean) as string[];
  const note = notes.length ? truncate(notes.join(" | ")) : undefined;
  if (bad === n) return { status: "crit", meta, note, stale: stale > 0 };
  if (bad > 0 || stale > 0) return { status: "warn", meta, note, stale: stale > 0 };
  if (unknown === n) return { status: "unknown", meta, note, stale: false };
  if (unknown > 0) return { status: "warn", meta, note, stale: false };
  return { status: "ok", meta, stale: false };
}

const EDGE_PRIORITY: Record<LiveStatus, number> = { ok: 0, unknown: 1, warn: 2, gap: 3, crit: 4 };

/**
 * Edge status from its endpoints: both ok -> ok; any crit -> crit;
 * any gap -> gap; any warn -> warn; otherwise (an unobserved endpoint) unknown.
 * An edge flagged as a known wiring gap is always gap.
 */
export function deriveEdgeStatus(from: LiveStatus, to: LiveStatus, isGap = false): LiveStatus {
  if (isGap) return "gap";
  return EDGE_PRIORITY[from] >= EDGE_PRIORITY[to] ? from : to;
}

/** "N/M lanes active" from a catalog's personas. */
export function lanesSummary(personas: { status: string }[] | undefined | null): { active: number; total: number } | null {
  if (!personas || !personas.length) return null;
  return { active: personas.filter((p) => p.status === "active").length, total: personas.length };
}
