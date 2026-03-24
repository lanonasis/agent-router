import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileText, Brain, Shield, Layers, Wrench, Network, BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AGENT_SOURCE_MAP, SHARED_DOC_FILES, AgentSourceEntry } from "@/lib/agentSourceMap";
import { getAgentDocs } from "@/data/agentDocs";
import { ThemeToggle } from "@/components/ThemeToggle";

const SHARED_DOC_ICONS: Record<string, React.ReactNode> = {
  "Soul Identity": <Brain className="h-4 w-4" />,
  "Identity Layer": <Layers className="h-4 w-4" />,
  "Policies & Safety": <Shield className="h-4 w-4" />,
  "Tool Registry": <Wrench className="h-4 w-4" />,
  "Source of Truth": <BookOpen className="h-4 w-4" />,
};

const ROLE_COLORS: Record<string, string> = {
  Orchestrator: "text-brandPurple border-brandPurple/40",
  Coder: "text-brandBlue border-brandBlue/40",
  Researcher: "text-warning border-warning/40",
  Reviewer: "text-success border-success/40",
  Architect: "text-brandPink border-brandPink/40",
  Tester: "text-destructive border-destructive/40",
};

function AgentDocCard({ entry }: { entry: AgentSourceEntry }) {
  const [expanded, setExpanded] = useState(false);
  const docs = getAgentDocs(entry.agentId);
  const colors = ROLE_COLORS[entry.displayName] || "text-fgMuted border-border";

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <CardContent className="py-4 flex items-center gap-3">
          <Network className={`h-4 w-4 shrink-0 ${colors.split(" ")[0]}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-fg">{entry.displayName}</span>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${colors}`}>
                {entry.role}
              </Badge>
            </div>
            <p className="text-xs text-fgMuted mt-0.5 truncate">
              {entry.docFile}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to={`/agents/${entry.agentId}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-brandPurple hover:underline"
            >
              View agent →
            </Link>
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-fgMuted" />
            ) : (
              <ChevronRight className="h-4 w-4 text-fgMuted" />
            )}
          </div>
        </CardContent>
      </button>

      {expanded && docs && (
        <div className="border-t border-border px-5 py-4 bg-bgMuted/30">
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-fgMuted uppercase tracking-wider mb-1">Soul Summary</p>
              <p className="text-sm text-fg italic">{docs.soulSummary}</p>
            </div>
            {docs.temperature !== undefined && (
              <p className="text-xs text-fgMuted">
                Temperature: <span className="font-medium text-fg">{docs.temperature}</span>
              </p>
            )}
            <div>
              <p className="text-xs font-medium text-fgMuted uppercase tracking-wider mb-1">RISEN Prompt</p>
              <ScrollArea className="max-h-[200px]">
                <pre className="text-xs text-fgMuted whitespace-pre-wrap font-sans leading-relaxed">
                  {docs.risenPrompt.content.slice(0, 800)}
                  {docs.risenPrompt.content.length > 800 && "\n\n… (see full prompt on agent detail page)"}
                </pre>
              </ScrollArea>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function SharedDocCard({ label, file }: { label: string; file: string }) {
  const [expanded, setExpanded] = useState(false);
  const icon = SHARED_DOC_ICONS[label] || <FileText className="h-4 w-4" />;

  // We don't have raw file content in the browser, so show metadata
  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <CardContent className="py-4 flex items-center gap-3">
          <span className="text-brandPurple shrink-0">{icon}</span>
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-sm text-fg">{label}</span>
            <p className="text-xs text-fgMuted mt-0.5">{file}</p>
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-fgMuted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-fgMuted" />
          )}
        </CardContent>
      </button>

      {expanded && (
        <div className="border-t border-border px-5 py-4 bg-bgMuted/30">
          <p className="text-xs text-fgMuted">
            This shared document is referenced by all agents in the system. It defines cross-cutting concerns that apply to every agent persona.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {AGENT_SOURCE_MAP.map((entry) => (
              <Badge key={entry.agentId} variant="outline" className="text-[10px]">
                {entry.displayName}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

const DocsBrowser = () => {
  const orchestrator = AGENT_SOURCE_MAP.find((e) => e.role === "Orchestrator");
  const subAgents = AGENT_SOURCE_MAP.filter((e) => e.role === "Sub-Agent");

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <Link to="/agents" className="inline-flex items-center text-fgMuted hover:text-fg transition-colors text-sm mb-4">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Agent System
          </Link>
          <h1 className="text-3xl font-bold text-fg tracking-tight">Documentation</h1>
          <p className="text-fgMuted mt-1 text-sm">
            Canonical source files powering the agent architecture.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <Separator />

      {/* Shared Docs */}
      <section>
        <h2 className="text-lg font-semibold text-fg mb-1">Shared Documents</h2>
        <p className="text-sm text-fgMuted mb-4">
          Cross-cutting definitions inherited by every agent.
        </p>
        <div className="space-y-2">
          {SHARED_DOC_FILES.map((doc) => (
            <SharedDocCard key={doc.file} label={doc.label} file={doc.file} />
          ))}
        </div>
      </section>

      <Separator />

      {/* Orchestrator */}
      {orchestrator && (
        <section>
          <h2 className="text-lg font-semibold text-fg mb-1">Orchestrator</h2>
          <p className="text-sm text-fgMuted mb-4">
            The coordination layer. Defined in <code className="text-xs bg-bgMuted px-1.5 py-0.5 rounded border border-border">base.md</code>, presented as Orchestrator.
          </p>
          <AgentDocCard entry={orchestrator} />
        </section>
      )}

      <Separator />

      {/* Sub-Agents */}
      <section>
        <h2 className="text-lg font-semibold text-fg mb-1">Sub-Agents</h2>
        <p className="text-sm text-fgMuted mb-4">
          Specialized agents routed by the Orchestrator.
        </p>
        <div className="space-y-2">
          {subAgents.map((entry) => (
            <AgentDocCard key={entry.agentId} entry={entry} />
          ))}
        </div>
      </section>
    </div>
  );
};

export default DocsBrowser;
