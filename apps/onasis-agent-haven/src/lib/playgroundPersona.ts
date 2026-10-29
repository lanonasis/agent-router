/**
 * Builds the persona prompt the playground sends to the model, entirely from
 * the agent model files — the same documents the router composes from:
 *
 *   role prompt (base.md / <agent>.md)  →  optional SOUL.md + policies.md
 *   →  the tools enabled for this session, with tools.md approval levels
 *   →  tools.md "Tool Execution Rules"
 *
 * Also exposes doc-derived defaults: which tools an agent's own markdown
 * names, and the Orchestrator's task-type routing table from base.md.
 */
import { AGENT_DOCS_MANIFEST, getSharedDocRaw } from '@/data/docManifest';
import {
  TOOL_EXECUTION_RULES,
  TOOL_REGISTRY,
  type RegistryTool,
} from '@/data/toolRegistry';

export interface PersonaPromptOptions {
  agentId: string;
  agentName: string;
  tools: RegistryTool[];
  includeSoul: boolean;
  includePolicies: boolean;
  simulateTools: boolean;
}

export function composePersonaPrompt(o: PersonaPromptOptions): string {
  const role = AGENT_DOCS_MANIFEST[o.agentId];
  const parts: string[] = [];

  parts.push(
    role
      ? `# Role — ${o.agentName} (source: ${role.file})\n\n${role.content.trim()}`
      : `# Role — ${o.agentName}\n\n(Role document unavailable.)`,
  );

  if (o.includeSoul) {
    const soul = getSharedDocRaw('Soul Identity');
    if (soul) parts.push(`# Shared identity (source: ${soul.file})\n\n${soul.content.trim()}`);
  }
  if (o.includePolicies) {
    const policies = getSharedDocRaw('Policies & Safety');
    if (policies) parts.push(`# Policies (source: ${policies.file})\n\n${policies.content.trim()}`);
  }

  if (o.tools.length) {
    const list = o.tools.map((t) => `- \`${t.name}\` — ${t.description} (approval: ${t.approval})`).join('\n');
    parts.push(
      `# Tools available in this session\n\nOnly these tools exist right now. Call them through the function interface; never describe a call you did not make.\n\n${list}` +
        (TOOL_EXECUTION_RULES ? `\n\n## Tool Execution Rules\n\n${TOOL_EXECUTION_RULES}` : ''),
    );
  } else {
    parts.push('# Tools available in this session\n\nNone. Do not claim to read files, run commands, search or use memory — answer from what you are given.');
  }

  parts.push(
    `# Session\n\nThis is an operator test session in Agent Haven. ` +
      (o.tools.length
        ? o.simulateTools
          ? 'Tool calls are simulated: results are placeholders or approval gates, never real data.'
          : 'Tool calls are recorded but not executed; your turn ends at the first call.'
        : ''),
  );

  return parts.join('\n\n---\n\n');
}

/** Tools named in an agent's own markdown (e.g. researcher.md names web_search). */
export function toolsNamedInAgentDoc(agentId: string): string[] {
  const doc = AGENT_DOCS_MANIFEST[agentId]?.content ?? '';
  return TOOL_REGISTRY.filter((t) => new RegExp(`\\b${t.name}\\b`).test(doc)).map((t) => t.name);
}

/** Default tool set: everything tools.md marks `auto`, plus tools the agent's doc names. */
export function defaultToolsForAgent(agentId: string): string[] {
  const named = new Set(toolsNamedInAgentDoc(agentId));
  return TOOL_REGISTRY.filter((t) => t.approval === 'auto' || named.has(t.name)).map((t) => t.name);
}

export interface RoutingUseCase {
  taskType: string;
  primary: string;
  primaryAgentId: string | null;
  support: string;
}

/** base.md "Decision Framework for Agent Selection" table. */
export function parseRoutingTable(markdown: string): RoutingUseCase[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /Decision Framework for Agent Selection/i.test(l));
  if (start < 0) return [];
  const rows: RoutingUseCase[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      if (rows.length) break;
      continue;
    }
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3 || /^-+$/.test(cells[0].replace(/:/g, '')) || cells[0] === 'Task Type') continue;
    const firstAgent = cells[1].match(/`([a-z]+)`/);
    rows.push({
      taskType: cells[0],
      primary: cells[1].replace(/`/g, ''),
      primaryAgentId: firstAgent ? firstAgent[1] : null,
      support: cells[2].replace(/`/g, ''),
    });
  }
  return rows;
}

export const ROUTING_USE_CASES: RoutingUseCase[] = parseRoutingTable(AGENT_DOCS_MANIFEST.orchestrator?.content ?? '');
