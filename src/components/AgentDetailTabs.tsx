import { AgentType } from "@/types/agent";
import { getAgentDocs } from "@/data/agentDocs";
import { getSourceEntry, SHARED_DOC_FILES } from "@/lib/agentSourceMap";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AgentDocumentationTab } from "@/components/AgentDocumentation";
import {
  Brain, FileText, Zap, Shield, FolderOpen, Thermometer,
  Network, ArrowDownToLine, Route, ShieldAlert, Workflow
} from "lucide-react";

interface AgentDetailTabsProps {
  agent: AgentType;
}

function OrchestratorBanner() {
  const capabilities = [
    { icon: <ArrowDownToLine className="h-4 w-4" />, label: "Context Initialization", desc: "Loads soul → role → task before acting" },
    { icon: <Route className="h-4 w-4" />, label: "Action Routing", desc: "Routes tasks to the best-fit sub-agent" },
    { icon: <ShieldAlert className="h-4 w-4" />, label: "Graceful Fallback", desc: "Solo Mode when agents are unavailable" },
    { icon: <Workflow className="h-4 w-4" />, label: "Pipeline Governance", desc: "Manages architect → coder → tester → reviewer" },
  ];

  return (
    <Card className="border-brandPurple/30 bg-gradient-to-br from-brandPurple/[0.04] to-transparent">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-2 mb-3">
          <Network className="h-5 w-5 text-brandPurple" />
          <h3 className="font-semibold text-fg">Coordination Layer</h3>
          <Badge variant="outline" className="text-[10px] border-brandPurple/40 text-brandPurple">
            Orchestrator
          </Badge>
        </div>
        <p className="text-sm text-fgMuted mb-4">
          This agent is the central coordination layer of the multi-agent system. It does not write code, research, or review directly — it decomposes tasks, delegates to specialists, manages context flow between them, and makes the final quality call.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {capabilities.map((cap) => (
            <div key={cap.label} className="flex items-start gap-2.5 p-2.5 rounded-md bg-bgMuted/60 border border-border/50">
              <span className="text-brandPurple mt-0.5">{cap.icon}</span>
              <div>
                <p className="text-xs font-medium text-fg">{cap.label}</p>
                <p className="text-xs text-fgMuted">{cap.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function AgentDetailTabs({ agent }: AgentDetailTabsProps) {
  const docs = getAgentDocs(agent.id);
  const source = getSourceEntry(agent.id);
  const isOrchestrator = agent.type === "Orchestrator";

  return (
    <Tabs defaultValue="identity" className="mt-8">
      <TabsList className="grid w-full grid-cols-5">
        <TabsTrigger value="identity" className="text-xs sm:text-sm">
          <span className="flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Identity</span>
          </span>
        </TabsTrigger>
        <TabsTrigger value="prompt" className="text-xs sm:text-sm">
          <span className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Prompt</span>
          </span>
        </TabsTrigger>
        <TabsTrigger value="behavior" className="text-xs sm:text-sm">
          <span className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Behavior</span>
          </span>
        </TabsTrigger>
        <TabsTrigger value="policies" className="text-xs sm:text-sm">
          <span className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Policies</span>
          </span>
        </TabsTrigger>
        <TabsTrigger value="source" className="text-xs sm:text-sm">
          <span className="flex items-center gap-1.5">
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Source</span>
          </span>
        </TabsTrigger>
      </TabsList>

      <div className="mt-6 space-y-6">
        {/* ── Identity Tab ── */}
        <TabsContent value="identity" className="space-y-4">
          {isOrchestrator && <OrchestratorBanner />}

          <Card>
            <CardContent className="pt-5 space-y-5">
              {/* Soul Summary */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="h-4 w-4 text-brandPurple" />
                  <h4 className="text-sm font-semibold text-fg">Soul Summary</h4>
                </div>
                <p className="text-sm text-fgMuted italic">
                  {agent.soulSummary || docs?.soulSummary || "No soul summary available."}
                </p>
              </div>

              <Separator />

              {/* Purpose */}
              <div>
                <h4 className="text-sm font-semibold text-fg mb-1.5">Purpose</h4>
                <p className="text-sm text-fgMuted">
                  {agent.purpose || "No purpose defined."}
                </p>
              </div>

              <Separator />

              {/* Traits */}
              <div>
                <h4 className="text-sm font-semibold text-fg mb-2">Core Traits</h4>
                {agent.traits && agent.traits.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {agent.traits.map((trait) => (
                      <Badge key={trait} variant="secondary" className="text-xs">
                        {trait}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-fgMuted">No traits defined.</p>
                )}
              </div>

              <Separator />

              {/* Temperature & Role */}
              <div className="flex flex-wrap gap-6">
                <div className="flex items-center gap-2">
                  <Thermometer className="h-4 w-4 text-fgMuted" />
                  <span className="text-sm text-fgMuted">
                    Temperature: <span className="font-medium text-fg">{agent.temperature ?? docs?.temperature ?? "—"}</span>
                  </span>
                </div>
                <div>
                  <span className="text-sm text-fgMuted">
                    Role: <span className="font-medium text-fg">{agent.role || agent.type}</span>
                  </span>
                </div>
                <div>
                  <span className="text-sm text-fgMuted">
                    Model: <span className="font-medium text-fg">{agent.model || "—"}</span>
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Prompt Tab ── */}
        <TabsContent value="prompt" className="space-y-4">
          {docs ? (
            <AgentDocumentationTab docs={docs} agentName={agent.name} />
          ) : (
            <Card>
              <CardContent className="pt-5">
                <p className="text-sm text-fgMuted">No RISEN prompt documentation available for this agent.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Behavior Tab ── */}
        <TabsContent value="behavior" className="space-y-4">
          <Card>
            <CardContent className="pt-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-4 w-4 text-brandPurple" />
                <h4 className="text-sm font-semibold text-fg">Behavior Notes</h4>
              </div>
              <p className="text-xs text-fgMuted mb-3">
                Derived from the agent's RISEN prompt and architectural role.
              </p>
              {agent.behaviorNotes && agent.behaviorNotes.length > 0 ? (
                <ul className="space-y-2.5">
                  {agent.behaviorNotes.map((note, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-brandPurple mt-2 shrink-0" />
                      <span className="text-fgMuted">{note}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fgMuted">No behavior notes available.</p>
              )}
            </CardContent>
          </Card>

          {/* Parameter profile from docs */}
          {docs?.parameterProfile && (
            <Card>
              <CardContent className="pt-5">
                <h4 className="text-sm font-semibold text-fg mb-3">Parameter Profile</h4>
                <pre className="bg-bgMuted rounded-md p-3 text-sm font-mono text-fg border border-border overflow-x-auto">
                  {docs.parameterProfile.content}
                </pre>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Shared Policies Tab ── */}
        <TabsContent value="policies" className="space-y-4">
          {docs?.sharedDocs && docs.sharedDocs.length > 0 ? (
            docs.sharedDocs.map((doc, i) => (
              <Card key={i}>
                <CardContent className="pt-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="h-4 w-4 text-brandPurple" />
                    <h4 className="text-sm font-semibold text-fg">{doc.title}</h4>
                  </div>
                  <div className="max-h-[400px] overflow-y-auto">
                    <pre className="text-sm text-fgMuted whitespace-pre-wrap font-sans leading-relaxed">
                      {doc.content.slice(0, 1500)}
                      {doc.content.length > 1500 && "\n\n… (truncated — see full doc in source)"}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="pt-5">
                <p className="text-sm text-fgMuted">No shared policy documents linked to this agent.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Source Docs Tab ── */}
        <TabsContent value="source" className="space-y-4">
          <Card>
            <CardContent className="pt-5 space-y-4">
              <h4 className="text-sm font-semibold text-fg mb-2">Canonical Source</h4>

              {source ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 rounded-md bg-bgMuted border border-border">
                    <FileText className="h-4 w-4 text-brandPurple shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-fg">{source.docFile}</p>
                      <p className="text-xs text-fgMuted">
                        Maps to: <span className="font-medium">{source.displayName}</span> ({source.role})
                      </p>
                    </div>
                  </div>

                  {agent.sharedDocs && agent.sharedDocs.length > 0 && (
                    <>
                      <h4 className="text-sm font-semibold text-fg mt-4">Shared Documents</h4>
                      <div className="space-y-2">
                        {agent.sharedDocs.map((doc) => {
                          const shared = SHARED_DOC_FILES.find(s => s.file.includes(doc));
                          return (
                            <div key={doc} className="flex items-center gap-2 p-2.5 rounded-md bg-bgMuted/60 border border-border/50">
                              <FolderOpen className="h-3.5 w-3.5 text-fgMuted shrink-0" />
                              <span className="text-sm text-fgMuted">{shared?.label || doc}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-fgMuted">No source mapping found for this agent.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </div>
    </Tabs>
  );
}
