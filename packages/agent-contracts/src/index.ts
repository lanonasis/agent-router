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

// ── L0 platform contract ──────────────────────────────────────────────────
//
// Agent Heaven is the control plane for profiles; onasis-ai-router is the
// inference plane. These declarations are deliberately dependency-free so the
// same contract can be consumed by browser builds, server applications, and
// the router's release tooling without pulling a schema runtime into each.

export const L0_PLATFORM_CONTRACT_VERSION = "1.0.0" as const;
export const L0_PUBLIC_MODEL_ID = "lzero" as const;
export const L0_MODEL_ALIASES = ["lzero", "vortex-l0", "vortexl0", "l0"] as const;
export const L0_CHAT_COMPLETIONS_PATH = "/v1/chat/completions" as const;
export const L0_MODELS_PATH = "/v1/models" as const;

export type L0ModelAlias = typeof L0_MODEL_ALIASES[number];
export type L0AuthTransport = "x-api-key" | "bearer";
export type L0CredentialClass = "platform-api-key" | "user-token" | "session";
export type L0MessageRole = "user" | "assistant" | "tool";
export type L0ProfileStatus = "draft" | "active" | "retired";
export type L0MemoryMode = "none" | "organization-scoped" | "user-scoped";

/**
 * Values returned by UAI after credential resolution. Applications never
 * supply these fields; the router obtains them from auth-gateway.
 */
export interface UAIIdentityScope {
  authId: string;
  organizationId?: string;
  authMethod: string;
  applicationId?: string;
  applicationEntitlements?: string[];
}

export interface L0ChatMessage {
  role: L0MessageRole;
  content: string | null;
  tool_call_id?: string;
  name?: string;
}

/** The public, uniform request accepted by every application surface. */
export interface L0ChatRequest {
  model: typeof L0_PUBLIC_MODEL_ID;
  messages: L0ChatMessage[];
  stream?: false;
  context?: Record<string, unknown>;
}

/**
 * Transport metadata carried alongside a chat request. These values express
 * intent; the router must reconcile them with UAI before activating a profile.
 */
export interface L0ProfileRequestBinding {
  profileId: string;
  applicationId?: string;
}

export interface L0ChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: typeof L0_PUBLIC_MODEL_ID;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string | null };
    finish_reason: "stop" | "tool_calls";
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface L0ErrorResponse {
  error: {
    message: string;
    type: "authentication_error" | "invalid_request_error" | "server_error";
    code: string;
    param?: string | null;
  };
}

/**
 * A versioned, reviewed Agent Heaven profile. The profile owns hidden system
 * instructions and capability policy; callers may not provide them in chat
 * messages. `applicationId` is enforced from UAI entitlement data, not merely
 * trusted from an HTTP header.
 */
export interface AgentProfileManifest {
  profileId: string;
  applicationId: string;
  version: string;
  status: L0ProfileStatus;
  publicModel: typeof L0_PUBLIC_MODEL_ID;
  roleTemplate: string;
  identityTemplate: string;
  policyDocuments: string[];
  allowedTools: string[];
  memoryMode: L0MemoryMode;
  allowedMessageRoles: L0MessageRole[];
  allowedContextFields: string[];
  limits: {
    maxInputTokens: number;
    maxOutputTokens: number;
    requestTimeoutMs: number;
  };
}

/** Cache/inflight partition required for any memory prefetch. */
export interface MemoryPrefetchPartitionKey {
  authId: string;
  organizationId?: string;
  profileId: string;
  filters?: Record<string, unknown>;
}

export type L0InferenceOutcome =
  | "completed"
  | "completed_without_memory"
  | "completed_after_fallback"
  | "rejected"
  | "failed";

export interface L0RequestOutcome {
  outcome: L0InferenceOutcome;
  profileId?: string;
  profileVersion?: string;
  applicationId?: string;
  memoryMode?: L0MemoryMode;
}

export function isKnownL0Model(model: string | undefined | null): boolean {
  if (!model) return true;
  return L0_MODEL_ALIASES.includes(model.trim().toLowerCase() as L0ModelAlias);
}
