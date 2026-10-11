import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchChainTopology, ChainTopology, ChainNode, ChainEdge, NodeStatus } from '@/services/chainService';

// ─── Colour tokens (mirrors the HTML artifact's CSS vars) ───────────────────

const STATUS_COLOURS: Record<NodeStatus, { fill: string; bg: string; border: string }> = {
  ok:    { fill: '#3F7A52', bg: '#DEEBE1', border: '#AEB6A4' },
  warn:  { fill: '#B8862E', bg: '#F1E6CB', border: '#AEB6A4' },
  crit:  { fill: '#B23B2E', bg: '#F5DAD4', border: '#AEB6A4' },
  gap:   { fill: '#6B5E8C', bg: '#E4DFF0', border: '#AEB6A4' },
};

const CSS_VARS = `
  :root {
    --bg: #EEF0EC; --surface: #FFFFFF; --surface-2: #E3E6DE; --surface-3: #D8DCD0;
    --ink: #1C2320; --ink-soft: #4B564F; --ink-faint: #7B857D; --border: #C9CFC2; --border-strong: #AEB6A4;
    --accent: #B5652B; --accent-soft: #E7C9AE;
    --ok: #3F7A52; --ok-bg: #DEEBE1;
    --warn: #B8862E; --warn-bg: #F1E6CB;
    --crit: #B23B2E; --crit-bg: #F5DAD4;
    --gap: #6B5E8C; --gap-bg: #E4DFF0;
    --shadow: 0 1px 2px rgba(28,35,32,.06), 0 6px 16px -8px rgba(28,35,32,.18);
  }
`;

// ─── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: NodeStatus }) {
  const labels: Record<NodeStatus, string> = {
    ok: 'active', warn: 'degraded', crit: 'down', gap: 'not wired',
  };
  return (
    <span className={`status-pill ${status}`}>
      <span className="dot" />
      {labels[status]}
    </span>
  );
}

// ─── SVG edge ────────────────────────────────────────────────────────────────

