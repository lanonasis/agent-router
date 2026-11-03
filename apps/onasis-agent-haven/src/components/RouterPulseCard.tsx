import { Link } from "react-router-dom";
import { ArrowRight, Network } from "lucide-react";
import { useRouterHeartbeat, STATUS_BG, STATUS_LABEL, STATUS_TEXT } from "@/hooks/useRouterHeartbeat";
import { useQuery } from "@tanstack/react-query";
import type { NodeStatus } from "@/services/chainService";
import { useRouterSettings } from "@/lib/routerSettings";
import { loadLanes } from "@/lib/loadLanes";
import { laneHealth, worstLanes } from "@/lib/laneStats";

/** Dashboard summary of the live router chain, linking to the full topology. */
export function RouterPulseCard() {
  const { data, isLoading } = useRouterHeartbeat();
  const settings = useRouterSettings();
  // Same query key as /lanes, so the two share one cache entry. Silent on any
  // error (no credential, old router): the card simply omits the lane row.
  const lanes = useQuery({
    queryKey: ["lane-metrics", settings.url, settings.apiKey],
    queryFn: () => loadLanes(settings),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const worst = worstLanes(lanes.data?.lanes ?? [], 3);
  const status: NodeStatus = data?.routerStatus ?? "warn";
  const counts = (data?.nodes ?? []).reduce(
    (acc, n) => ({ ...acc, [n.status]: (acc[n.status] ?? 0) + 1 }),
    {} as Partial<Record<NodeStatus, number>>,
  );

  return (
    <Link
      to="/chain"
      className="group block rounded-xl border border-border bg-bg hover:border-brandBlue shadow-sm transition-colors p-4"
    >
      <div className="flex flex-wrap items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className={`absolute inline-flex h-full w-full rounded-full opacity-70 animate-ping ${STATUS_BG[status]}`} />
            <span className={`relative inline-flex h-3 w-3 rounded-full ${STATUS_BG[status]}`} />
          </span>
          <div>
            <div className="flex items-center gap-2 font-semibold text-fg">
              <Network className="h-4 w-4 text-brandBlue" /> Router Chain & Topology
            </div>
            <div className="text-xs text-fgMuted font-mono">
              {isLoading
                ? "probing router…"
                : `router ${STATUS_LABEL[status]} · ${data?.reachable ? `${data.latencyMs} ms` : "unreachable"} · vendors ${data?.vendorsHealthy}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          {(["ok", "warn", "crit", "gap"] as NodeStatus[]).map((s) => (
            <span key={s} className={`flex items-center gap-1.5 ${STATUS_TEXT[s]}`}>
              <span className={`h-2 w-2 rounded-full ${STATUS_BG[s]}`} />
              {counts[s] ?? 0} {STATUS_LABEL[s]}
            </span>
          ))}
          <span className="flex items-center gap-1 text-fg group-hover:text-brandBlue">
            Inspect <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
      {worst.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2 text-xs font-mono" aria-label="Lane health, weakest lanes">
          <span className="text-fgMuted">lane health</span>
          {worst.map((l) => {
            const h = laneHealth(l.successRate);
            const tone = h === "healthy" ? "text-success" : h === "warn" ? "text-warning" : "text-destructive";
            const glyph = h === "healthy" ? "✓" : h === "warn" ? "!" : "✕";
            return (
              <span key={l.useCase} className={tone}>
                {l.useCase} {Math.round((l.successRate as number) * 100)}% {glyph}
              </span>
            );
          })}
        </div>
      )}
    </Link>
  );
}
