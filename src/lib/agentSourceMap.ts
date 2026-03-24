/**
 * Source-mapping utility: doc files ↔ agent IDs.
 * Prevents drift between docs and UI.
 */

export interface AgentSourceEntry {
  agentId: string;
  displayName: string;
  docFile: string;
  role: 'Orchestrator' | 'Sub-Agent';
}

export const AGENT_SOURCE_MAP: AgentSourceEntry[] = [
  { agentId: 'orchestrator', displayName: 'Orchestrator', docFile: 'docs/agent_model_files/base.md', role: 'Orchestrator' },
  { agentId: 'architect',    displayName: 'Architect',    docFile: 'docs/agent_model_files/architect.md', role: 'Sub-Agent' },
  { agentId: 'coder',        displayName: 'Coder',        docFile: 'docs/agent_model_files/coder.md', role: 'Sub-Agent' },
  { agentId: 'researcher',   displayName: 'Researcher',   docFile: 'docs/agent_model_files/researcher.md', role: 'Sub-Agent' },
  { agentId: 'reviewer',     displayName: 'Reviewer',     docFile: 'docs/agent_model_files/reviewer.md', role: 'Sub-Agent' },
  { agentId: 'tester',       displayName: 'Tester',       docFile: 'docs/agent_model_files/tester.md', role: 'Sub-Agent' },
];

export const SHARED_DOC_FILES = [
  { file: 'docs/agent_model_files/SOUL.md',             label: 'Soul Identity' },
  { file: 'docs/agent_model_files/IDENTITY-LAYER.md',   label: 'Identity Layer' },
  { file: 'docs/agent_model_files/policies.md',         label: 'Policies & Safety' },
  { file: 'docs/agent_model_files/tools.md',            label: 'Tool Registry' },
  { file: 'docs/agent_model_files/SOURCE-OF-TRUTH.md',  label: 'Source of Truth' },
];

export function getSourceEntry(agentId: string): AgentSourceEntry | null {
  return AGENT_SOURCE_MAP.find(e => e.agentId === agentId) || null;
}

export function getDocFileForAgent(agentId: string): string | null {
  return getSourceEntry(agentId)?.docFile || null;
}

export function getAgentIdForDoc(docFile: string): string | null {
  return AGENT_SOURCE_MAP.find(e => e.docFile === docFile)?.agentId || null;
}

export function isCanonicalAgent(agentId: string): boolean {
  return AGENT_SOURCE_MAP.some(e => e.agentId === agentId);
}
