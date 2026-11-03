import { getRouterSettings } from "@/lib/routerSettings";
import { fetchRouterCatalog } from "@/services/routerCatalog";
import {
  BEAT_HISTORY,
  aggregateVendorStates,
  deriveEdgeStatus,
  deriveRouterStatus,
  deriveVendorState,
  lanesSummary,
  pushBeat,
  type BeatSample,
  type VendorNodeState,
} from "@/lib/topologyStatus";

export type { BeatSample } from "@/lib/topologyStatus";

/**
 * Chain Wiring Service
 * Fetches live topology and vendor health data from the AI router.
 * Maps the router's /health endpoint to the Concierge chain wiring diagram.
 *
 * /health shape (services/onasis-ai-router server.js + core/vendor-health.js):
 *   { status: healthy|degraded|unavailable, timestamp, vendors_healthy: "3/6",
 *     services: { api, ai: { <vendor>: { status, response_time, reason?, stale?, circuit? } } } }
 * It reports vendors only. Redis, auth-gateway, memory API, ops-webhook and the
 * Slack/Discord bots are NOT in it, so they stay `unknown`.
 */

export interface VendorHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
  /** router field names (core/vendor-health.js) */
  response_time?: number;
  reason?: string;
  stale?: boolean;
  circuit?: string;
  /** legacy fields, kept for existing importers */
  latencyMs?: number;
  error?: string;
}

export interface RouterHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  vendors_healthy: string;
  services: {
    api: string;
    ai: Record<string, VendorHealth>;
  };
  timestamp: string;
}

/**
 * Node status derived from router health + static topology data.
 * `unknown` = the router's /health cannot vouch for this component.
 */
export type NodeStatus = 'ok' | 'warn' | 'crit' | 'gap' | 'unknown';

/**
 * A node in the chain wiring diagram.
 */
export interface ChainNode {
  id: string;
  label: string;
  meta: string;
  status: NodeStatus;
  /** Which other nodes this node connects to (data-links attribute) */
  links: string[];
  /** False when /health says nothing about this component (status is `unknown`). */
  observed?: boolean;
  /** Extra detail for tooltips/inspector (vendor reason, truncated to 140 chars). */
  note?: string;
}

/**
 * An edge (connection) between two nodes.
 */
export interface ChainEdge {
  from: string;
  to: string;
  label?: string;
  isGap?: boolean; // dashed line = missing wiring
  /** Computed from the two endpoints' live status. */
  status?: NodeStatus;
}

/**
 * Live chain topology data.
 */
export interface ChainTopology {
  nodes: ChainNode[];
  edges: ChainEdge[];
  verifiedAt: string;
  hostname: string;
  /** Overall router status derived from /health */
  routerStatus: NodeStatus;
  vendorsHealthy: string;
  /** Round-trip time of the /health probe, null when unreachable */
  latencyMs: number | null;
  /** Whether the router answered the last probe */
  reachable: boolean;
  /** Last ~30 /health probes, oldest first */
  heartbeat: BeatSample[];
  /** "N/M lanes active" from /api/v1/catalog, null when the catalog is unavailable */
  lanes: { active: number; total: number } | null;
}

const NOT_OBSERVED = 'not observed by /health';