function SvgEdge({ edge, lit }: { edge: ChainEdge; lit: boolean }) {
  const paths: Record<string, string> = {
    'slack:redis':       'M180,96 C230,96 230,150 280,150',
    'discord:redis':     'M180,206 C230,206 230,160 280,160',
    'slack:authgw':      'M180,90 C260,90 300,40 400,40',
    'discord:authgw':    'M180,212 C260,180 300,60 400,52',
    'slack:memapi':      'M180,104 C300,104 340,230 400,230',
    'discord:memapi':    'M180,200 C300,200 340,238 400,238',
    'slack:router':      'M180,112 C420,112 500,330 640,340',
    'discord:router':    'M180,194 C420,220 500,340 640,350',
    'slack:opswebhook':  'M120,116 C120,300 220,470 280,500',
    'discord:opswebhook':'M120,222 C160,340 220,460 280,492',
    'authgw:memapi':     'M460,66 C470,120 460,180 460,204',
    'router:anthropic':  'M780,330 C830,300 860,220 900,150',
    'router:openai':     'M780,340 C850,320 880,260 900,220',
    'router:lmstudio':   'M780,352 C830,360 860,340 900,320',
    'router:morevendors':'M780,364 C820,400 860,420 900,430',
    'router:memapi':     'M640,332 C560,300 500,270 460,246',
    'opswebhook:router': 'M400,500 C520,480 560,420 640,368',
  };

  const key = `${edge.from}:${edge.to}`;
  const revKey = `${edge.to}:${edge.from}`;
  const d = paths[key] || paths[revKey];
  if (!d) return null;

  return (
    <g>
      <path
        className={`edge${edge.isGap ? ' gapline' : ''}${lit ? ' lit' : ''}`}
        d={d}
        stroke={edge.isGap ? 'var(--gap)' : 'var(--border-strong)'}
        strokeWidth={lit ? 2.2 : 1.6}
        fill="none"
        strokeLinecap="round"
        data-a={edge.from}
        data-b={edge.to}
      />
      {edge.label && (
        <text
          className={`edgelabel${lit ? ' lit' : ''}`}
          x={520}
          y={462}
          data-a={edge.from}
          data-b={edge.to}
          textAnchor="middle"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '9.5px',
            fill: 'var(--ink-faint)',
            opacity: lit ? 1 : 0.5,
          }}
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}

// ─── SVG node ────────────────────────────────────────────────────────────────

interface NodeRectProps {
  node: ChainNode;
  lit: boolean;
  onClick: (id: string) => void;
}

const NODE_POSITIONS: Record<string, { x: number; y: number; w: number; h: number }> = {
  slack:       { x: 20,  y: 64,  w: 160, h: 52 },
  discord:     { x: 20,  y: 176, w: 160, h: 52 },
  redis:       { x: 280, y: 132, w: 150, h: 52 },
  authgw:      { x: 400, y: 14,  w: 170, h: 52 },
  memapi:      { x: 400, y: 204, w: 170, h: 52 },
  router:      { x: 640, y: 308, w: 140, h: 64 },
  anthropic:   { x: 900, y: 118, w: 150, h: 46 },
  openai:      { x: 900, y: 190, w: 150, h: 46 },
  lmstudio:    { x: 900, y: 296, w: 150, h: 52 },
  morevendors: { x: 900, y: 406, w: 150, h: 46 },
  opswebhook:  { x: 280, y: 476, w: 170, h: 52 },
};

const NODE_DOT_OFFSET: Record<string, { cx: number; cy: number }> = {
  slack:       { cx: 34,  cy: 80  },
  discord:     { cx: 34,  cy: 192 },
  redis:       { cx: 294, cy: 148 },
  authgw:      { cx: 414, cy: 30  },
  memapi:      { cx: 414, cy: 220 },
  router:      { cx: 654, cy: 324 },
  anthropic:   { cx: 914, cy: 132 },
  openai:      { cx: 914, cy: 204 },
  lmstudio:    { cx: 914, cy: 312 },
  morevendors: { cx: 914, cy: 420 },
  opswebhook:  { cx: 294, cy: 492 },
};

const NODE_LABEL_OFFSET: Record<string, { tx: number; ty: number; mty: number[] }> = {
  slack:       { tx: 46,  ty: 85,  mty: [102] },
  discord:     { tx: 46,  ty: 197, mty: [214] },
  redis:       { tx: 306, ty: 153, mty: [170] },
  authgw:      { tx: 426, ty: 35,  mty: [52]  },
  memapi:      { tx: 426, ty: 225, mty: [242] },
  router:      { tx: 666, ty: 329, mty: [346, 360] },
  anthropic:   { tx: 926, ty: 137, mty: [152] },
  openai:      { tx: 926, ty: 209, mty: [224] },
  lmstudio:    { tx: 926, ty: 317, mty: [334, 345] },
  morevendors: { tx: 926, ty: 425, mty: [440] },
  opswebhook:  { tx: 306, ty: 497, mty: [514] },
};

function SvgNode({ node, lit, onClick }: NodeRectProps) {
  const pos = NODE_POSITIONS[node.id];
  const dot = NODE_DOT_OFFSET[node.id];
  const lbl = NODE_LABEL_OFFSET[node.id];
  const col = STATUS_COLOURS[node.status];
  const [hovered, setHovered] = useState(false);

  if (!pos || !dot || !lbl) return null;

  return (
    <g
      className={`node${lit ? ' lit' : ''}`}
      data-id={node.id}
      data-links={node.links.join(' ')}
      style={{ cursor: 'pointer' }}
      onClick={() => onClick(node.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(node.id); } }}
    >
      <rect
        x={pos.x}
        y={pos.y}
        width={pos.w}
        height={pos.h}
        rx={9}
        fill="var(--surface)"
        stroke={lit ? 'var(--accent)' : (hovered ? 'var(--accent)' : 'var(--border-strong)')}
        strokeWidth={lit ? 1.8 : 1.3}
        style={{ transition: 'stroke 0.18s ease, stroke-width 0.18s ease' }}
      />
      <circle
        cx={dot.cx}
        cy={dot.cy}
        r={4}
        fill={col.fill}
        style={{ transition: 'opacity 0.18s ease' }}
      />
      <text
        x={lbl.tx}
        y={lbl.ty}
        style={{
          fontFamily: "'Public Sans', sans-serif",
          fontWeight: 600,
          fontSize: '13.5px',
          fill: 'var(--ink)',
        }}
      >
        {node.label}
      </text>
      {lbl.mty.map((my, i) => (
        <text key={i} x={lbl.tx} y={my}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '10.5px',
            fill: 'var(--ink-faint)',
          }}
        >
          {i === 0 ? node.meta : ''}
        </text>
      ))}
    </g>
  );
}

