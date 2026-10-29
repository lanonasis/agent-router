import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Database, Pause, Play, RefreshCw, Settings2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRouterSettings } from "@/lib/routerSettings";
import {
  fetchActivity,
  ActivityError,
  REASON_LABEL,
  type ActivityEntry,
  type ActivityStatus,
} from "@/services/activityService";

const POLL_MS = 5000;

const STATUS_STYLE: Record<ActivityStatus, { label: string; text: string; dot: string }> = {
  completed: { label: "completed", text: "text-success", dot: "bg-success" },
  recovered: { label: "recovered via failover", text: "text-warning", dot: "bg-warning" },
  failed: { label: "failed", text: "text-destructive", dot: "bg-destructive" },
  in_progress: { label: "in progress", text: "text-brandBlue", dot: "bg-brandBlue" },
};

type Filter = "all" | "recovered" | "failed";

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString()
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString()}`;
};

const fmtMs = (ms: number | null) => (ms == null ? null : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

function Chip({ children, tone = "border-border text-fg" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs whitespace-nowrap ${tone}`}>{children}</span>;
}

const Arrow = ({ label }: { label?: string }) => (
  <span className="inline-flex items-center text-fgMuted font-mono text-[10px]">
    {label && <span className="mr-0.5">{label}</span>}
    <ChevronRight className="h-3.5 w-3.5" />
  </span>
);

function Flow({ e }: { e: ActivityEntry }) {
  const st = STATUS_STYLE[e.status];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip>{e.origin}</Chip>
      <Arrow />
      <Chip tone="border-brandPurple/60 text-fg">ai-router{e.useCase ? ` · ${e.useCase}` : ""}{e.streaming ? " · stream" : ""}</Chip>
      {e.attempts.map((a, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <Arrow label={i > 0 && e.attempts[i - 1].outcome === "failed" ? "failover" : undefined} />
          {a.outcome === "failed" ? (
            <Chip tone="border-destructive/60 text-destructive">
              {a.vendor} · {a.reason ? REASON_LABEL[a.reason] : "failed"}{fmtMs(a.durationMs) ? ` ${fmtMs(a.durationMs)}` : ""}
            </Chip>
          ) : (
            <Chip tone="border-success/60 text-success">{a.vendor} ✓</Chip>
          )}
        </span>
      ))}
      <Arrow />
      <Chip tone={`border-current ${st.text}`}>
        {st.label}{fmtMs(e.durationMs) ? ` · ${fmtMs(e.durationMs)}` : ""}{e.statusCode && e.status === "failed" ? ` · ${e.statusCode}` : ""}
      </Chip>
    </div>
  );
}

