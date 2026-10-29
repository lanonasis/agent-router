import { useQuery } from "@tanstack/react-query";
import { fetchChainTopology, type NodeStatus } from "@/services/chainService";
import { useRouterSettings } from "@/lib/routerSettings";

export const HEARTBEAT_INTERVAL_MS = 10_000;

/** Shared live probe of the AI router's /health, polled on a fixed heartbeat. */
export function useRouterHeartbeat() {
  const { url } = useRouterSettings();
  return useQuery({
    queryKey: ["router-heartbeat", url],
    queryFn: () => fetchChainTopology(url),
    refetchInterval: HEARTBEAT_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: HEARTBEAT_INTERVAL_MS / 2,
  });
}

export const STATUS_LABEL: Record<NodeStatus, string> = {
  ok: "active",
  warn: "degraded",
  crit: "down",
  gap: "not wired",
};

/** Semantic token classes per status — no raw colours. */
export const STATUS_TEXT: Record<NodeStatus, string> = {
  ok: "text-success",
  warn: "text-warning",
  crit: "text-destructive",
  gap: "text-brandPurple",
};
export const STATUS_BG: Record<NodeStatus, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  crit: "bg-destructive",
  gap: "bg-brandPurple",
};
export const STATUS_STROKE: Record<NodeStatus, string> = {
  ok: "hsl(var(--success))",
  warn: "hsl(var(--warning))",
  crit: "hsl(var(--destructive))",
  gap: "hsl(var(--brand-purple))",
};
