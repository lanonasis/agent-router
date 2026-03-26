// Agent type definitions — single source of truth for UI and router

// ── Core agent types ──────────────────────────────────────────────────────

export type AgentStatus = "active" | "inactive" | "draft";

export type AgentRole =
  | "Orchestrator"
  | "Coder"
  | "Researcher"
  | "Reviewer"
  | "Architect"
  | "Tester";

export type AgentTypeCategory = "Orchestrator" | "Sub-Agent";

export interface AgentType {
  id: string;
  name: string;
  description: string;
  type: AgentTypeCategory;
  role?: AgentRole;
  status: AgentStatus;
  createdAt: string;
  model?: string;
  interactions?: number;
  channels?: string[];
  isPersonal?: boolean;
  avatar?: string;
  purpose?: string;
  prompt?: string;
  sourceDoc?: string;
  soulSummary?: string;
  traits?: string[];
  temperature?: number;
  promptSource?: string;
  behaviorNotes?: string[];
  sharedDocs?: string[];
}

// ── Doc types ──────────────────────────────────────────────────────────────

export interface AgentDocSection {
  title: string;
  content: string;
}

export interface AgentDocumentation {
  risenPrompt: AgentDocSection;
  soulSummary: string;
  temperature: number;
  sharedDocs: AgentDocSection[];
  parameterProfile?: AgentDocSection;
}

// ── Source map ────────────────────────────────────────────────────────────
// Maps agent IDs ↔ canonical markdown files in @onasis/agent-model-files

export interface AgentSourceEntry {
  agentId: string;
  displayName: string;
  docFile: string;   // path relative to packages/agent-model-files/
  role: "Orchestrator" | "Sub-Agent";
}

export const AGENT_SOURCE_MAP: AgentSourceEntry[] = [
  { agentId: "orchestrator", displayName: "Orchestrator", docFile: "base.md",        role: "Orchestrator" },
  { agentId: "architect",    displayName: "Architect",    docFile: "architect.md",    role: "Sub-Agent" },
  { agentId: "coder",        displayName: "Coder",        docFile: "coder.md",        role: "Sub-Agent" },
  { agentId: "researcher",   displayName: "Researcher",   docFile: "researcher.md",   role: "Sub-Agent" },
  { agentId: "reviewer",     displayName: "Reviewer",     docFile: "reviewer.md",     role: "Sub-Agent" },
  { agentId: "tester",       displayName: "Tester",       docFile: "tester.md",       role: "Sub-Agent" },
];

export const SHARED_DOC_FILES = [
  { file: "SOUL.md",             label: "Soul Identity" },
  { file: "IDENTITY-LAYER.md",   label: "Identity Layer" },
  { file: "policies.md",         label: "Policies & Safety" },
  { file: "tools.md",            label: "Tool Registry" },
  { file: "SOURCE-OF-TRUTH.md",  label: "Source of Truth" },
];

export function getSourceEntry(agentId: string): AgentSourceEntry | null {
  return AGENT_SOURCE_MAP.find(e => e.agentId === agentId) ?? null;
}

export function getDocFileForAgent(agentId: string): string | null {
  return getSourceEntry(agentId)?.docFile ?? null;
}

export function getAgentIdForDoc(docFile: string): string | null {
  return AGENT_SOURCE_MAP.find(e => e.docFile === docFile)?.agentId ?? null;
}

export function isCanonicalAgent(agentId: string): boolean {
  return AGENT_SOURCE_MAP.some(e => e.agentId === agentId);
}
