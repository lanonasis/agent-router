
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
