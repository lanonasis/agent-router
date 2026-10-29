import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Activity, RefreshCw, Radio, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ChainEdge, ChainNode, NodeStatus } from "@/services/chainService";
import {
  useRouterHeartbeat,
  HEARTBEAT_INTERVAL_MS,
  STATUS_BG,
  STATUS_LABEL,
  STATUS_STROKE,
  STATUS_TEXT,
} from "@/hooks/useRouterHeartbeat";

// ─── Layout (viewBox 1100 x 640) ────────────────────────────────────────────

type Box = { x: number; y: number; w: number; h: number };
const POS: Record<string, Box> = {
  slack: { x: 20, y: 70, w: 170, h: 56 },
  discord: { x: 20, y: 190, w: 170, h: 56 },
  redis: { x: 270, y: 130, w: 160, h: 56 },
  authgw: { x: 470, y: 20, w: 180, h: 56 },
  memapi: { x: 470, y: 220, w: 180, h: 56 },
  router: { x: 640, y: 340, w: 170, h: 70 },
  anthropic: { x: 910, y: 110, w: 170, h: 52 },
  openai: { x: 910, y: 190, w: 170, h: 52 },
  lmstudio: { x: 910, y: 300, w: 170, h: 52 },
  morevendors: { x: 910, y: 410, w: 170, h: 52 },
  opswebhook: { x: 270, y: 470, w: 180, h: 56 },
};

/** The six documented agents dispatched through the router's use-case lanes. */
const AGENT_LANES = ["Orchestrator", "Architect", "Coder", "Researcher", "Reviewer", "Tester"];
const AGENT_Y = 570;
const agentBox = (i: number): Box => ({ x: 480 + i * 102, y: AGENT_Y, w: 94, h: 34 });

const RANK: Record<NodeStatus, number> = { ok: 0, gap: 1, warn: 2, crit: 3 };

function edgePath(a: Box, b: Box) {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
  const horizontal = Math.abs(bx - ax) > Math.abs(by - ay);
  if (horizontal) {
    const sx = bx > ax ? a.x + a.w : a.x, ex = bx > ax ? b.x : b.x + b.w;
    const mx = (sx + ex) / 2;
    return { d: `M${sx},${ay} C${mx},${ay} ${mx},${by} ${ex},${by}`, mid: { x: mx, y: (ay + by) / 2 } };
  }
  const sy = by > ay ? a.y + a.h : a.y, ey = by > ay ? b.y : b.y + b.h;
  const my = (sy + ey) / 2;
  return { d: `M${ax},${sy} C${ax},${my} ${bx},${my} ${bx},${ey}`, mid: { x: (ax + bx) / 2, y: my } };
}

// ─── Edge ───────────────────────────────────────────────────────────────────

function Edge({ edge, status, lit, dim }: { edge: ChainEdge; status: NodeStatus; lit: boolean; dim: boolean }) {
  const a = POS[edge.from], b = POS[edge.to];
  if (!a || !b) return null;
  const { d, mid } = edgePath(a, b);
  const stroke = STATUS_STROKE[status];
  const flowing = !edge.isGap && status !== "crit";
  return (
    <g style={{ opacity: dim ? 0.15 : 1, transition: "opacity .2s" }}>
      <path d={d} fill="none" stroke={stroke} strokeOpacity={0.18} strokeWidth={lit ? 7 : 4} strokeLinecap="round" />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={lit ? 2.2 : 1.5}
        strokeDasharray={edge.isGap || status === "gap" ? "5 6" : flowing ? "2 10" : undefined}
        strokeLinecap="round"
      >
        {flowing && (
          <animate attributeName="stroke-dashoffset" from="24" to="0" dur={status === "warn" ? "2.4s" : "1.1s"} repeatCount="indefinite" />
        )}
      </path>
      {flowing && (
        <circle r={2.6} fill={stroke}>
          <animateMotion dur={status === "warn" ? "4s" : "2.2s"} repeatCount="indefinite" path={d} />
        </circle>
      )}
      {edge.label && lit && (
        <text x={mid.x} y={mid.y - 6} textAnchor="middle" className="fill-fg font-mono" style={{ fontSize: 10 }}>
          {edge.label}
        </text>
      )}
    </g>
  );
}

