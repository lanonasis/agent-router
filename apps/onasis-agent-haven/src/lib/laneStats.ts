// Pure lane statistics. No runtime imports so it can be unit-checked under
// Node's type stripping (scripts/check-lane-stats.mjs).
import type { LaneStat } from "../services/routerCatalog.ts";

/** The slice of an activity entry the aggregation reads. */
export interface LaneEntryLike {
  useCase: string | null;
  status: "in_progress" | "completed" | "recovered" | "failed";
  durationMs: number | null;
  startedAt: string;
}

export const UNKNOWN_LANE = "unknown";

/** Nearest-rank percentile of an already ascending-sorted list. */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (!sortedAsc.length) return null;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length, Math.max(1, rank)) - 1];
}

/**
 * Per-lane stats from raw activity entries, in the router's LaneStat shape.
 * success = (completed + recovered) / finished, where finished excludes
 * in-progress. Latency is over finished entries with a numeric duration.
 */
export function aggregateLaneStats(entries: LaneEntryLike[]): LaneStat[] {
  const lanes = new Map<string, { stat: LaneStat; durations: number[]; lastMs: number }>();
  for (const e of entries) {
    const key = e.useCase?.trim() || UNKNOWN_LANE;
    let lane = lanes.get(key);
    if (!lane) {
      lane = {
        stat: {
          useCase: key, total: 0, completed: 0, recovered: 0, failed: 0, inProgress: 0,
          successRate: null, avgLatencyMs: null, p95LatencyMs: null, lastSeenAt: null,
        },
        durations: [],
        lastMs: -Infinity,
      };
      lanes.set(key, lane);
    }
    const s = lane.stat;
    s.total += 1;
    if (e.status === "completed") s.completed += 1;
    else if (e.status === "recovered") s.recovered += 1;
    else if (e.status === "failed") s.failed += 1;
    else s.inProgress += 1;

    if (e.status !== "in_progress" && typeof e.durationMs === "number" && Number.isFinite(e.durationMs)) {
      lane.durations.push(e.durationMs);
    }
    const t = Date.parse(e.startedAt);
    if (Number.isFinite(t) && t > lane.lastMs) {
      lane.lastMs = t;
      s.lastSeenAt = new Date(t).toISOString();
    }
  }

  return [...lanes.values()]
    .map(({ stat, durations }) => {
      const finished = stat.total - stat.inProgress;
      stat.successRate = finished > 0 ? (stat.completed + stat.recovered) / finished : null;
      if (durations.length) {
        const sorted = [...durations].sort((a, b) => a - b);
        stat.avgLatencyMs = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
        stat.p95LatencyMs = percentile(sorted, 95);
      }
      return stat;
    })
    .sort((a, b) => b.total - a.total || a.useCase.localeCompare(b.useCase));
}

export type LaneHealth = "healthy" | "warn" | "failing" | "no-traffic";

/** success >= 95% healthy, 80-95% warn, < 80% failing; no finished requests -> no-traffic. */
export function laneHealth(rate: number | null): LaneHealth {
  if (rate == null) return "no-traffic";
  if (rate >= 0.95) return "healthy";
  if (rate >= 0.8) return "warn";
  return "failing";
}

/** Worst lanes first, only lanes that have finished requests. */
export function worstLanes(lanes: LaneStat[], n = 3): LaneStat[] {
  return lanes
    .filter((l) => l.successRate != null)
    .sort((a, b) => (a.successRate as number) - (b.successRate as number) || b.total - a.total)
    .slice(0, n);
}
