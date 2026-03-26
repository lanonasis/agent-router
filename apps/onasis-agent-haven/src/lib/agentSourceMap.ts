/**
 * Re-exports from @onasis/agent-contracts.
 * Source map and utilities now live in packages/agent-contracts/ as the canonical source.
 */
export {
  type AgentSourceEntry,
  AGENT_SOURCE_MAP,
  SHARED_DOC_FILES,
  getSourceEntry,
  getDocFileForAgent,
  getAgentIdForDoc,
  isCanonicalAgent,
} from '@agent-contracts';
