
export type AgentStatus = "active" | "inactive" | "draft";

export type AgentRole = 
  | "Orchestrator"
  | "Coder"
  | "Researcher"
  | "Reviewer"
  | "Architect"
  | "Tester";

// Legacy type kept for compatibility with filters/UI
export type AgentTypeCategory = 
  | "Orchestrator" 
  | "Sub-Agent"
  | "Customer Service" 
  | "Sales & Marketing" 
  | "Technical Support" 
  | "IT Helpdesk" 
  | "Lead Generation" 
  | "Appointment Booking" 
  | "FAQ & Knowledge Base" 
  | "Customer Onboarding" 
  | "Billing & Payments" 
  | "Feedback Collection" 
  | "Other Function";

export interface AgentChannelConfig {
  enabled: boolean;
  details?: string;
  config?: Record<string, any>;
}

export interface VoiceTrait {
  name: string;
  color?: string;
}

export interface AgentType {
  id: string;
  name: string;
  description: string;
  type: AgentTypeCategory;
  role?: AgentRole;
  status: AgentStatus;
  createdAt: string;
  updatedAt?: string;
  model?: string;
  voice?: string;
  voiceProvider?: string;
  customVoiceId?: string;
  voiceTraits?: VoiceTrait[];
  avmScore?: number;
  interactions?: number;
  csat?: number;
  performance?: number;
  channels?: string[];
  channelConfigs?: Record<string, AgentChannelConfig>;
  isPersonal?: boolean;
  avatar?: string;
  purpose?: string;
  prompt?: string;
  sourceDoc?: string;
  industry?: string;
  customIndustry?: string;
  botFunction?: string;
  customFunction?: string;
  phone?: string;
  email?: string;

  // Extended identity fields (doc-driven)
  soulSummary?: string;
  traits?: string[];
  temperature?: number;
  promptSource?: string;
  behaviorNotes?: string[];
  sharedDocs?: string[];
}
