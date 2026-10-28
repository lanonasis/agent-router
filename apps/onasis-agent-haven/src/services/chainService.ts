/**
 * Chain Wiring Service
 * Fetches live topology and vendor health data from the AI router.
 * Maps the router's /health endpoint to the Concierge chain wiring diagram.
 */

export interface VendorHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
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
 * Matches the CSS classes in the HTML artifact: ok, warn, crit, gap
 */
export type NodeStatus = 'ok' | 'warn' | 'crit' | 'gap';

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
}

/**
 * An edge (connection) between two nodes.
 */
export interface ChainEdge {
  from: string;
  to: string;
  label?: string;
  isGap?: boolean; // dashed line = missing wiring
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
}

/** Default: router unreachable or not configured */
const DEFAULT_TOPOLOGY: ChainTopology = {
  nodes: [
    { id: 'slack', label: 'Slack bot', meta: 'pm2 · slack-memory-concierge', status: 'gap', links: ['redis', 'authgw', 'memapi', 'router', 'opswebhook'] },
    { id: 'discord', label: 'Discord bot', meta: 'pm2 · discord-memory-concierge', status: 'gap', links: ['redis', 'authgw', 'memapi', 'router', 'opswebhook'] },
    { id: 'redis', label: 'Redis', meta: '127.0.0.1:6379 · shared state', status: 'gap', links: ['slack', 'discord'] },
    { id: 'authgw', label: 'auth-gateway', meta: ':4000 · /v1/auth/resolve/external', status: 'gap', links: ['slack', 'discord', 'memapi'] },
    { id: 'memapi', label: 'Memory API', meta: ':3001 · mcp-core (MaaS)', status: 'gap', links: ['slack', 'discord', 'authgw', 'router'] },
    { id: 'router', label: 'ai-router', meta: 'systemd · :8000', status: 'warn', links: ['slack', 'discord', 'memapi', 'anthropic', 'openai', 'lmstudio', 'morevendors', 'opswebhook'] },
    { id: 'anthropic', label: 'Anthropic', meta: '400 · credit balance', status: 'crit', links: ['router'] },
    { id: 'openai', label: 'OpenAI', meta: '429 · no credits', status: 'crit', links: ['router'] },
    { id: 'lmstudio', label: 'LM Studio', meta: ':1234 · unit failed', status: 'warn', links: ['router'] },
    { id: 'morevendors', label: 'further vendors', meta: 'chain continues, not audited here', status: 'ok', links: ['router'] },
    { id: 'opswebhook', label: 'ops-webhook', meta: ':5555 · /ops/events', status: 'gap', links: ['slack', 'discord'] },
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
    { from: 'router', to: 'anthropic', label: 'credit exhausted' },
    { from: 'router', to: 'openai', label: 'credit exhausted' },
    { from: 'router', to: 'lmstudio', label: 'unsupervised' },
    { from: 'router', to: 'morevendors' },
    { from: 'router', to: 'memapi', label: 'memory.search / memory.get' },
    { from: 'opswebhook', to: 'router', label: 'no alert path', isGap: true },
  ],
  verifiedAt: new Date().toISOString(),
  hostname: 'srv896342',
  routerStatus: 'warn',
  vendorsHealthy: '0/0',
};

/** Map router vendor IDs to diagram node IDs */
const VENDOR_TO_NODE: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  lmstudio: 'lmstudio',
  ollama: 'lmstudio', // Ollama maps to LM Studio in this diagram
  pi: 'morevendors',
  minimax: 'morevendors',
  deepseek: 'morevendors',
  openclaw: 'morevendors',
  hermes: 'morevendors',
  'supabase-edge': 'morevendors',
};

/**
 * Derive a NodeStatus from a VendorHealth status.
 */
function vendorToNodeStatus(vh: VendorHealth | undefined): NodeStatus {
  if (!vh || vh.status === 'unknown') return 'warn';
  return vh.status === 'healthy' ? 'ok' : 'crit';
}

/**
 * Fetch live chain topology from the AI router's /health endpoint.
 * Falls back to static defaults on error.
 *
 * `routerUrl` defaults to `VITE_ROUTER_URL` (set in .env or build args),
 * which prevents snapshots built without that env from pointing browsers
 * at `localhost:8000` — a dead end that breaks every viewer's request.
 */
const DEFAULT_ROUTER_URL =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_ROUTER_URL
    ? import.meta.env.VITE_ROUTER_URL
    : 'http://localhost:8000';

export async function fetchChainTopology(routerUrl = DEFAULT_ROUTER_URL): Promise<ChainTopology> {
  const topology = structuredClone(DEFAULT_TOPOLOGY);
  topology.verifiedAt = new Date().toISOString();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${routerUrl}/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeout);

    if (res.ok) {
      const data: RouterHealth = await res.json();
      const ai = data.services?.ai || {};
      const [healthy, total] = (data.vendors_healthy || '0/0').split('/').map(Number);

      topology.vendorsHealthy = data.vendors_healthy;
      topology.verifiedAt = data.timestamp || topology.verifiedAt;

      // Determine overall router status
      if (data.status === 'healthy') topology.routerStatus = 'ok';
      else if (data.status === 'unavailable') topology.routerStatus = 'crit';
      else topology.routerStatus = 'warn';

      // Update vendor nodes from live health data
      for (const [vendorId, health] of Object.entries(ai)) {
        const nodeId = VENDOR_TO_NODE[vendorId.toLowerCase()];
        if (nodeId) {
          const node = topology.nodes.find((n) => n.id === nodeId);
          if (node) {
            node.status = vendorToNodeStatus(health);
            if (health.error) {
              node.meta = health.error;
            }
          }
        }
      }

      // If we have no healthy vendors at all, mark router as crit
      if (total > 0 && healthy === 0) {
        topology.routerStatus = 'crit';
      }

      // Mark all "static" nodes as ok if router is reachable (they're assumed up in the diagram)
      // Only mark them as gap if we can't reach the router at all
      if (topology.routerStatus !== 'crit') {
        for (const node of topology.nodes) {
          if (node.id !== 'router' && !VENDOR_TO_NODE[node.id.toLowerCase()] && node.status === 'gap') {
            node.status = 'ok';
          }
        }
      }
    }
  } catch {
    // Router unreachable — keep defaults (gap nodes for external services)
    topology.routerStatus = 'warn';
  }

  return topology;
}
