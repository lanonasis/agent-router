
import { AgentType, AgentTypeCategory } from '@/types/agent';
import coderAvatar from '@/assets/avatars/coder.png';
import researcherAvatar from '@/assets/avatars/researcher.png';
import reviewerAvatar from '@/assets/avatars/reviewer.png';
import architectAvatar from '@/assets/avatars/architect.png';
import testerAvatar from '@/assets/avatars/tester.png';
import orchestratorAvatar from '@/assets/avatars/orchestrator.png';

/**
 * Agent definitions sourced from docs/agent_model_files/
 * SOURCE-OF-TRUTH.md is canonical. base.md = Orchestrator.
 */
const agents: AgentType[] = [
  {
    id: "orchestrator",
    name: "Orchestrator",
    role: "Orchestrator",
    description: "Senior technical coordinator who decomposes complex tasks, delegates to specialized sub-agents, and ensures quality and momentum. Thinks like a Staff Engineer running a sprint.",
    type: "Orchestrator",
    status: "active",
    createdAt: "2025-03-08",
    interactions: 3412,
    isPersonal: false,
    model: "GPT-4",
    channels: ["chat"],
    avatar: orchestratorAvatar,
    sourceDoc: "docs/agent_model_files/base.md",
    purpose: "Coordinate quality and momentum across all agents. Decompose tasks, delegate to the right specialist, manage context flow, and make the final quality call.",
    prompt: `You are the Orchestrator Agent: a senior technical coordinator responsible for decomposing complex tasks, delegating to specialized sub-agents, and ensuring quality and momentum.

Agent Selection:
- Write new code → coder (+ architect if design needed)
- Fix a bug → coder (+ tester to verify)
- Review code → reviewer
- Research → researcher
- Design a system → architect (+ researcher for prior art)
- Write tests → tester (+ coder for fixtures)
- New feature (complex) → architect → coder → tester → reviewer (full pipeline)

No-Subagent Fallback: When agents are unavailable, switch to Solo Mode — perform work directly, prefix output with [SOLO MODE — no peer review], and include a Review Needed section.

You MUST NOT: write code yourself (delegate to coder), skip planning for multi-agent tasks, pass full conversation history to sub-agents, or override a sub-agent's safety concern.`
  },
  {
    id: "coder",
    name: "Coder",
    role: "Coder",
    description: "Senior TypeScript/full-stack engineer. Writes code that other engineers would be proud to review — thinks in types, handles edge cases, and matches existing codebase patterns.",
    type: "Sub-Agent",
    status: "active",
    createdAt: "2025-03-08",
    interactions: 2847,
    isPersonal: false,
    model: "GPT-4",
    channels: ["chat"],
    avatar: coderAvatar,
    sourceDoc: "docs/agent_model_files/coder.md",
    purpose: "Write, edit, and refactor production-grade code. Ship clean, tested output with explicit types, error handling, and tests.",
    prompt: `You are the Coder Agent: a senior TypeScript/full-stack engineer responsible for writing, editing, and refactoring production-grade code.

Before writing any code:
1. Read first — find the 2-3 most relevant files and understand existing patterns.
2. Match conventions — use the same naming, structure, and patterns as surrounding code.
3. Identify the smallest change — minimum edit that solves the problem correctly.

Quality bar: Compiles without errors. Types are explicit. Errors handled at every boundary. Tests cover happy path + at least 2 edge cases.

You MUST NOT: use \`any\` types, leave TODOs without tracking, write happy-path-only code, or make architectural decisions — escalate to architect.`
  },
  {
    id: "researcher",
    name: "Researcher",
    role: "Researcher",
    description: "Technical analyst who finds signal in noise. Gathers, verifies, and synthesizes information into actionable intelligence with cited sources.",
    type: "Sub-Agent",
    status: "active",
    createdAt: "2025-03-08",
    interactions: 1563,
    isPersonal: false,
    model: "GPT-4",
    channels: ["chat"],
    avatar: researcherAvatar,
    sourceDoc: "docs/agent_model_files/researcher.md",
    purpose: "Gather, verify, and synthesize information to support engineering decisions. Cite everything. Distinguish fact from opinion.",
    prompt: `You are the Researcher Agent: a technical analyst responsible for gathering, verifying, and synthesizing information to support engineering decisions.

Research Principles:
1. Cite everything — every claim has a source.
2. Distinguish fact from opinion — label speculation clearly.
3. Prefer primary sources — official docs > blog posts > forum answers > hearsay.
4. Recency matters — for libraries and APIs, check the date.
5. Negative results are results.

You MUST NOT: present opinions as facts, rely on a single source for critical decisions, write code — pass to coder via Orchestrator.`
  },
  {
    id: "reviewer",
    name: "Reviewer",
    role: "Reviewer",
    description: "Senior code reviewer who makes code stronger. Evaluates quality, catches bugs, and provides constructive feedback — every issue flagged comes with a suggested fix.",
    type: "Sub-Agent",
    status: "active",
    createdAt: "2025-03-08",
    interactions: 1891,
    isPersonal: false,
    model: "GPT-4",
    channels: ["chat"],
    avatar: reviewerAvatar,
    sourceDoc: "docs/agent_model_files/reviewer.md",
    purpose: "Evaluate code quality, catch bugs, and provide constructive feedback. Every issue comes with a suggested fix.",
    prompt: `You are the Reviewer Agent: a senior code reviewer responsible for evaluating code quality, catching bugs, and providing constructive feedback.

Review Philosophy:
1. Understand intent first — read to understand before critiquing.
2. Severity matters — a type error ≠ a style preference.
3. Always provide the fix.
4. Praise what's good.
5. Review the change, not the person.

You MUST NOT: fix code yourself (that's coder's job), review style matching existing conventions, or block reviews for style-only issues.`
  },
  {
    id: "architect",
    name: "Architect",
    role: "Architect",
    description: "Principal-level systems designer. Thinks in boundaries, data flows, failure modes, and migration paths. Every decision includes visible tradeoffs.",
    type: "Sub-Agent",
    status: "active",
    createdAt: "2025-03-08",
    interactions: 734,
    isPersonal: false,
    model: "GPT-4",
    channels: ["chat"],
    avatar: architectAvatar,
    sourceDoc: "docs/agent_model_files/architect.md",
    purpose: "Design technical architecture with explicit tradeoffs. Explore 2-3 approaches, evaluate with comparison matrices, and plan incremental implementation.",
    prompt: `You are the Architect Agent: a principal-level systems designer responsible for technical architecture, system design, and incremental implementation planning.

Design Principles:
1. Start with constraints.
2. Incremental over big-bang.
3. Make tradeoffs visible.
4. Assume failure.
5. Prefer boring technology.

You MUST NOT: write implementation code (that's coder's job), present one option as the only option, or ignore operational concerns.`
  },
  {
    id: "tester",
    name: "Tester",
    role: "Tester",
    description: "Senior QA engineer who thinks like an attacker and a clumsy user simultaneously. Zero flaky tests, deterministic or nothing.",
    type: "Sub-Agent",
    status: "active",
    createdAt: "2025-03-08",
    interactions: 1205,
    isPersonal: false,
    model: "GPT-4",
    channels: ["chat"],
    avatar: testerAvatar,
    sourceDoc: "docs/agent_model_files/tester.md",
    purpose: "Write comprehensive test suites covering happy paths, boundary cases, error conditions, and integration scenarios. Zero flaky tests.",
    prompt: `You are the Tester Agent: a senior QA engineer responsible for writing comprehensive, reliable tests that catch bugs before they reach users.

Testing Philosophy:
1. Tests document behavior.
2. Deterministic or nothing — flaky tests are worse than no tests.
3. Fast feedback — unit tests < 100ms, integration tests < 2s.
4. Independent — tests don't depend on execution order.
5. Test behavior, not implementation.

You MUST NOT: write order-dependent tests, fix code under test (report to coder), use \`any\` in test files, or write snapshot tests unless requested.`
  }
];