/** Static wiring. Live status is layered on top; nothing here claims a state. */
const DEFAULT_TOPOLOGY: ChainTopology = {
  nodes: [
    { id: 'slack', label: 'Slack bot', meta: 'pm2 · slack-memory-concierge', status: 'unknown', observed: false, note: NOT_OBSERVED, links: ['redis', 'authgw', 'memapi', 'router', 'opswebhook'] },
    { id: 'discord', label: 'Discord bot', meta: 'pm2 · discord-memory-concierge', status: 'unknown', observed: false, note: NOT_OBSERVED, links: ['redis', 'authgw', 'memapi', 'router', 'opswebhook'] },
    { id: 'redis', label: 'Redis', meta: '127.0.0.1:6379 · shared state', status: 'unknown', observed: false, note: NOT_OBSERVED, links: ['slack', 'discord'] },
    { id: 'authgw', label: 'auth-gateway', meta: ':4000 · /v1/auth/resolve/external', status: 'unknown', observed: false, note: NOT_OBSERVED, links: ['slack', 'discord', 'memapi'] },
    { id: 'memapi', label: 'Memory API', meta: ':3001 · mcp-core (MaaS)', status: 'unknown', observed: false, note: NOT_OBSERVED, links: ['slack', 'discord', 'authgw', 'router'] },
    { id: 'router', label: 'ai-router', meta: 'systemd · :8000', status: 'unknown', observed: true, links: ['slack', 'discord', 'memapi', 'anthropic', 'openai', 'lmstudio', 'morevendors', 'opswebhook'] },
    { id: 'anthropic', label: 'Anthropic', meta: NOT_OBSERVED, status: 'unknown', observed: false, links: ['router'] },
    { id: 'openai', label: 'OpenAI', meta: NOT_OBSERVED, status: 'unknown', observed: false, links: ['router'] },
    { id: 'lmstudio', label: 'LM Studio', meta: NOT_OBSERVED, status: 'unknown', observed: false, links: ['router'] },
    { id: 'morevendors', label: 'further vendors', meta: NOT_OBSERVED, status: 'unknown', observed: false, links: ['router'] },
    { id: 'opswebhook', label: 'ops-webhook', meta: ':5555 · /ops/events', status: 'unknown', observed: false, note: NOT_OBSERVED, links: ['slack', 'discord'] },
  ],
  edges: [
    { from: 'slack', to: 'redis', label: 'REDIS_URL · lock/idempotency/rate-limit' },
    { from: 'discord', to: 'redis' },
    { from: 'slack', to: 'authgw', label: 'LANONASIS_AUTH_URL' },
    { from: 'discord', to: 'authgw' },
    { from: 'slack', to: 'memapi', label: 'LANONASIS_API_URL' },
    { from: 'discord', to: 'memapi' },
    { from: 'slack', to: 'router', label: 'AI_ROUTER_URL' },
    { from: 'discord', to: 'router' },
    { from: 'slack', to: 'opswebhook', label: 'OPS_WEBHOOK_URL · /ops/events' },
    { from: 'discord', to: 'opswebhook' },
    { from: 'authgw', to: 'memapi', label: 'org + user scope' },
    { from: 'router', to: 'anthropic' },
    { from: 'router', to: 'openai' },
    { from: 'router', to: 'lmstudio' },
    { from: 'router', to: 'morevendors' },
    { from: 'router', to: 'memapi', label: 'memory.search / memory.get' },
    { from: 'opswebhook', to: 'router', label: 'no alert path', isGap: true },
  ],
  verifiedAt: new Date().toISOString(),
  hostname: 'srv896342',
  routerStatus: 'unknown',
  vendorsHealthy: '—',
  latencyMs: null,
  reachable: false,
  heartbeat: [],
  lanes: null,
};

/** Map router vendor IDs to diagram node IDs. Unlisted vendors group under morevendors. */
const VENDOR_TO_NODE: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  lmstudio: 'lmstudio',
  ollama: 'lmstudio', // Ollama maps to LM Studio in this diagram
};
const GROUP_NODE = 'morevendors';

// ─── Module state: heartbeat ring buffer + catalog cache ────────────────────

let beatUrl = '';
let beats: BeatSample[] = [];

const CATALOG_TTL_MS = 60_000;
let catalogCache: { url: string; at: number; lanes: { active: number; total: number } | null } | null = null;

