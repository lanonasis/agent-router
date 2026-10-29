import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, AlertCircle, Loader2, Trash2, Archive, PenSquare, MoreVertical, Network } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAgentDetails } from "@/hooks/useAgentDetails";
import { AgentToggle } from "@/components/AgentToggle";
import { getAgentDocs } from "@/data/agentDocs";
import { AgentDetailTabs } from "@/components/AgentDetailTabs";

const INVALID_PARAMS = [":agentId", "undefined", "null", ""];

const AgentDetails = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Guard against literal route template params or missing IDs
  const isInvalidParam = !agentId || INVALID_PARAMS.includes(agentId);

  const { agent, isLoading, error } = useAgentDetails(
    isInvalidParam ? undefined : agentId
  );
  const [isActive, setIsActive] = useState(false);

  // Redirect invalid params back to dashboard
  if (isInvalidParam) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <Link to="/agents" className="flex items-center text-fgMuted hover:text-fg transition-colors">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Agents
          </Link>
        </div>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Invalid Agent</AlertTitle>
          <AlertDescription>
            No valid agent ID was provided. Select an agent from the dashboard.
          </AlertDescription>
        </Alert>
        <Button onClick={() => navigate("/agents")} className="mt-4">Return to Dashboard</Button>
      </div>
    );
  }

  // Sync active state when agent loads
  if (agent && isActive !== (agent.status === "active")) {
    setIsActive(agent.status === "active");
  }

  const handleStatusToggle = () => {
    setIsActive(!isActive);
    toast({
      title: !isActive ? "Agent Activated" : "Agent Deactivated",
      description: !isActive ? "Agent is now active." : "Agent has been deactivated.",
      variant: !isActive ? "default" : "destructive",
    });
  };

  const handleDelete = () => {
    toast({ title: "Agent deleted", variant: "destructive" });
    navigate("/agents");
  };

  const handleArchive = () => {
    toast({ title: "Agent archived" });
    navigate("/agents");
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[80vh]">
        <Loader2 className="h-8 w-8 text-brandPurple animate-spin" />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <Link to="/agents" className="flex items-center text-fgMuted hover:text-fg transition-colors">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Agents
          </Link>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error || "Agent not found."}
          </AlertDescription>
        </Alert>
        <Button onClick={() => navigate("/agents")} className="mt-4">Return to Dashboard</Button>
      </div>
    );
  }

  const docs = getAgentDocs(agent.id);
  const soul = agent.soulSummary || docs?.soulSummary || agent.description;
  const isOrch = agent.type === "Orchestrator";

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      {/* Back nav */}
      <div className="mb-6">
        <Link to="/agents" className="inline-flex items-center text-fgMuted hover:text-fg transition-colors text-sm">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Agent System
        </Link>
      </div>

      {/* Header card */}
      <Card className={`mb-8 ${isOrch ? "border-brandPurple/20" : ""}`}>
        <CardHeader className="pb-0">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <div className="flex items-start gap-4 flex-1 min-w-0">
              {/* Avatar */}
              <Avatar className={`h-12 w-12 sm:h-14 sm:w-14 rounded-lg border-2 shrink-0 ${isOrch ? "border-brandPurple/40" : "border-border"}`}>
                <AvatarImage src={agent.avatar} alt={agent.name} className="object-cover" />
                <AvatarFallback className="rounded-lg bg-bgMuted text-fg font-semibold">
                  {agent.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              {/* Identity */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-bold text-fg">{agent.name}</h1>
                  <Badge
                    variant="outline"
                    className={`text-[11px] ${
                      isOrch
                        ? "border-brandPurple/40 text-brandPurple bg-brandPurple/5"
                        : "border-border text-fgMuted"
                    }`}
                  >
                    {isOrch && <Network className="h-3 w-3 mr-1" />}
                    {isOrch ? "Orchestrator" : agent.role || agent.type}
                  </Badge>
                  {isActive ? (
                    <span className="flex items-center gap-1.5 text-[11px] text-success">
                      <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-light" />
                      Active
                    </span>
                  ) : (
                    <span className="text-[11px] text-fgMuted">Inactive</span>
                  )}
                </div>
                <p className="text-sm text-fgMuted mt-1.5 max-w-2xl leading-relaxed italic line-clamp-3 sm:line-clamp-none">
                  {soul}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0 self-start">
              <AgentToggle isActive={isActive} onToggle={handleStatusToggle} />
              <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
                <Link to={`/playground?agent=${agentId}`}>
                  <FlaskConical className="h-4 w-4" /> Test in playground
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9">
                    <MoreVertical className="h-4 w-4 text-fgMuted" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-bg">
                  <DropdownMenuItem onClick={() => toast({ title: "Edit mode" })} className="gap-2">
                    <PenSquare className="h-4 w-4 text-fgMuted" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleArchive} className="gap-2">
                    <Archive className="h-4 w-4 text-fgMuted" /> Archive
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDelete} className="gap-2 text-destructive">
                    <Trash2 className="h-4 w-4" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-4 pb-5">
          {/* Compact meta row */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-fgMuted">
            {agent.temperature !== undefined && (
              <span>Temperature: <span className="font-medium text-fg">{agent.temperature}</span></span>
            )}
            <span>Model: <span className="font-medium text-fg">{agent.model || "—"}</span></span>
            {agent.sourceDoc && (
              <span>Source: <span className="font-medium text-fg">{agent.sourceDoc.split("/").pop()}</span></span>
            )}
            <span>Since: <span className="font-medium text-fg">{agent.createdAt}</span></span>
          </div>
        </CardContent>
      </Card>

      {/* Structured tabs */}
      <AgentDetailTabs agent={agent} />
    </div>
  );
};

export default AgentDetails;
