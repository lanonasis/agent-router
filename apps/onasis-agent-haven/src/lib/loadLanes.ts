import type { RouterSettings } from "@/lib/routerSettings";
import { fetchLaneStats, RouterCatalogError, type LaneStat } from "@/services/routerCatalog";
import { fetchActivity, ActivityError } from "@/services/activityService";
import { aggregateLaneStats } from "@/lib/laneStats";

export const ACTIVITY_WINDOW = 200;

type ErrKind = "no-credential" | "unauthorized" | "refused" | "not-deployed" | "unreachable" | "http";
export class LaneViewError extends Error {
  constructor(public kind: ErrKind, message: string) {
    super(message);
  }
}

export interface LaneView {
  lanes: LaneStat[];
  source: "router" | "computed";
  /** requests behind a computed view */
  sampleSize: number;
  windowFrom: string | null;
  scope: string | null;
}

export async function loadLanes(settings: RouterSettings): Promise<LaneView> {
  try {
    const res = await fetchLaneStats(settings);
    return { lanes: res.lanes, source: "router", sampleSize: 0, windowFrom: res.window?.from ?? null, scope: res.scope };
  } catch (e) {
    if (!(e instanceof RouterCatalogError)) throw new LaneViewError("http", String(e));
    if (e.kind !== "not-deployed") throw new LaneViewError(e.kind, e.message);
  }
  // Router has no /ops/lane-stats yet: compute the same shape from the activity feed.
  try {
    const feed = await fetchActivity(settings, ACTIVITY_WINDOW);
    return {
      lanes: aggregateLaneStats(feed.entries),
      source: "computed",
      sampleSize: feed.entries.length,
      windowFrom: feed.entries.length ? feed.entries.reduce((m, e) => (e.startedAt < m ? e.startedAt : m), feed.entries[0].startedAt) : null,
      scope: feed.scope,
    };
  } catch (e) {
    if (e instanceof ActivityError) throw new LaneViewError(e.kind, e.message);
    throw new LaneViewError("http", String(e));
  }
}
