/**
 * Build-time documentation manifest.
 *
 * HOW IT WORKS:
 * Vite's `?raw` suffix imports file contents as a plain string at build time.
 * This eliminates manual copy-paste mirroring — when a markdown file changes,
 * the next build automatically picks up the new content.
 *
 * WORKFLOW FOR UPDATING DOCS:
 * 1. Edit the markdown file in docs/agent_model_files/
 * 2. Rebuild the app (or let HMR pick it up)
 * 3. The /docs browser reflects the new content automatically
 *
 * No manual sync step. No mirrored TypeScript strings to maintain.
 */

// ── Shared system documents (raw markdown) ─────────────────────────────
import soulRaw from '../../docs/agent_model_files/SOUL.md?raw';
import identityLayerRaw from '../../docs/agent_model_files/IDENTITY-LAYER.md?raw';
import policiesRaw from '../../docs/agent_model_files/policies.md?raw';
import toolsRaw from '../../docs/agent_model_files/tools.md?raw';
import sourceOfTruthRaw from '../../docs/agent_model_files/SOURCE-OF-TRUTH.md?raw';

// ── Agent-specific documents (raw markdown) ────────────────────────────
import baseRaw from '../../docs/agent_model_files/base.md?raw';
import architectRaw from '../../docs/agent_model_files/architect.md?raw';
import coderRaw from '../../docs/agent_model_files/coder.md?raw';
import researcherRaw from '../../docs/agent_model_files/researcher.md?raw';
import reviewerRaw from '../../docs/agent_model_files/reviewer.md?raw';
import testerRaw from '../../docs/agent_model_files/tester.md?raw';

// ── Manifest types ─────────────────────────────────────────────────────

export interface DocManifestEntry {
  /** Display label in the UI */
  label: string;
  /** Path to the canonical source file (relative to project root) */
  file: string;
  /** Raw markdown content, loaded at build time */
  content: string;
  /** Content source type — always 'build-imported' for this manifest */
  sourceType: 'build-imported';
}

// ── Shared docs manifest ───────────────────────────────────────────────

export const SHARED_DOCS_MANIFEST: DocManifestEntry[] = [
  { label: 'Source of Truth', file: 'docs/agent_model_files/SOURCE-OF-TRUTH.md', content: sourceOfTruthRaw, sourceType: 'build-imported' },
  { label: 'Soul Identity',  file: 'docs/agent_model_files/SOUL.md',            content: soulRaw,          sourceType: 'build-imported' },
  { label: 'Identity Layer', file: 'docs/agent_model_files/IDENTITY-LAYER.md',  content: identityLayerRaw, sourceType: 'build-imported' },
  { label: 'Policies & Safety', file: 'docs/agent_model_files/policies.md',     content: policiesRaw,      sourceType: 'build-imported' },
  { label: 'Tool Registry',  file: 'docs/agent_model_files/tools.md',           content: toolsRaw,         sourceType: 'build-imported' },
];

// ── Agent docs manifest ────────────────────────────────────────────────

export const AGENT_DOCS_MANIFEST: Record<string, DocManifestEntry> = {
  orchestrator: { label: 'Orchestrator', file: 'docs/agent_model_files/base.md',       content: baseRaw,       sourceType: 'build-imported' },
  architect:    { label: 'Architect',    file: 'docs/agent_model_files/architect.md',   content: architectRaw,  sourceType: 'build-imported' },
  coder:        { label: 'Coder',        file: 'docs/agent_model_files/coder.md',       content: coderRaw,      sourceType: 'build-imported' },
  researcher:   { label: 'Researcher',   file: 'docs/agent_model_files/researcher.md',  content: researcherRaw, sourceType: 'build-imported' },
  reviewer:     { label: 'Reviewer',     file: 'docs/agent_model_files/reviewer.md',    content: reviewerRaw,   sourceType: 'build-imported' },
  tester:       { label: 'Tester',       file: 'docs/agent_model_files/tester.md',      content: testerRaw,     sourceType: 'build-imported' },
};

/**
 * Get raw markdown content for a shared doc by label.
 * Returns null if the label doesn't match any manifest entry.
 */
export function getSharedDocRaw(label: string): DocManifestEntry | null {
  return SHARED_DOCS_MANIFEST.find(d => d.label === label) ?? null;
}

/**
 * Get raw markdown content for an agent doc by agent ID.
 * Returns null if the agent ID doesn't match any manifest entry.
 */
export function getAgentDocRaw(agentId: string): DocManifestEntry | null {
  return AGENT_DOCS_MANIFEST[agentId] ?? null;
}