// ─── Diagram ─────────────────────────────────────────────────────────────────

interface DiagramProps {
  topology: ChainTopology;
  activeNode: string | null;
  onNodeClick: (id: string) => void;
}

function Diagram({ topology, activeNode, onNodeClick }: DiagramProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isActive = activeNode !== null;

  // Compute lit nodes: active node + its direct neighbours
  const litNodes = useCallback(() => {
    if (!activeNode) return new Set<string>();
    const lit = new Set<string>([activeNode]);
    const node = topology.nodes.find((n) => n.id === activeNode);
    if (node) {
      node.links.forEach((l) => lit.add(l));
    }
    return lit;
  }, [activeNode, topology.nodes]);

  const litSet = litNodes();

  return (
    <div className="diagram-wrap">
      <style>{`
        .diagram-wrap {
          background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
          padding: 6px; box-shadow: var(--shadow); margin-bottom: 8px;
        }
        .diagram-scroll { overflow-x: auto; }
        .diagram-scroll svg { display: block; min-width: 820px; width: 100%; height: auto; }
        .node rect { fill: var(--surface); stroke: var(--border-strong); stroke-width: 1.3; rx: 9; transition: opacity .18s ease, stroke .18s ease; }
        .node text { fill: var(--ink); }
        .node .label { font-family: 'Public Sans', sans-serif; font-weight: 600; font-size: 13.5px; }
        .node .meta { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; fill: var(--ink-faint); }
        .node { cursor: pointer; }
        .node:hover rect { stroke: var(--accent); }
        .edge { fill: none; stroke: var(--border-strong); stroke-width: 1.6; transition: opacity .18s ease, stroke .18s ease, stroke-width .18s ease; }
        .edge.gapline { stroke: var(--gap); stroke-dasharray: 4 4; }
        .edgelabel { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; fill: var(--ink-faint); transition: opacity .18s ease; }
        .diagram-scroll.active .node { opacity: 0.32; }
        .diagram-scroll.active .edge { opacity: 0.18; }
        .diagram-scroll.active .edgelabel { opacity: 0.18; }
        .diagram-scroll.active .node.lit { opacity: 1; }
        .diagram-scroll.active .edge.lit { opacity: 1; stroke-width: 2.2; }
        .diagram-scroll.active .edgelabel.lit { opacity: 1; }
        .diagram-scroll.active .node.lit rect { stroke: var(--accent); stroke-width: 1.8; }
        .diagram-foot {
          display: flex; justify-content: space-between; align-items: center; gap: 12px;
          padding: 10px 16px 4px; font-size: 12px; color: var(--ink-faint);
        }
        .diagram-foot button {
          font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--accent);
          background: none; border: 1px solid var(--accent-soft); border-radius: 6px;
          padding: 4px 10px; cursor: pointer;
        }
        .diagram-foot button:hover { background: var(--accent-soft); }
        .diagram-foot button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      `}</style>
      <div className={`diagram-scroll${isActive ? ' active' : ''}`} ref={scrollRef}>
        <svg viewBox="0 0 1180 610" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Service wiring diagram">
          <g id="edges">
            {topology.edges.map((edge, i) => (
              <SvgEdge key={i} edge={edge} lit={isActive && (litSet.has(edge.from) && litSet.has(edge.to))} />
            ))}
          </g>
          <g id="nodes">
            {topology.nodes.map((node) => (
              <SvgNode
                key={node.id}
                node={node}
                lit={litSet.has(node.id)}
                onClick={onNodeClick}
              />
            ))}
          </g>
        </svg>
      </div>
      <div className="diagram-foot">
        <span id="tracehint">
          {activeNode
            ? `${topology.nodes.find((n) => n.id === activeNode)?.label} ↔ ${
                topology.nodes
                  .find((n) => n.id === activeNode)
                  ?.links.map((l) => topology.nodes.find((n) => n.id === l)?.label)
                  .join(', ') || ''
              }`
            : 'Nothing traced — click a box to see its blast radius.'}
        </span>
        <button id="resetbtn" type="button" onClick={() => onNodeClick('')}>
          reset
        </button>
      </div>
    </div>
  );
}

