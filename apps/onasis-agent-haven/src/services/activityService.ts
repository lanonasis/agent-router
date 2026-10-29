import { routerAuthHeaders, type RouterSettings } from "@/lib/routerSettings";

export type ActivityStatus = "in_progress" | "completed" | "recovered" | "failed";

export interface ActivityAttempt {
  vendor: string;
  outcome: "failed" | "served";
  reason: "timeout" | "not_configured" | "rate_limited" | "auth" | "upstream_5xx" | "unreachable" | "error" | null;
  durationMs: number | null;
  error: string | null;
}

export interface ActivityEntry {
  requestId: string;
  startedAt: string;
  origin: string;
  endpoint: string | null;
  useCase: string | null;
  streaming: boolean;
  attempts: ActivityAttempt[];
  status: ActivityStatus;
  finalVendor: string | null;
  statusCode: number | null;
  durationMs: number | null;
  error: string | null;
}

export interface ActivityFeed {
  scope: "all" | "organization";
  process: { pid: number; uptime_s: number };
  stats: { buffered: number; capacity: number; completed: number; recovered: number; failed: number; inProgress: number };
  entries: ActivityEntry[];
  timestamp: string;
}

export class ActivityError extends Error {
  constructor(public kind: "no-credential" | "unauthorized" | "not-deployed" | "unreachable" | "http", message: string) {
    super(message);
  }
}

export async function fetchActivity(settings: RouterSettings, limit = 50): Promise<ActivityFeed> {
  const headers = routerAuthHeaders(settings);
  if (!Object.keys(headers).length) {
    throw new ActivityError("no-credential", "Add a router API key in Settings to read activity.");
  }
  let res: Response;
  try {
    res = await fetch(`${settings.url}/api/v1/ops/activity?limit=${limit}`, {
      headers: { Accept: "application/json", ...headers },
    });
  } catch {
    throw new ActivityError("unreachable", "The router can't be reached from this browser.");
  }
  if (res.status === 401 || res.status === 403) throw new ActivityError("unauthorized", "The router rejected the credential.");
  if (res.status === 404) throw new ActivityError("not-deployed", "The router doesn't have the activity feed yet.");
  if (!res.ok) throw new ActivityError("http", `Router answered HTTP ${res.status}.`);
  return res.json();
}

export const REASON_LABEL: Record<NonNullable<ActivityAttempt["reason"]>, string> = {
  timeout: "timeout",
  not_configured: "not configured",
  rate_limited: "rate-limited",
  auth: "auth rejected",
  upstream_5xx: "upstream error",
  unreachable: "unreachable",
  error: "error",
};
