import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Link } from "react-router-dom";
import { AGENT_SOURCE_MAP, SHARED_DOC_FILES, AgentSourceEntry } from "@/lib/agentSourceMap";
import { getAgentDocs } from "@/data/agentDocs";
import { getSharedDocRaw, getAgentDocRaw } from "@/data/docManifest";
import { FileCode2, ExternalLink, Info, FileWarning } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";

/**
 * Source trust tag.
 * - "build-imported": raw markdown loaded via Vite ?raw at build time (highest trust)
 * - "mirrored": manually copied into TS objects (legacy, lower trust)
 * - "derived": computed or summarized metadata
 */
function SourceTag({ type }: { type: "build-imported" | "mirrored" | "derived" }) {
  const labels: Record<string, string> = {
    "build-imported": "Build-imported from source",
    "mirrored": "Mirrored from source",
    "derived": "Derived metadata",
  };
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-border bg-bgMuted text-fgMuted">
      <Info className="h-2.5 w-2.5" />
      {labels[type]}
    </span>
  );
}

function UnavailableState({ docFile }: { docFile?: string }) {
  return (
    <div className="py-16 text-center text-fgMuted text-sm">
      <FileWarning className="h-8 w-8 mx-auto mb-3 text-fgMuted/50" />
      <p className="font-medium text-fg">Document unavailable</p>
      <p className="mt-1 text-xs max-w-sm mx-auto">
        {docFile ? (
          <>This document is expected at <code className="text-xs bg-bgMuted px-1.5 py-0.5 rounded border border-border">{docFile}</code> but its content could not be loaded.</>
        ) : (
          <>The selected document could not be resolved. It may have been removed or renamed.</>
        )}
      </p>
      <SourceTag type="derived" />
    </div>
  );
}

function SharedDocView({ label }: { label: string }) {
  const docEntry = SHARED_DOC_FILES.find((d) => d.label === label);
  // Use build-imported raw content (preferred) with no manual mirror fallback needed
  const rawEntry = getSharedDocRaw(label);

  if (!docEntry) {
    return <UnavailableState />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-fg tracking-tight">{label}</h2>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="flex items-center gap-1 text-xs text-fgMuted">
            <FileCode2 className="h-3 w-3" />
            {docEntry.file}
          </span>
          <SourceTag type={rawEntry ? "build-imported" : "derived"} />
        </div>
      </div>

      <p className="text-sm text-fgMuted">
        This shared document is referenced by all agents in the system. It defines cross-cutting concerns that apply to every agent persona.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {AGENT_SOURCE_MAP.map((entry) => (
          <Badge key={entry.agentId} variant="outline" className="text-[10px]">
            {entry.displayName}
          </Badge>
        ))}
      </div>

      <Separator />

      {rawEntry ? (
        <div>
          <MarkdownRenderer content={rawEntry.content} />
        </div>
      ) : (
        <UnavailableState docFile={docEntry.file} />
      )}
    </div>
  );
}

function AgentDocView({ entry }: { entry: AgentSourceEntry }) {
  const docs = getAgentDocs(entry.agentId);
  // Build-imported raw markdown — the full source file content
  const rawEntry = getAgentDocRaw(entry.agentId);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-fg tracking-tight">{entry.displayName}</h2>
          <Badge
            variant="outline"
            className={`text-[10px] ${entry.role === "Orchestrator" ? "border-brandPurple/40 text-brandPurple" : "border-border text-fgMuted"}`}
          >
            {entry.role}
          </Badge>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="flex items-center gap-1 text-xs text-fgMuted">
            <FileCode2 className="h-3 w-3" />
            {entry.docFile}
          </span>
          <SourceTag type={rawEntry ? "build-imported" : docs ? "mirrored" : "derived"} />
        </div>
      </div>

      {/* Source mapping */}
      <div className="bg-bgMuted/50 border border-border rounded-lg px-4 py-3">
        <p className="text-xs font-medium text-fgMuted uppercase tracking-wider mb-1">Source Mapping</p>
        <p className="text-sm text-fg">
          <code className="text-xs bg-bg px-1.5 py-0.5 rounded border border-border">{entry.docFile.split("/").pop()}</code>
          {" → "}
          <span className="font-semibold">{entry.displayName}</span>
        </p>
      </div>

      {/* Derived metadata from agentDocs (soul summary, temperature) */}
      {docs && (
        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-semibold text-fgMuted uppercase tracking-wider mb-1">Soul Summary</h3>
            <SourceTag type="derived" />
            <p className="text-sm text-fg mt-2 italic leading-relaxed">{docs.soulSummary}</p>
          </div>
          {docs.temperature !== undefined && (
            <div>
              <h3 className="text-xs font-semibold text-fgMuted uppercase tracking-wider mb-1">Temperature</h3>
              <p className="text-sm text-fg font-mono">{docs.temperature}</p>
            </div>
          )}
        </div>
      )}

      <Separator />

      {/* Full source document — build-imported raw markdown */}
      {rawEntry ? (
        <div>
          <h3 className="text-xs font-semibold text-fgMuted uppercase tracking-wider mb-3">Full Source Document</h3>
          <SourceTag type="build-imported" />
          <div className="mt-3">
            <MarkdownRenderer content={rawEntry.content} />
          </div>
        </div>
      ) : docs ? (
        /* Fallback to legacy mirrored RISEN prompt if raw import unavailable */
        <div>
          <h3 className="text-xs font-semibold text-fgMuted uppercase tracking-wider mb-3">RISEN Prompt</h3>
          <SourceTag type="mirrored" />
          <div className="mt-3">
            <MarkdownRenderer content={docs.risenPrompt.content} />
          </div>
        </div>
      ) : (
        <UnavailableState docFile={entry.docFile} />
      )}

      {/* Parameter Profile (derived from agentDocs) */}
      {docs?.parameterProfile && (
        <>
          <Separator />
          <div>
            <h3 className="text-xs font-semibold text-fgMuted uppercase tracking-wider mb-3">Parameter Profile</h3>
            <SourceTag type="derived" />
            <div className="mt-3">
              <MarkdownRenderer content={docs.parameterProfile.content} />
            </div>
          </div>
        </>
      )}

      <Separator />

      {/* Link to agent detail */}
      <Link
        to={`/agents/${entry.agentId}`}
        className="inline-flex items-center gap-1.5 text-sm text-brandPurple hover:underline"
      >
        View agent detail page
        <ExternalLink className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

interface DocContentPanelProps {
  activeId: string | null;
}

export function DocContentPanel({ activeId }: DocContentPanelProps) {
  if (!activeId) {
    return (
      <div className="flex items-center justify-center h-full text-fgMuted text-sm py-20">
        <div className="text-center space-y-2">
          <p className="font-medium text-fg">Select a document</p>
          <p className="text-xs max-w-xs">
            Browse shared system documents or agent-specific source files from the sidebar.
          </p>
        </div>
      </div>
    );
  }

  if (activeId.startsWith("shared:")) {
    const label = activeId.replace("shared:", "");
    return <SharedDocView label={label} />;
  }

  if (activeId.startsWith("agent:")) {
    const agentId = activeId.replace("agent:", "");
    const entry = AGENT_SOURCE_MAP.find((e) => e.agentId === agentId);
    if (!entry) {
      return <UnavailableState />;
    }
    return <AgentDocView entry={entry} />;
  }

  return <UnavailableState />;
}