// ─── Blast radius table ──────────────────────────────────────────────────────

const BLAST_RADIUS: Record<string, string> = {
  slack:       'Only Slack goes dark. Discord, memory search, and the router are all independent processes — no shared crash path between the two bots except Redis and the auth-gateway they both call.',
  discord:     'Symmetric to Slack. One restart, currently — pm2 restarts=1 from the recall-timeout crash fixed in #305.',
  redis:       'Both bots read it for locking, idempotency and rate-limiting. Discord has no REDIS_URL set — it falls back to localhost:6379 in code, so a moved Redis silently breaks it with no config to check.',
  authgw:      'Every /whoami, link check and org-scoped lookup goes through this. Down = every user looks unlinked, even ones who correctly linked days ago — not a data loss, a resolution loss.',
  memapi:      "The router's memory.search/memory.get tools call this directly. Down = the router still answers, just with no memory grounding — indistinguishable from a model that forgot everything unless you're watching the tool-call result.",
  router:      "Sits between every bot and every model. Down = /onasis status, /onasis recall, both crash silent-timeout; up-but-vendor-starved is worse than down — it keeps answering, just with whichever vendor is left, which is exactly today's incident.",
  lmstudio:    'Designated local fallback under Anthropic + OpenAI. The systemd unit is enabled but failed (Text file busy, no Restart=) — the port is live only because a process was started by hand outside supervision. If that process dies, nothing brings it back.',
  anthropic:   'Ejected on billing, not an outage — 400 and 429 respectively. Router logic worked correctly; the chain had one working local rung too few underneath it.',
  openai:      'Ejected on billing, not an outage — 400 and 429 respectively. Router logic worked correctly; the chain had one working local rung too few underneath it.',
  morevendors: 'Chain continues, not audited here.',
  opswebhook:  'Receives per-interaction audit events from both bots — but the router, the one service that actually watched three vendors fail in a row, has zero call anywhere into it and no alert hook of any kind. This is why nothing paged.',
};

