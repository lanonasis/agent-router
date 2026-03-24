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

  // Doc-driven identity fields
  soulSummary?: string;
  traits?: string[];
  temperature?: number;
  promptSource?: string;
  behaviorNotes?: string[];
  sharedDocs?: string[];
}