// ─── Node ───────────────────────────────────────────────────────────────────

function Node({ node, selected, dim, beat, onSelect }: {
  node: ChainNode; selected: boolean; dim: boolean; beat: number; onSelect: (id: string) => void;
}) {
  const p = POS[node.id];
  if (!p) return null;
  const stroke = STATUS_STROKE[node.status];
  const isRouter = node.id === "router";
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${node.label}: ${STATUS_LABEL[node.status]}`}
      onClick={() => onSelect(node.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(node.id); } }}
      className="cursor-pointer outline-none"
      style={{ opacity: dim ? 0.3 : 1, transition: "opacity .2s" }}
    >
      <rect
        x={p.x} y={p.y} width={p.w} height={p.h} rx={10}
        className="fill-bgMuted"
        stroke={selected ? "hsl(var(--brand-blue))" : stroke}
        strokeOpacity={selected ? 1 : 0.55}
        strokeWidth={selected ? 2.2 : isRouter ? 1.8 : 1.2}
      />
      {/* heartbeat ring — re-keyed every probe so it pulses */}
      <circle key={beat} cx={p.x + 16} cy={p.y + 18} r={5} fill="none" stroke={stroke} strokeWidth={1.5}>
        <animate attributeName="r" from="5" to="13" dur="1.4s" repeatCount={node.status === "ok" ? "indefinite" : "1"} />
        <animate attributeName="opacity" from="0.9" to="0" dur="1.4s" repeatCount={node.status === "ok" ? "indefinite" : "1"} />
      </circle>
      <circle cx={p.x + 16} cy={p.y + 18} r={4.5} fill={stroke} />
      <text x={p.x + 30} y={p.y + 23} className="fill-fg font-semibold" style={{ fontSize: isRouter ? 15 : 13 }}>
        {node.label}
      </text>
      <text x={p.x + 14} y={p.y + 42} className="fill-fgMuted font-mono" style={{ fontSize: 9.5 }}>
        {node.meta.length > 30 ? node.meta.slice(0, 29) + "…" : node.meta}
      </text>
    </g>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ChainWiring() {
  const { data, isFetching, refetch, dataUpdatedAt } = useRouterHeartbeat();
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<{ t: number; ok: boolean; ms: number | null; status: NodeStatus }[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!data) return;
    setHistory((h) => [...h.slice(-29), { t: dataUpdatedAt, ok: data.reachable, ms: data.latencyMs, status: data.routerStatus }]);
  }, [data, dataUpdatedAt]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const nodes = useMemo(() => {
    if (!data) return [];
    return data.nodes.map((n) => (n.id === "router" ? { ...n, status: data.routerStatus } : n));
  }, [data]);
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);

  const edgeStatus = (e: ChainEdge): NodeStatus => {
    if (e.isGap) return "gap";
    const a = byId[e.from]?.status ?? "gap", b = byId[e.to]?.status ?? "gap";
    return RANK[a] >= RANK[b] ? a : b;
  };

  const related = (id: string) =>
    new Set([id, ...(data?.edges ?? []).flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : []))]);
  const focus = selected ? related(selected) : null;
  const sel = selected ? byId[selected] : null;

  const counts = nodes.reduce((acc, n) => ({ ...acc, [n.status]: (acc[n.status] ?? 0) + 1 }), {} as Record<NodeStatus, number>);
  const nextIn = Math.max(0, Math.ceil((dataUpdatedAt + HEARTBEAT_INTERVAL_MS - now) / 1000));
  const routerStatus = data?.routerStatus ?? "warn";
  const beat = dataUpdatedAt;

  return (
    <div className="max-w-7xl mx-auto space-y-6 text-fg">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/agents" className="inline-flex items-center gap-1 text-xs text-fgMuted hover:text-fg font-mono">
            <ArrowLeft className="h-3 w-3" /> agents
          </Link>
          <h1 className="text-3xl font-bold tracking-tight mt-1 flex items-center gap-3">
            Router Chain & Topology
            <span className="relative flex h-3 w-3">
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-70 animate-ping ${STATUS_BG[routerStatus]}`} />
              <span className={`relative inline-flex h-3 w-3 rounded-full ${STATUS_BG[routerStatus]}`} />
            </span>
          </h1>
          <p className="text-sm text-fgMuted mt-1">
            Live dependency graph: intake bots → shared state → auth → memory → router → vendor rungs → agent lanes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-fgMuted">{isFetching ? "probing…" : `next beat in ${nextIn}s`}</span>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Ping now
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/activity"><Activity className="h-3.5 w-3.5" /> Activity</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/settings"><Settings2 className="h-3.5 w-3.5" /> Settings</Link>
          </Button>
        </div>
      </div>

      {/* Telemetry strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Router" value={STATUS_LABEL[routerStatus]} tone={STATUS_TEXT[routerStatus]} icon={<Radio className="h-4 w-4" />} />
        <Stat label="Probe latency" value={data?.latencyMs != null ? `${data.latencyMs} ms` : "unreachable"} tone={data?.reachable ? "text-success" : "text-warning"} icon={<Activity className="h-4 w-4" />} />
        <Stat label="Vendors healthy" value={data?.vendorsHealthy ?? "—"} tone="text-fg" />
        <Stat label="Host" value={data?.hostname ?? "—"} tone="text-fg" sub={data ? new Date(data.verifiedAt).toLocaleTimeString() : undefined} />
      </div>

      {/* Heartbeat bars */}
      <div className="rounded-lg border border-border bg-bgMuted/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-fgMuted">heartbeat · last {history.length} probes · every {HEARTBEAT_INTERVAL_MS / 1000}s</span>
          {!data?.reachable && data && (
            <span className="text-xs text-warning">Router not reachable from this browser — showing last known wiring.</span>
          )}
        </div>
        <div className="flex items-end gap-1 h-10">
          {Array.from({ length: 30 }).map((_, i) => {
            const h = history[i - (30 - history.length)];
            const height = h ? (h.ok ? Math.min(100, 25 + (h.ms ?? 0) / 8) : 100) : 10;
            return (
              <div
                key={i}
                title={h ? `${new Date(h.t).toLocaleTimeString()} · ${h.ok ? `${h.ms} ms` : "no response"}` : "pending"}
                className={`flex-1 rounded-sm transition-all ${h ? STATUS_BG[h.ok ? h.status : "crit"] : "bg-border"} ${h ? "opacity-80" : "opacity-40"}`}
                style={{ height: `${height}%` }}
              />
            );
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-4">
        {/* Graph */}
        <div className="rounded-xl border border-border bg-bg overflow-x-auto">
          <svg viewBox="0 0 1100 630" className="w-full min-w-[820px]" onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
            <defs>
              <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" className="fill-border" />
              </pattern>
            </defs>
            <rect width="1100" height="630" fill="url(#grid)" onClick={() => setSelected(null)} />

            {/* Zone labels */}
            {[["INTAKE", 20], ["STATE / AUTH / MEMORY", 270], ["ROUTER", 640], ["VENDOR RUNGS", 910]].map(([t, x]) => (
              <text key={t as string} x={x as number} y={14} className="fill-fgMuted font-mono" style={{ fontSize: 9, letterSpacing: 2 }}>{t}</text>
            ))}
            <text x={480} y={AGENT_Y - 10} className="fill-fgMuted font-mono" style={{ fontSize: 9, letterSpacing: 2 }}>AGENT LANES (use_case dispatch)</text>

            {data?.edges.map((e) => (
              <Edge
                key={`${e.from}-${e.to}`}
                edge={e}
                status={edgeStatus(e)}
                lit={!!focus && focus.has(e.from) && focus.has(e.to) && (e.from === selected || e.to === selected)}
                dim={!!focus && !(e.from === selected || e.to === selected)}
              />
            ))}

            {/* Router → agent lane fan-out */}
            {AGENT_LANES.map((name, i) => {
              const r = POS.router, b = agentBox(i);
              const d = `M${r.x + r.w / 2},${r.y + r.h} C${r.x + r.w / 2},${b.y - 40} ${b.x + b.w / 2},${b.y - 50} ${b.x + b.w / 2},${b.y}`;
              const st = routerStatus;
              const dim = !!selected && selected !== "router";
              return (
                <g key={name} style={{ opacity: dim ? 0.15 : 1, transition: "opacity .2s" }}>
                  <path d={d} fill="none" stroke={STATUS_STROKE[st]} strokeWidth={1.2} strokeDasharray="2 8">
                    <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1.6s" repeatCount="indefinite" />
                  </path>
                  <Link to={`/agents`}>
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={17} className={name === "Orchestrator" ? "fill-brandPurple/20 stroke-brandPurple" : "fill-bgMuted stroke-border"} strokeWidth={1.2} />
                    <text x={b.x + b.w / 2} y={b.y + 21} textAnchor="middle" className="fill-fg font-medium" style={{ fontSize: 11 }}>{name}</text>
                  </Link>
                </g>
              );
            })}

            {nodes.map((n) => (
              <Node key={n.id} node={n} beat={beat} selected={selected === n.id} dim={!!focus && !focus.has(n.id)} onSelect={setSelected} />
            ))}
          </svg>
        </div>

        {/* Inspector */}
        <aside className="rounded-xl border border-border bg-bgMuted/40 p-4 space-y-4 h-fit">
          {sel ? (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-lg font-semibold">{sel.label}</div>
                  <div className="font-mono text-xs text-fgMuted">{sel.meta}</div>
                </div>
                <button onClick={() => setSelected(null)} className="text-fgMuted hover:text-fg" aria-label="Close inspector"><X className="h-4 w-4" /></button>
              </div>
              <Badge variant="outline" className={`gap-1.5 ${STATUS_TEXT[sel.status]}`}>
                <span className={`h-2 w-2 rounded-full ${STATUS_BG[sel.status]}`} /> {STATUS_LABEL[sel.status]}
              </Badge>
              <div>
                <div className="text-xs font-mono text-fgMuted mb-2">connections</div>
                <ul className="space-y-1.5">
                  {data?.edges.filter((e) => e.from === sel.id || e.to === sel.id).map((e) => {
                    const other = byId[e.from === sel.id ? e.to : e.from];
                    const st = edgeStatus(e);
                    return (
                      <li key={`${e.from}-${e.to}`}>
                        <button onClick={() => setSelected(other?.id ?? null)} className="w-full text-left rounded-md border border-border px-2 py-1.5 hover:bg-bgMuted">
                          <div className="flex items-center gap-2 text-sm">
                            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_BG[st]}`} />
                            <span className="text-fgMuted font-mono text-xs">{e.from === sel.id ? "→" : "←"}</span>
                            {other?.label ?? "?"}
                          </div>
                          {e.label && <div className="font-mono text-[10px] text-fgMuted mt-0.5 pl-4">{e.label}</div>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {sel.id === "router" && (
                <p className="text-xs text-fgMuted">
                  Clients send a <span className="font-mono">use_case</span>; the router picks vendor, model, prompt and fallback chain, then dispatches to the agent lanes below.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="text-sm font-semibold">Legend</div>
              <ul className="space-y-2 text-sm">
                {(["ok", "warn", "crit", "gap"] as NodeStatus[]).map((s) => (
                  <li key={s} className="flex items-center justify-between">
                    <span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${STATUS_BG[s]}`} />{STATUS_LABEL[s]}</span>
                    <span className="font-mono text-xs text-fgMuted">{counts[s] ?? 0}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-fgMuted">Moving dots show live traffic paths. Dashed lines are wiring gaps. Click any node to trace its dependencies.</p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, icon, sub }: { label: string; value: string; tone: string; icon?: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bgMuted/50 px-3 py-2.5">
      <div className="flex items-center justify-between text-xs font-mono text-fgMuted">{label}{icon}</div>
      <div className={`text-lg font-semibold capitalize mt-0.5 ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] font-mono text-fgMuted">verified {sub}</div>}
    </div>
  );
}