async function laneSummaryFor(routerUrl: string): Promise<{ active: number; total: number } | null> {
  if (catalogCache && catalogCache.url === routerUrl && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.lanes;
  }
  let lanes: { active: number; total: number } | null = null;
  try {
    const catalog = await Promise.race([
      fetchRouterCatalog({ url: routerUrl, apiKey: '', isOverride: false }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    lanes = lanesSummary(catalog.personas);
  } catch {
    lanes = null; // older router (404) or unreachable: the annotation is simply omitted
  }
  catalogCache = { url: routerUrl, at: Date.now(), lanes };
  return lanes;
}

/** Read the heartbeat history without probing (empty before the first beat). */
export function getHeartbeatHistory(): BeatSample[] {
  return beats;
}

/**
 * Probe /health once. Any HTTP response with a parseable router body counts as
 * "answered" — including the router's own 503 `unavailable`, which means it is
 * up but cannot serve, not that it is unreachable.
 */
async function probeHealth(routerUrl: string): Promise<{ sample: BeatSample; data: RouterHealth | null }> {
  const controller = new AbortController();
  const started = performance.now();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${routerUrl}/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const latencyMs = Math.round(performance.now() - started);
    const data = (await res.json()) as RouterHealth;
    if (!data || typeof data.status !== 'string') throw new Error('unrecognised /health body');
    const routerStatus = data.status === 'healthy' || data.status === 'degraded' || data.status === 'unavailable' ? data.status : null;
    return {
      sample: { t: Date.now(), ok: true, latencyMs, routerStatus, vendorsHealthy: data.vendors_healthy ?? null },
      data,
    };
  } catch {
    return { sample: { t: Date.now(), ok: false, latencyMs: null, routerStatus: null, vendorsHealthy: null }, data: null };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch live chain topology from the AI router's /health endpoint.
 * Every call is one heartbeat: it is recorded in a ~30-sample ring buffer and
 * the router node, vendor nodes and edges are all derived from live data.
 * Components /health cannot vouch for stay `unknown`.
 *
 * `routerUrl` defaults to the operator's saved router address (Settings),
 * falling back to the build-time `VITE_ROUTER_URL`.
 */
export async function fetchChainTopology(routerUrl = getRouterSettings().url): Promise<ChainTopology> {
  const topology = structuredClone(DEFAULT_TOPOLOGY);
  topology.verifiedAt = new Date().toISOString();
  try {
    topology.hostname = new URL(routerUrl).host;
  } catch {
    /* keep default label */
  }

  if (beatUrl !== routerUrl) {
    beatUrl = routerUrl;
    beats = [];
  }

  const [{ sample, data }, lanes] = await Promise.all([probeHealth(routerUrl), laneSummaryFor(routerUrl)]);
  beats = pushBeat(beats, sample, BEAT_HISTORY);

  const routerStatus = deriveRouterStatus(beats);
  topology.routerStatus = routerStatus;
  topology.heartbeat = beats;
  topology.reachable = sample.ok;
  topology.latencyMs = sample.latencyMs;
  topology.lanes = lanes;

  const router = topology.nodes.find((n) => n.id === 'router')!;
  router.status = routerStatus;
  if (!sample.ok) {
    router.note = routerStatus === 'gap' ? 'last 2 heartbeats failed' : 'last heartbeat failed';
  }

  if (data) {
    topology.vendorsHealthy = data.vendors_healthy ?? '—';
    topology.verifiedAt = data.timestamp || topology.verifiedAt;

    // Vendor nodes from services.ai.<vendor>
    const grouped: VendorNodeState[] = [];
    for (const [vendorId, health] of Object.entries(data.services?.ai ?? {})) {
      const state = deriveVendorState(health);
      const nodeId = VENDOR_TO_NODE[vendorId.toLowerCase()];
      if (!nodeId) {
        grouped.push(state);
        continue;
      }
      const node = topology.nodes.find((n) => n.id === nodeId);
      if (node) applyState(node, state);
    }
    const groupNode = topology.nodes.find((n) => n.id === GROUP_NODE);
    if (groupNode && grouped.length) applyState(groupNode, aggregateVendorStates(grouped));
  }

  if (lanes) router.meta = `systemd · :8000 · ${lanes.active}/${lanes.total} lanes active`;

  // Edge status derived from the endpoints, never hardcoded.
  const status = Object.fromEntries(topology.nodes.map((n) => [n.id, n.status]));
  for (const e of topology.edges) {
    e.status = deriveEdgeStatus(status[e.from] ?? 'unknown', status[e.to] ?? 'unknown', e.isGap);
  }

  return topology;
}

function applyState(node: ChainNode, state: VendorNodeState) {
  node.status = state.status;
  node.meta = state.meta;
  node.note = state.note;
  node.observed = state.status !== 'unknown' || !!state.note;
}