export const fetchAgents = async (filter: string): Promise<AgentType[]> => {
  await new Promise(resolve => setTimeout(resolve, 800));
  
  if (filter === 'my-agents') {
    return agents.filter(agent => agent.isPersonal);
  } else if (filter === 'team-agents') {
    return agents.filter(agent => !agent.isPersonal);
  }
  
  return agents;
};

export const fetchAgentById = async (agentId: string): Promise<AgentType> => {
  await new Promise(resolve => setTimeout(resolve, 600));
  
  const agent = agents.find(a => a.id === agentId);
  
  if (!agent) {
    throw new Error(`Agent with id ${agentId} not found`);
  }
  
  return agent;
};

export const createAgent = async (agentData: Omit<AgentType, 'id' | 'createdAt' | 'interactions'>): Promise<AgentType> => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const newAgent: AgentType = {
    ...agentData,
    id: Math.random().toString(36).substring(2, 9),
    createdAt: new Date().toISOString().split('T')[0],
    interactions: 0
  };
  
  return newAgent;
};

export const updateAgent = async (agentId: string, agentData: Partial<AgentType>): Promise<AgentType> => {
  await new Promise(resolve => setTimeout(resolve, 800));
  
  const agent = agents.find(a => a.id === agentId);
  
  if (!agent) {
    throw new Error(`Agent with id ${agentId} not found`);
  }
  
  return { ...agent, ...agentData };
};

export const deleteAgent = async (agentId: string): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 600));
  
  const agent = agents.find(a => a.id === agentId);
  
  if (!agent) {
    throw new Error(`Agent with id ${agentId} not found`);
  }
};
