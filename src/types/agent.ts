
export type AgentStatus = "active" | "inactive" | "draft";
export type AgentTypeCategory = 
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
  phone?: string;
  email?: string;
  avatar?: string;
  purpose?: string;
  prompt?: string;
  industry?: string;
  customIndustry?: string;
  botFunction?: string;
  customFunction?: string;
}