export default function RouterActivity() {
  const settings = useRouterSettings();
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);

  const { data, error, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["router-activity", settings.url, settings.apiKey],
    queryFn: () => fetchActivity(settings, 100),
    refetchInterval: paused ? false : POLL_MS,
    refetchIntervalInBackground: false,
    retry: (count, err) => !(err instanceof ActivityError && err.kind !== "unreachable") && count < 1,
  });

  const entries = useMemo(
    () => (data?.entries ?? []).filter((e) => filter === "all" || e.status === filter),
    [data, filter],
  );
  const err = error instanceof ActivityError ? error : error ? new ActivityError("http", String(error)) : null;
  const stored = data?.persistence?.enabled ? data.persistence : null;

  return (
    <div className="max-w-6xl mx-auto space-y-6 text-fg">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/agents" className="text-xs text-fgMuted hover:text-fg font-mono">← agents</Link>
          <h1 className="text-3xl font-bold tracking-tight mt-1 flex items-center gap-3">
            Router Activity
            {!paused && !err && (
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full opacity-70 animate-ping bg-success" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
              </span>
            )}
          </h1>
          <p className="text-sm text-fgMuted mt-1">
            Each request's path through the router: where it came from, which vendors were tried, and how it ended. Metadata only — no prompts or answers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-fgMuted">
            {isFetching ? "fetching…" : dataUpdatedAt ? `updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ""}
          </span>
          <Button size="sm" variant="outline" onClick={() => setPaused((p) => !p)} className="gap-1.5">
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />} {paused ? "Resume" : "Pause"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            [stored ? "Shown" : "Buffered", `${data.stats.buffered}/${data.stats.capacity}`, "text-fg"],
            ["Completed", data.stats.completed, "text-success"],
            ["Recovered", data.stats.recovered, "text-warning"],
            ["Failed", data.stats.failed, "text-destructive"],
            ["Scope", data.scope === "all" ? "all orgs" : "your org", "text-fg"],
          ].map(([label, value, tone]) => (
            <div key={label as string} className="rounded-lg border border-border bg-bgMuted/50 px-3 py-2.5">
              <div className="text-xs font-mono text-fgMuted">{label}</div>
              <div className={`text-lg font-semibold mt-0.5 ${tone}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {err ? (
        <div className="rounded-xl border border-border bg-bgMuted/40 p-6 space-y-3">
          <div className="font-semibold">
            {err.kind === "no-credential" && "Add a router credential to see activity"}
            {err.kind === "unauthorized" && "The router rejected the credential"}
            {err.kind === "not-deployed" && "The router doesn't have the activity feed yet"}
            {err.kind === "unreachable" && "The router can't be reached from this browser"}
            {err.kind === "http" && "The router returned an error"}
          </div>
          <p className="text-sm text-fgMuted">
            {err.kind === "not-deployed"
              ? "Deploy the latest router code to the server and restart onasis-ai-router.service, then refresh."
              : err.message}
          </p>
          <p className="text-xs font-mono text-fgMuted">router: {settings.url}</p>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/settings"><Settings2 className="h-3.5 w-3.5" /> Open router settings & run a test</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 font-mono text-xs">
            {(["all", "recovered", "failed"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded border ${filter === f ? "border-brandBlue text-fg bg-bgMuted" : "border-border text-fgMuted hover:text-fg"}`}
              >
                {f === "recovered" ? "failovers" : f}
              </button>
            ))}
            {data && (
              <span className="ml-auto text-fgMuted">process {data.process.pid} · up {Math.round(data.process.uptime_s / 60)} min</span>
            )}
          </div>

          <div className="rounded-xl border border-border bg-bg divide-y divide-border">
            {!data && <div className="p-6 text-sm text-fgMuted">Loading activity…</div>}
            {data && entries.length === 0 && (
              <div className="p-8 text-center space-y-1">
                <Zap className="h-5 w-5 mx-auto text-fgMuted" />
                <div className="text-sm">
                  No requests {filter !== "all" ? `with status "${filter}" ` : ""}
                  {stored ? `in the last ${stored.retentionDays} days.` : "since the router last started."}
                </div>
                <div className="text-xs text-fgMuted">New requests appear here within {POLL_MS / 1000}s.</div>
              </div>
            )}
            {entries.map((e) => {
              const st = STATUS_STYLE[e.status];
              const isOpen = open === e.requestId;
              return (
                <div key={e.requestId} className="px-4 py-3">
                  <button className="w-full text-left" onClick={() => setOpen(isOpen ? null : e.requestId)} aria-expanded={isOpen}>
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`h-2 w-2 rounded-full ${st.dot}`} />
                      <span className="font-mono text-xs text-fgMuted">{fmtWhen(e.startedAt)}</span>
                      <span className="font-mono text-[10px] text-fgMuted truncate">{e.requestId.slice(0, 12)}</span>
                      {e.endpoint && <Badge variant="outline" className="font-mono text-[10px]">{e.endpoint}</Badge>}
                    </div>
                    <Flow e={e} />
                  </button>
                  {isOpen && (e.error || e.attempts.some((a) => a.error)) && (
                    <ul className="mt-3 space-y-1 rounded-md bg-bgMuted/60 p-3 font-mono text-[11px] text-fgMuted">
                      {e.attempts.filter((a) => a.error).map((a, i) => (
                        <li key={i}><span className="text-destructive">{a.vendor}</span>: {a.error}</li>
                      ))}
                      {e.error && <li><span className="text-destructive">result</span>: {e.error}</li>}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          {data && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-fgMuted">
              {stored ? (
                <>
                  <Badge variant="outline" className="gap-1 border-success/60 text-success font-mono text-[10px]">
                    <Database className="h-3 w-3" /> saved on server
                  </Badge>
                  <span>
                    Kept for {stored.retentionDays} day{stored.retentionDays === 1 ? "" : "s"}
                    {stored.oldestDay ? ` · history since ${stored.oldestDay}` : ""} — survives router restarts and is shared by every router process.
                    Change with ROUTER_ACTIVITY_RETENTION_DAYS on the server.
                  </span>
                  {stored.lastError && <span className="text-destructive">Last storage error: {stored.lastError}</span>}
                </>
              ) : (
                <>
                  <Badge variant="outline" className="gap-1 border-warning/60 text-warning font-mono text-[10px]">
                    <Database className="h-3 w-3" /> memory only
                  </Badge>
                  <span>
                    {data.persistence
                      ? "Saving is turned off on the router (ROUTER_ACTIVITY_PERSIST=false) — history resets on restart."
                      : `This router version keeps only the last ${data.stats.capacity} requests in memory — deploy the latest router code to keep history across restarts.`}
                  </span>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
