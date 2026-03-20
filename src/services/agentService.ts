
import { AgentType, AgentTypeCategory } from '@/types/agent';

// Mock data for development
const mockAgents: AgentType[] = [
  {
    id: "1",
    name: "Customer Support Bot",
    description: "Handles customer inquiries and support tickets automatically.",
    type: "Customer Service",
    status: "active",
    createdAt: "2023-10-15",
    interactions: 1253,
    isPersonal: true,
    model: "GPT-4",
    channels: ["voice", "chat", "email"],
    avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=1",
    purpose: "Help users with their customer support questions and resolve issues.",
    prompt: "You are a customer support bot. Your job is to help users solve their problems and answer their questions about our products and services."
  },
  {
    id: "2",
    name: "Sales Assistant",
    description: "Guides customers through the sales process and answers product questions.",
    type: "Sales & Marketing" as AgentTypeCategory,
    status: "active",
    createdAt: "2023-11-22",
    interactions: 876,
    isPersonal: false,
    model: "Claude-2",
    channels: ["voice", "chat", "whatsapp", "sms"],
    avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=2",
    purpose: "Help users find the right products and make purchasing decisions.",
    prompt: "You are a sales assistant bot. Your job is to help users find the right products for their needs and guide them through the purchasing process."
  },
  {
    id: "3",
    name: "Knowledge Base Agent",
    description: "Provides information from company documentation and knowledge base.",
    type: "FAQ & Knowledge Base",
    status: "inactive",
    createdAt: "2024-01-05",
    interactions: 432,
    isPersonal: true,
    model: "GPT-3.5 Turbo",
    channels: ["voice", "chat"]
  },
  {
    id: "4",
    name: "Meeting Scheduler",
    description: "Helps schedule and manage meetings with clients and team members.",
    type: "Appointment Booking",
    status: "active",
    createdAt: "2024-02-10",
    interactions: 198,
    isPersonal: false,
    model: "LLama-2",
    channels: ["voice", "email", "sms"]
  },
  {
    id: "5",
    name: "Document Analyzer",
    description: "Analyzes documents and extracts key information automatically.",
    type: "Technical Support",
    status: "inactive",
    createdAt: "2024-03-01",
    interactions: 52,
    isPersonal: true,
    model: "GPT-4",
    channels: ["voice"]
  },
  // Agents from agent model docs
  {
    id: "coder",
    name: "Coder Agent",
    description: "Senior TypeScript/full-stack engineer responsible for writing, editing, and refactoring production-grade code. Thinks in types, handles edge cases, and matches existing codebase patterns.",
    type: "Technical Support",
    status: "active",
    createdAt: "2025-03-08",
    interactions: 2847,
    isPersonal: false,
    model: "GPT-4",
    channels: ["chat"],
    avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=coder",
    purpose: "Ship clean, tested, production-grade code. No TODOs left behind without tracking. Types and tests are not optional.",
    prompt: "You are the Coder Agent: a senior TypeScript/full-stack engineer. You write code that other engineers would be proud to review. Read existing code before writing new code. Match conventions. Write types/interfaces first, then implementation, then tests. No `any` types, no console.log, no empty catch blocks."
  },
  {
    id: "researcher",
    name: "Researcher Agent",
    description: "Finds signal in noise across documentation, APIs, and codebases. Cites everything and delivers structured, actionable research summaries.",
    type: "FAQ & Knowledge Base",
    status: "active",
    createdAt: "2025-03-08",
    interactions: 1563,
    isPersonal: false,
    model: "GPT-4",
    channels: ["chat"],
    avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=researcher",
    purpose: "Find signal in noise. Cite everything. Deliver structured, actionable research with clear sources and confidence levels.",
    prompt: "You are the Researcher Agent. Your job is to find accurate, relevant information and synthesize it into clear, actionable summaries. Always cite sources. Label confidence levels. Distinguish facts from inference."
  },
  {
    id: "reviewer",
    name: "Reviewer Agent",
    description: "Constructive code critic who always provides fixes alongside feedback. Reviews for correctness, performance, security, and maintainability.",
    type: "Technical Support",
    status: "active",
    createdAt: "2025-03-08",
    interactions: 1891,
    isPersonal: false,
    model: "GPT-4",
    channels: ["chat"],
    avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=reviewer",
    purpose: "Review code for correctness, performance, security, and maintainability. Always provide fixes alongside criticism. Constructive, never dismissive.",
    prompt: "You are the Reviewer Agent. Review code with precision: check for correctness, performance, security, and maintainability. Every critique comes with a suggested fix. Be constructive, never dismissive."
  },
  {
    id: "architect",
    name: "Architect Agent",
    description: "Thinks in systems and makes tradeoffs visible. Designs scalable architectures, evaluates technology choices, and documents decision rationale.",
    type: "Technical Support",
    status: "active",
    createdAt: "2025-03-08",
    interactions: 734,
    isPersonal: false,
    model: "GPT-4",
    channels: ["chat"],
    avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=architect",
    purpose: "Think in systems. Make tradeoffs visible. Design architectures that scale and document the reasoning behind every decision.",
    prompt: "You are the Architect Agent. You think in systems, not components. Evaluate tradeoffs explicitly. Design for scalability, maintainability, and clarity. Every architectural decision includes rationale and alternatives considered."
  },
  {
    id: "tester",
    name: "Tester Agent",
    description: "Breaks things so users don't. Writes comprehensive test suites with zero flaky tests, covering edge cases, error conditions, and integration boundaries.",
    type: "Technical Support",
    status: "active",
    createdAt: "2025-03-08",
    interactions: 1205,
    isPersonal: false,
    model: "GPT-4",
    channels: ["chat"],
    avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=tester",
    purpose: "Break things so users don't. Zero flaky tests. Cover happy paths, edge cases, error conditions, and integration boundaries.",
    prompt: "You are the Tester Agent. Write comprehensive test suites: unit tests, integration tests, edge case tests. Test names describe behavior, not implementation. Zero flaky tests. If it can break, write a test for it."
  },
  {
    id: "orchestrator",
    name: "Orchestrator Agent",
    description: "Coordinates quality and momentum across all agents. Calm, decisive task decomposition and delegation with clear success criteria for each subtask.",
    type: "Other Function",
    status: "active",
    createdAt: "2025-03-08",
    interactions: 3412,
    isPersonal: false,
    model: "GPT-4",
    channels: ["chat"],
    avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=orchestrator",
    purpose: "Coordinate quality and momentum. Decompose tasks, delegate to the right agent, and ensure each subtask has clear success criteria.",
    prompt: "You are the Orchestrator Agent. You coordinate all other agents. Decompose complex tasks into clear subtasks. Delegate to the right specialist. Track progress. Ensure quality and momentum. Calm and decisive."
  }
];

