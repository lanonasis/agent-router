import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouterSettings } from "@/lib/routerSettings";
import {
  fetchRouterCatalog,
  type LivePersona,
  type LaneStat,
} from "@/services/routerCatalog";
import { laneHealth, type LaneHealth } from "@/lib/laneStats";
import { loadLanes, LaneViewError } from "@/lib/loadLanes";

const POLL_MS = 30_000;

const HEALTH_STYLE: Record<LaneHealth, { text: string; bar: string; glyph: string; label: string }> = {
  healthy: { text: "text-success", bar: "bg-success", glyph: "✓", label: "healthy" },
  warn: { text: "text-warning", bar: "bg-warning", glyph: "!", label: "degraded" },
  failing: { text: "text-destructive", bar: "bg-destructive", glyph: "✕", label: "failing" },
  "no-traffic": { text: "text-fgMuted", bar: "bg-border", glyph: "", label: "no traffic yet" },
};

const LIVE_STYLE: Record<LivePersona["status"], string> = {
  active: "border-success/60 text-success",
  degraded: "border-warning/60 text-warning",
  unavailable: "border-destructive/60 text-destructive",
};

const fmtMs = (ms: number | null) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

function fmtAgo(iso: string | null, now: number): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "—";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function emptyLane(useCase: string): LaneStat {
  return {
    useCase, total: 0, completed: 0, recovered: 0, failed: 0, inProgress: 0,
    successRate: null, avgLatencyMs: null, p95LatencyMs: null, lastSeenAt: null,
  };
}

function OutcomeBar({ lane }: { lane: LaneStat }) {
  const finished = lane.completed + lane.recovered + lane.failed;
  if (!finished) return <div className="h-1.5 w-24 rounded-full bg-border" aria-hidden="true" />;
  const pct = (n: number) => `${(n / finished) * 100}%`;
  return (
    <div
      className="flex h-1.5 w-24 overflow-hidden rounded-full bg-border"
      role="img"
      aria-label={`${lane.completed} completed, ${lane.recovered} recovered, ${lane.failed} failed`}
    >
      <span className="bg-success" style={{ width: pct(lane.completed) }} />
      <span className="bg-warning" style={{ width: pct(lane.recovered) }} />
      <span className="bg-destructive" style={{ width: pct(lane.failed) }} />
    </div>
  );
}