function BlastRadiusTable({ topology }: { topology: ChainTopology }) {
  return (
    <section>
      <style>{`
        .section-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
        .section-head h2 { font-size: 19px; margin: 0; }
        .section-head .count { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ink-faint); }
        .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); }
        table { width: 100%; border-collapse: collapse; min-width: 720px; background: var(--surface); }
        thead th {
          text-align: left; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: .06em;
          text-transform: uppercase; color: var(--ink-faint); font-weight: 500;
          padding: 11px 14px; border-bottom: 1px solid var(--border); background: var(--surface-2);
        }
        tbody td { padding: 13px 14px; border-bottom: 1px solid var(--border); font-size: 13.5px; vertical-align: top; line-height: 1.5; }
        tbody tr:last-child td { border-bottom: none; }
        tbody tr:hover { background: var(--surface-2); }
        .svc { font-weight: 600; white-space: nowrap; }
        .svc .path { display: block; font-family: 'JetBrains Mono', monospace; font-weight: 400; font-size: 11px; color: var(--ink-faint); margin-top: 2px; }
        .status-pill {
          display: inline-flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace;
          font-size: 11px; font-weight: 500; padding: 3px 8px 3px 7px; border-radius: 99px; white-space: nowrap;
        }
        .status-pill .dot { width: 6px; height: 6px; border-radius: 50%; }
        .status-pill.ok { background: var(--ok-bg); color: var(--ok); }
        .status-pill.ok .dot { background: var(--ok); }
        .status-pill.warn { background: var(--warn-bg); color: var(--warn); }
        .status-pill.warn .dot { background: var(--warn); }
        .status-pill.crit { background: var(--crit-bg); color: var(--crit); }
        .status-pill.crit .dot { background: var(--crit); }
        .status-pill.gap { background: var(--gap-bg); color: var(--gap); }
        .status-pill.gap .dot { background: var(--gap); }
        .blast { color: var(--ink-soft); }
        .blast b { color: var(--ink); font-weight: 600; }
      `}</style>
      <div className="section-head">
        <h2>What breaks if it goes missing</h2>
        <span className="count">{topology.nodes.length} nodes</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Node</th><th>Status now</th><th>Blast radius if it disappears</th></tr>
          </thead>
          <tbody>
            {topology.nodes.map((node) => (
              <tr key={node.id}>
                <td className="svc">
                  {node.label}
                  <span className="path">{node.meta}</span>
                </td>
                <td><StatusPill status={node.status} /></td>
                <td className="blast">{BLAST_RADIUS[node.id] || 'No data.'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Incident trace ───────────────────────────────────────────────────────────

const INCIDENT_STEPS = [
  { time: '07:03:37 UTC', cls: 'bad', desc: 'Anthropic ejected — 400 credit balance too low.' },
  { time: '07:03:39 UTC', cls: 'bad', desc: 'OpenAI ejected — 429 no credits remaining.' },
  { time: 'recurring, incl. 08:19 & 09:19', cls: 'bad', desc: 'LM Studio probe — fetch failed. The designated local fallback was unreachable at the exact moments it was needed.' },
  { time: 'next rung', cls: '', desc: 'Chain fell through to a vendor with no native tool-calling support. Router had no supportsTools flag to withhold tools from it — it was offered memory.search/memory.get anyway.' },
  { time: 'output', cls: 'bad', desc: 'The model emitted its tool call as literal text. sanitizeVendorResponse() strips vendor identity and persona names — it has no rule for tool-call markup, so the raw text posted straight to the channel, carrying the user\'s query text with it.' },
  { time: 'the whole time', cls: 'gap', desc: 'No alert fired anywhere. The router has no paging/webhook hook at all, and is not wired to ops-webhook\'s /ops/events — the one sink both bots already report to.' },
];

function IncidentTrace() {
  return (
    <section>
      <style>{`
        .trace {
          background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow);
          padding: 20px 22px 22px;
        }
        .trace-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
        .trace-head h3 { font-size: 15.5px; margin: 0; }
        .trace-tag {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--crit); background: var(--crit-bg);
          padding: 3px 9px; border-radius: 99px; font-weight: 500;
        }
        ol.timeline { list-style: none; margin: 0; padding: 0; position: relative; }
        ol.timeline::before { content: ""; position: absolute; left: 5px; top: 4px; bottom: 4px; width: 1.5px; background: var(--border-strong); }
        ol.timeline li { position: relative; padding-left: 26px; padding-bottom: 16px; }
        ol.timeline li:last-child { padding-bottom: 0; }
        ol.timeline li::before {
          content: ""; position: absolute; left: 0; top: 5px; width: 11px; height: 11px; border-radius: 50%;
          background: var(--surface); border: 2px solid var(--border-strong);
        }
        ol.timeline li.bad::before { border-color: var(--crit); background: var(--crit-bg); }
        ol.timeline li.gap::before { border-color: var(--gap); background: var(--gap-bg); }
        .t-time { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-faint); display: block; margin-bottom: 2px; }
        .t-desc { font-size: 13.5px; color: var(--ink); line-height: 1.5; }
        .t-desc code { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
        .callout {
          margin-top: 18px; padding: 14px 16px; border-radius: 10px; background: var(--gap-bg);
          border: 1px solid color-mix(in srgb, var(--gap) 35%, transparent);
          font-size: 13px; color: var(--ink); line-height: 1.6;
        }
        .callout b { color: var(--gap); }
      `}</style>
      <div className="trace">
        <div className="trace-head">
          <h3>Traced incident — 2026-09-23, /onasis recall</h3>
          <span className="trace-tag">raw tool-call markup reached a public channel</span>
        </div>
        <ol className="timeline">
          {INCIDENT_STEPS.map((step, i) => (
            <li key={i} className={step.cls}>
              <span className="t-time">{step.time}</span>
              <span className="t-desc"
                dangerouslySetInnerHTML={{ __html: step.desc.replace(/`([^`]+)`/g, '<code>$1</code>') }}
              />
            </li>
          ))}
        </ol>
        <div className="callout">
          <b>One idea, two open gaps.</b> The router tracks what to <i>offer</i> a model, but not what it may actually <i>execute</i> — the same seam shows up twice: <code>memory.write</code> is offered without an execution-time check (fix open, <a href="https://github.com/lanonasis/onasis-agent-haven/pull/5" style={{color: 'var(--gap)'}}>PR #5</a>, unmerged), and tool definitions are offered to vendors without checking whether they can execute a tool call at all (no fix yet). Closing one doesn't close the other.
        </div>
      </div>
    </section>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

const ROUTER_URL = import.meta.env.VITE_ROUTER_URL || 'http://localhost:8000';
const POLL_INTERVAL_MS = 30_000;

export default function ChainWiring() {
  const [activeNode, setActiveNode] = useState<string | null>(null);

  const { data: topology } = useQuery<ChainTopology>({
    queryKey: ['chain-topology'],
    queryFn: () => fetchChainTopology(ROUTER_URL),
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: POLL_INTERVAL_MS / 2,
  });

  const handleNodeClick = useCallback((id: string) => {
    if (!id || id === activeNode) {
      setActiveNode(null);
    } else {
      setActiveNode(id);
    }
  }, [activeNode]);

  const verified = topology?.verifiedAt
    ? new Date(topology.verifiedAt).toUTCString().replace('00:00:00', topology.verifiedAt.split('T')[1]?.substring(0, 5) + ':00' || '')
    : 'pending…';

  return (
    <div style={{ padding: '0 20px 64px', maxWidth: 1040, margin: '0 auto' }}>
      <style>{`
        ${CSS_VARS}
        * { box-sizing: border-box; }
        body { background: var(--bg); color: var(--ink); }
        .mono { font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace; }
        h1, h2, h3 { text-wrap: balance; font-weight: 700; letter-spacing: -.01em; }
        header { margin-bottom: 28px; }
        .eyebrow {
          font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 500;
          letter-spacing: .08em; text-transform: uppercase; color: var(--accent);
          display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
        }
        .eyebrow::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); display: inline-block; }
        h1 { font-size: clamp(26px, 4vw, 34px); margin: 0 0 8px; }
        .sub { color: var(--ink-soft); font-size: 15.5px; max-width: 62ch; line-height: 1.55; margin: 0; }
        .verified {
          margin-top: 14px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ink-faint);
          border-top: 1px solid var(--border); padding-top: 12px;
        }
        .legend {
          display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 22px 0 30px;
          padding: 14px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
          box-shadow: var(--shadow);
        }
        .legend-item { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--ink-soft); }
        .chip { width: 9px; height: 9px; border-radius: 2px; flex: none; }
        .chip.ok { background: var(--ok); }
        .chip.warn { background: var(--warn); }
        .chip.crit { background: var(--crit); }
        .chip.gap { background: var(--gap); }
        .legend-hint { margin-left: auto; font-size: 12px; color: var(--ink-faint); }
        footer { margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--border); font-size: 12px; color: var(--ink-faint); }
        @media (max-width: 560px) { .legend-hint { display: none; } .trace-head { flex-direction: column; align-items: flex-start; } }
      `}</style>

      <header>
        <div className="eyebrow">{topology?.hostname || 'srv896342'} &middot; onasis-central</div>
        <h1>Concierge chain wiring</h1>
        <p className="sub">
          Every hop between a Slack or Discord message and an answer, drawn from the live topology — not the intended one.
          Click a node to trace what depends on it.
        </p>
        <div className="verified mono">
          verified live {verified} &middot; {topology?.hostname || 'srv896342'}
          {topology && (
            <span style={{ marginLeft: 12, color: 'var(--ink-faint)' }}>
              · vendors {topology.vendorsHealthy} healthy
            </span>
          )}
        </div>
      </header>

      <div className="legend">
        <div className="legend-item"><span className="chip ok" /> healthy, confirmed live</div>
        <div className="legend-item"><span className="chip warn" /> degraded / unsupervised</div>
        <div className="legend-item"><span className="chip crit" /> down (verified)</div>
        <div className="legend-item"><span className="chip gap" /> not wired — a link that should exist and doesn't</div>
        <div className="legend-hint">click any box in the diagram</div>
      </div>

      {topology && (
        <Diagram topology={topology} activeNode={activeNode} onNodeClick={handleNodeClick} />
      )}

      {topology && <BlastRadiusTable topology={topology} />}

      <IncidentTrace />

      <footer>
        Diagram reflects live process/service state read directly from the host —
        systemctl, pm2 jlist, ss -ltnp, and the router&apos;s own log — not the architecture docs.
        Re-verify before treating a status here as current.
      </footer>
    </div>
  );
}