// Simulating API call to fetch agents
export const fetchAgents = async (filter: string): Promise<AgentType[]> => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 800));
  
  // Filter the mock data based on the filter parameter
  if (filter === 'my-agents') {
    return mockAgents.filter(agent => agent.isPersonal);
  } else if (filter === 'team-agents') {
    return mockAgents.filter(agent => !agent.isPersonal);
  }
  
  // Default: return all agents
  return mockAgents;
};

// Simulating API call to fetch agent by ID
export const fetchAgentById = async (agentId: string): Promise<AgentType> => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 600));
  
  const agent = mockAgents.find(a => a.id === agentId);
  
  if (!agent) {
    throw new Error(`Agent with id ${agentId} not found`);
  }
  
  return agent;
};

// Simulating API call to create a new agent
export const createAgent = async (agentData: Omit<AgentType, 'id' | 'createdAt' | 'interactions'>): Promise<AgentType> => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Create a new agent with mock data
  const newAgent: AgentType = {
    ...agentData,
    id: Math.random().toString(36).substring(2, 9),
    createdAt: new Date().toISOString().split('T')[0],
    interactions: 0
  };
  
  // In a real app, you would add this to the database
  // mockAgents.push(newAgent);
  
  return newAgent;
};

// Simulating API call to update an agent
export const updateAgent = async (agentId: string, agentData: Partial<AgentType>): Promise<AgentType> => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 800));
  
  const agent = mockAgents.find(a => a.id === agentId);
  
  if (!agent) {
    throw new Error(`Agent with id ${agentId} not found`);
  }
  
  // Update the agent
  const updatedAgent = { ...agent, ...agentData };
  
  // In a real app, you would update this in the database
  // const index = mockAgents.findIndex(a => a.id === agentId);
  // mockAgents[index] = updatedAgent;
  
  return updatedAgent;
};

// Simulating API call to delete an agent
export const deleteAgent = async (agentId: string): Promise<void> => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 600));
  
  const agent = mockAgents.find(a => a.id === agentId);
  
  if (!agent) {
    throw new Error(`Agent with id ${agentId} not found`);
  }
  
  // In a real app, you would remove this from the database
  // const index = mockAgents.findIndex(a => a.id === agentId);
  // mockAgents.splice(index, 1);
};
