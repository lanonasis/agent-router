/**
 * Agent draft utilities — generates markdown, manages localStorage drafts,
 * and produces source-map entries from form data.
 *
 * Draft-only workflow: this codebase uses build-time imports from
 * docs/agent_model_files/, so new agents require adding a .md file
 * and rebuilding. Drafts let users prepare content before that step.
 */

import { z } from 'zod';

// ── Schema ─────────────────────────────────────────────────────────────

export const agentDraftSchema = z.object({
  name: z.string().trim().min(1, 'Agent name is required').max(60, 'Name must be under 60 characters'),
  slug: z.string().trim().min(1, 'Agent ID is required').max(40, 'ID must be under 40 characters')
    .regex(/^[a-z][a-z0-9-]*$/, 'ID must be lowercase, start with a letter, and contain only letters, numbers, and hyphens'),
  role: z.enum(['Orchestrator', 'Sub-Agent'] as const),
  agentRole: z.string().trim().min(1, 'Role label is required').max(40),
  soulSummary: z.string().trim().min(1, 'Soul summary is required').max(300, 'Keep soul summary under 300 characters'),
  purpose: z.string().trim().min(1, 'Purpose is required').max(500),
  traits: z.string().trim().optional(),
  temperature: z.number().min(0).max(1).step(0.1),
  risenPrompt: z.string().trim().min(1, 'RISEN prompt is required'),
  parameterProfile: z.string().trim().optional(),
  sharedDocs: z.array(z.string()).default(['SOUL.md', 'policies.md', 'IDENTITY-LAYER.md']),
});

// The form edits schema input (defaults may not have been applied yet); saved
// drafts and generated documents use the parsed output (with defaults applied).
export type AgentDraftInput = z.input<typeof agentDraftSchema>;
export type AgentDraft = z.output<typeof agentDraftSchema>;

export const DEFAULT_DRAFT: AgentDraft = {
  name: '',
  slug: '',
  role: 'Sub-Agent',
  agentRole: '',
  soulSummary: '',
  purpose: '',
  traits: '',
  temperature: 0.3,
  risenPrompt: '',
  parameterProfile: '',
  sharedDocs: ['SOUL.md', 'policies.md', 'IDENTITY-LAYER.md'],
};

// ── Markdown generation ────────────────────────────────────────────────

export function generateMarkdown(draft: AgentDraftInput): string {
  const traits = parseTraits(draft.traits || '');
  const traitsBlock = traits.length
    ? traits.map(t => `- ${t}`).join('\n')
    : '- (define traits)';

  return `# ${draft.name} Agent

## Role
${draft.agentRole}

## Purpose
${draft.purpose}

## Soul Summary
${draft.soulSummary}

## Traits
${traitsBlock}

## Temperature
${draft.temperature}

## RISEN Prompt
${draft.risenPrompt}
${draft.parameterProfile ? `\n## Parameter Profile\n${draft.parameterProfile}` : ''}

## Shared Documentation
 ${(draft.sharedDocs ?? []).map(d => `- ${d}`).join('\n')}
`;
}

// ── Source map entry ───────────────────────────────────────────────────

export function generateSourceMapEntry(draft: AgentDraftInput): string {
  return `{ agentId: '${draft.slug}', displayName: '${draft.name}', docFile: 'docs/agent_model_files/${draft.slug}.md', role: '${draft.role}' },`;
}

// ── Trait parsing ──────────────────────────────────────────────────────

export function parseTraits(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map(t => t.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
}

// ── Draft persistence (localStorage) ───────────────────────────────────

const DRAFTS_KEY = 'agent-drafts';

export interface SavedDraft {
  id: string;
  draft: AgentDraft;
  savedAt: string;
}

export function loadDrafts(): SavedDraft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveDraft(input: AgentDraftInput): SavedDraft {
  const draft = agentDraftSchema.parse(input);
  const drafts = loadDrafts();
  const existing = drafts.findIndex(d => d.id === draft.slug);
  const entry: SavedDraft = {
    id: draft.slug || `draft-${Date.now()}`,
    draft,
    savedAt: new Date().toISOString(),
  };
  if (existing >= 0) {
    drafts[existing] = entry;
  } else {
    drafts.push(entry);
  }
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  return entry;
}

export function deleteDraft(id: string): void {
  const drafts = loadDrafts().filter(d => d.id !== id);
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}
