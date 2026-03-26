/**
 * Agent documentation metadata & manifest-backed content.
 *
 * ARCHITECTURE:
 * - RISEN prompts and shared docs now come from the build-import pipeline
 *   (docManifest.ts), eliminating ~600 lines of manually mirrored markdown.
 * - Only DERIVED metadata remains manual here: soul summaries, temperatures,
 *   and parameter profile extracts. These are curated one-liners or summaries
 *   that don't exist verbatim in the canonical markdown files.
 *
 * TO UPDATE RISEN PROMPTS OR SHARED DOCS:
 *   Edit the markdown file in docs/agent_model_files/ → rebuild → done.
 *   No changes needed here.
 *
 * TO UPDATE SOUL SUMMARIES OR TEMPERATURES:
 *   Edit the metadata below. These are intentionally manual because they're
 *   curated UI-facing summaries, not raw doc content.
 */

import { AgentDocumentation, AgentDocSection } from './agentDocTypes';
import { AGENT_DOCS_MANIFEST, SHARED_DOCS_MANIFEST } from './docManifest';

// ── Shared docs (build-imported, converted to AgentDocSection format) ──

const sharedDocSections: AgentDocSection[] = SHARED_DOCS_MANIFEST
  .filter(d => ['Soul Identity', 'Policies & Safety', 'Identity Layer'].includes(d.label))
  .map(d => ({ title: d.label, content: d.content }));

// ── Parameter profiles (manual — curated extracts not in raw markdown as standalone sections) ──

const parameterProfiles: Record<string, AgentDocSection> = {
  coder: {
    title: "Parameter Profile",
    content: `\`\`\`
temperature: 0.2       # Precise, deterministic output
top_k: 20              # Narrow vocabulary selection
top_p: 0.8             # Conservative sampling
num_ctx: 8192          # Enough for medium files
repeat_penalty: 1.1    # Avoid repetitive patterns
\`\`\`

**Context Priority**: soul → role → files → task → history → memory
Memory is least critical — coder works from files.`
  },
  researcher: {
    title: "Parameter Profile",
    content: `\`\`\`
temperature: 0.5       # Moderate creativity for synthesis
top_k: 40              # Broader vocabulary for diverse sources
top_p: 0.9             # More varied phrasing
num_ctx: 8192          # Handle multiple sources
repeat_penalty: 1.0    # Allow natural repetition in analysis
\`\`\`

**Context Priority**: soul → role → memory → task → files → history
Memory is elevated — prior research findings are high-value context.`
  },
  reviewer: {
    title: "Parameter Profile",
    content: `\`\`\`
temperature: 0.3       # Consistent, reliable feedback
top_k: 30              # Moderate vocabulary
top_p: 0.85            # Balanced sampling
num_ctx: 8192          # Handle large diffs
repeat_penalty: 1.1    # Avoid repetitive feedback patterns
\`\`\`

**Context Priority**: soul → role → files → task → memory → history
Standard — review needs the code first, memory for pattern context.`
  },
  architect: {
    title: "Parameter Profile",
    content: `\`\`\`
temperature: 0.6       # Creative exploration of options
top_k: 50              # Wide vocabulary for design
top_p: 0.9             # Varied approaches
num_ctx: 16384         # Handle complex system descriptions
repeat_penalty: 1.0    # Allow pattern description
\`\`\`

**Context Priority**: soul → role → memory → files → task → history
Memory is elevated — prior design decisions inform new ones.`
  },
  tester: {
    title: "Parameter Profile",
    content: `\`\`\`
temperature: 0.2       # Deterministic test generation
top_k: 20              # Precise assertions
top_p: 0.8             # Conservative
num_ctx: 8192          # Handle test + source
repeat_penalty: 1.2    # Vary test cases, avoid copy-paste tests
\`\`\`

**Context Priority**: soul → role → files → task → history → memory
Standard — tests derive from code, not memory.`
  },
  orchestrator: {
    title: "Parameter Profile",
    content: `\`\`\`
temperature: 0.4       # Balanced coordination
top_k: 40              # Moderate vocabulary
top_p: 0.85            # Balanced sampling
num_ctx: 16384         # Handle complex multi-agent context
repeat_penalty: 1.0    # Allow natural coordination patterns
\`\`\`

**Context Priority**: soul → role → task → memory → history → files
Memory elevated — orchestrator needs project history for routing decisions.`
  }
};

// ── Soul summaries & temperatures (manual — curated UI-facing metadata) ──

interface AgentMeta {
  soulSummary: string;
  temperature: number;
}

const agentMeta: Record<string, AgentMeta> = {
  coder: {
    soulSummary: "Senior engineer who ships clean, tested code. Calm under pressure, precise with types, allergic to TODOs.",
    temperature: 0.2,
  },
  researcher: {
    soulSummary: "Analyst who finds signal in noise. Skeptical, cites everything, distinguishes fact from opinion.",
    temperature: 0.5,
  },
  reviewer: {
    soulSummary: "Constructive critic who makes code better. Direct but kind, always provides fixes alongside findings.",
    temperature: 0.3,
  },
  architect: {
    soulSummary: "Principal engineer who thinks in systems. Tradeoffs, assumptions, incremental plans. Every design is a bet — make the odds visible.",
    temperature: 0.6,
  },
  tester: {
    soulSummary: "QA engineer who breaks things so users don't have to. Paranoid, systematic, proud of zero flaky tests.",
    temperature: 0.2,
  },
  orchestrator: {
    soulSummary: "Senior technical coordinator. Calm, decisive. Coordinates quality and momentum across the entire workflow.",
    temperature: 0.4,
  },
};

// ── Assembled docs (manifest-backed RISEN + manual metadata) ──

function buildAgentDocs(): Record<string, AgentDocumentation> {
  const result: Record<string, AgentDocumentation> = {};

  for (const [agentId, meta] of Object.entries(agentMeta)) {
    const manifestEntry = AGENT_DOCS_MANIFEST[agentId];

    // RISEN prompt: build-imported from canonical markdown, or graceful fallback
    const risenPrompt: AgentDocSection = manifestEntry
      ? { title: `${manifestEntry.label} — RISEN Prompt`, content: manifestEntry.content }
      : { title: `${agentId} — RISEN Prompt`, content: 'Source document unavailable.' };

    result[agentId] = {
      soulSummary: meta.soulSummary,
      temperature: meta.temperature,
      risenPrompt,
      parameterProfile: parameterProfiles[agentId],
      sharedDocs: sharedDocSections,
    };
  }

  return result;
}

const agentDocs = buildAgentDocs();

export function getAgentDocs(agentId: string): AgentDocumentation | null {
  return agentDocs[agentId] || null;
}
