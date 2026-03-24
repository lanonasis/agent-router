import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Link } from "react-router-dom";
import { AGENT_SOURCE_MAP, SHARED_DOC_FILES, AgentSourceEntry } from "@/lib/agentSourceMap";
import { getAgentDocs } from "@/data/agentDocs";
import { soulDoc, policiesDoc, identityLayerDoc, toolRegistryDoc, sourceOfTruthDoc } from "@/data/sharedDocs";
import { FileCode2, ExternalLink, Info, FileWarning } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";

/** Maps shared doc labels to their mirrored TS content */
function getSharedDocContent(label: string) {
  switch (label) {
    case "Soul Identity": return soulDoc;
    case "Policies & Safety": return policiesDoc;
    case "Identity Layer": return identityLayerDoc;
    case "Tool Registry": return toolRegistryDoc;
    case "Source of Truth": return sourceOfTruthDoc;
    default: return null;
  }
}

function SourceTag({ type }: { type: "mirrored" | "derived" }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-border bg-bgMuted text-fgMuted">
      <Info className="h-2.5 w-2.5" />
      {type === "mirrored" ? "Mirrored from source" : "Derived metadata"}
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
          <>This document is expected at <code className="text-xs bg-bgMuted px-1.5 py-0.5 rounded border border-border">{docFile}</code> but its content has not been synced into the app data layer.</>
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
  const content = getSharedDocContent(label);

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
          <SourceTag type={content ? "mirrored" : "derived"} />
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

      {content ? (
        <div>
          <h3 className="text-sm font-semibold text-fg mb-3">{content.title}</h3>
          <MarkdownRenderer content={content.content} />
        </div>
      ) : (
        <UnavailableState docFile={docEntry.file} />
      )}
    </div>
  );
}

function AgentDocView({ entry }: { entry: AgentSourceEntry }) {
  const docs = getAgentDocs(entry.agentId);

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
          <SourceTag type={docs ? "mirrored" : "derived"} />
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

      {docs ? (
        <div className="space-y-6">
          {/* Soul Summary */}
          <div>
            <h3 className="text-xs font-semibold text-fgMuted uppercase tracking-wider mb-1">Soul Summary</h3>
            <SourceTag type="mirrored" />
            <p className="text-sm text-fg mt-2 italic leading-relaxed">{docs.soulSummary}</p>
          </div>

          {/* Temperature */}
          {docs.temperature !== undefined && (
            <div>
              <h3 className="text-xs font-semibold text-fgMuted uppercase tracking-wider mb-1">Temperature</h3>
              <p className="text-sm text-fg font-mono">{docs.temperature}</p>
            </div>
          )}

          <Separator />

          {/* RISEN Prompt */}
          <div>
            <h3 className="text-xs font-semibold text-fgMuted uppercase tracking-wider mb-3">RISEN Prompt</h3>
            <SourceTag type="mirrored" />
            <div className="mt-3">
              <MarkdownRenderer content={docs.risenPrompt.content} />
            </div>
          </div>

          {/* Parameter Profile */}
          {docs.parameterProfile && (
            <>
              <Separator />
              <div>
                <h3 className="text-xs font-semibold text-fgMuted uppercase tracking-wider mb-3">Parameter Profile</h3>
                <SourceTag type="mirrored" />
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
      ) : (
        <UnavailableState docFile={entry.docFile} />
      )}
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

  // Unknown ID format — graceful fallback
  return <UnavailableState />;
}