export default function LaneMetrics() {
  const settings = useRouterSettings();

  const stats = useQuery({
    queryKey: ["lane-metrics", settings.url, settings.apiKey],
    queryFn: () => loadLanes(settings),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: (count, err) => !(err instanceof LaneViewError && err.kind !== "unreachable") && count < 1,
  });

  // Public catalog: agent/role names and live status. Optional, so failures are silent.
  const catalog = useQuery({
    queryKey: ["lane-catalog", settings.url],
    queryFn: () => fetchRouterCatalog(settings),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const personas = useMemo(
    () => new Map((catalog.data?.personas ?? []).map((p) => [p.useCase, p])),
    [catalog.data],
  );

  const rows = useMemo(() => {
    if (!stats.data) return [];
    const seen = new Set(stats.data.lanes.map((l) => l.useCase));
    const idle = [...personas.keys()].filter((u) => !seen.has(u)).map(emptyLane);
    return [...stats.data.lanes, ...idle];
  }, [stats.data, personas]);

  const now = stats.dataUpdatedAt || Date.now();
  const err = stats.error instanceof LaneViewError ? stats.error : stats.error ? new LaneViewError("http", String(stats.error)) : null;
  const data = stats.data;

  return (
    <div className="max-w-7xl mx-auto space-y-6 text-fg">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/agents" className="text-xs text-fgMuted hover:text-fg font-mono">← agents</Link>
          <h1 className="text-3xl font-bold tracking-tight mt-1">Lane performance</h1>
          <p className="text-sm text-fgMuted mt-1">
            Which lanes actually work: finished requests, success rate and latency per use case. Success counts failover recoveries; in-flight requests are excluded.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-fgMuted">
            {stats.isFetching ? "fetching…" : stats.dataUpdatedAt ? `updated ${new Date(stats.dataUpdatedAt).toLocaleTimeString()} · auto-refresh ${POLL_MS / 1000}s` : ""}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { stats.refetch(); catalog.refetch(); }}
            disabled={stats.isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${stats.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border border-border bg-bgMuted/40 p-6 space-y-3" role="alert">
          <div className="font-semibold">
            {err.kind === "no-credential" && "Add a router credential to see lane performance"}
            {err.kind === "unauthorized" && "The router rejected the credential"}
            {err.kind === "refused" && "The router refused the request"}
            {err.kind === "not-deployed" && "This router doesn't expose request history yet"}
            {err.kind === "unreachable" && "The router can't be reached from this browser"}
            {err.kind === "http" && "The router returned an error"}
          </div>
          <p className="text-sm text-fgMuted">{err.message}</p>
          <p className="text-xs font-mono text-fgMuted">router: {settings.url}</p>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/settings"><Settings2 className="h-3.5 w-3.5" /> Open router settings</Link>
          </Button>
        </div>
      ) : !data ? (
        <div className="rounded-xl border border-border bg-bg p-6 text-sm text-fgMuted">Loading lane statistics…</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-fgMuted">
            {data.source === "router" ? (
              <Badge variant="outline" className="border-success/60 text-success font-mono text-[10px]">router-reported</Badge>
            ) : (
              <Badge variant="outline" className="border-warning/60 text-warning font-mono text-[10px]">computed here</Badge>
            )}
            <span>
              {data.source === "router"
                ? `Statistics reported by the router${data.windowFrom ? ` since ${new Date(data.windowFrom).toLocaleString()}` : ""}${data.scope ? ` · scope: ${data.scope === "all" ? "all orgs" : "your org"}` : ""}.`
                : `Computed from the last ${data.sampleSize} requests in this browser's view (the router has no lane-stats endpoint yet).`}
            </span>
            {!catalog.data && !catalog.isLoading && <span>· agent names unavailable (router catalog not reachable)</span>}
          </div>

          <div className="rounded-xl border border-border bg-bg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lane</TableHead>
                  <TableHead>Agent / role</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Completed</TableHead>
                  <TableHead className="text-right">Recovered</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>Success rate</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                  <TableHead className="text-right">p95</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Live</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="py-8 text-center text-sm text-fgMuted">
                      No requests recorded yet. Lanes appear here as soon as the router serves traffic.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((lane) => {
                  const persona = personas.get(lane.useCase);
                  const h = laneHealth(lane.successRate);
                  const st = HEALTH_STYLE[h];
                  return (
                    <TableRow key={lane.useCase}>
                      <TableCell className="font-mono text-xs">{lane.useCase}</TableCell>
                      <TableCell className="text-sm" title={persona?.description}>
                        {persona?.role ?? <span className="text-fgMuted">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {lane.total}
                        {lane.inProgress > 0 && <span className="text-fgMuted" title="in flight, excluded from rates"> (+{lane.inProgress})</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-success">{lane.completed}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-warning">{lane.recovered}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-destructive">{lane.failed}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className={`font-mono text-xs font-semibold ${st.text}`}>
                            {lane.successRate == null ? st.label : `${Math.round(lane.successRate * 100)}% ${st.glyph}`}
                            {lane.successRate != null && <span className="sr-only"> {st.label}</span>}
                          </div>
                          <OutcomeBar lane={lane} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtMs(lane.avgLatencyMs)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtMs(lane.p95LatencyMs)}</TableCell>
                      <TableCell className="font-mono text-xs text-fgMuted whitespace-nowrap">{fmtAgo(lane.lastSeenAt, now)}</TableCell>
                      <TableCell>
                        {persona ? (
                          <Badge variant="outline" className={`font-mono text-[10px] ${LIVE_STYLE[persona.status]}`}>
                            {persona.status}
                          </Badge>
                        ) : (
                          <span className="text-fgMuted text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-mono text-fgMuted">
            <span><span className="text-success">≥95% ✓</span> healthy</span>
            <span><span className="text-warning">80–95% !</span> degraded</span>
            <span><span className="text-destructive">&lt;80% ✕</span> failing</span>
            <span>bar: <span className="text-success">completed</span> / <span className="text-warning">recovered</span> / <span className="text-destructive">failed</span></span>
          </div>
        </>
      )}
    </div>
  );
}
