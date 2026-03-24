import { useEffect, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { getAgentDocs } from "@/data/agentDocs";
import { Search, CircleSlash, Loader2, PlusCircle, Thermometer, Network, FileCode2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentType } from "@/types/agent";
import { useAgents } from "@/hooks/useAgents";
import { ThemeToggle } from "@/components/ThemeToggle";

const ROLE_ACCENTS: Record<string, string> = {
  Orchestrator: "border-l-brandPurple",
  Coder: "border-l-brandBlue",
  Researcher: "border-l-warning",
  Reviewer: "border-l-success",
  Architect: "border-l-brandPink",
  Tester: "border-l-destructive",
};

const ROLE_DOT: Record<string, string> = {
  Orchestrator: "bg-brandPurple",
  Coder: "bg-brandBlue",
  Researcher: "bg-warning",
  Reviewer: "bg-success",
  Architect: "bg-brandPink",
  Tester: "bg-destructive",
};

const AgentsDashboard = () => {
  const [searchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState("");
  const filter = searchParams.get("filter") || "all-agents";
  const navigate = useNavigate();

  const { agents: initialAgents, isLoading, error } = useAgents(filter);
  const [filteredAgents, setFilteredAgents] = useState<AgentType[]>([]);

  const [sortBy, setSortBy] = useState<string>("recent");
  const [filterRole, setFilterRole] = useState<string>("all");

  useEffect(() => {
    if (initialAgents) {
      let sorted = [...initialAgents].sort((a, b) => {
        switch (sortBy) {
          case "name":
            return a.name.localeCompare(b.name);
          case "temp":
            return (b.temperature ?? 0) - (a.temperature ?? 0);
          case "recent":
          default:
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
      });

      const filtered = sorted.filter(agent => {
        const searchMatch =
          agent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          agent.role?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          agent.soulSummary?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          agent.purpose?.toLowerCase().includes(searchTerm.toLowerCase());

        const roleMatches = filterRole === "all" ||
          (filterRole === "orchestrator" && agent.type === "Orchestrator") ||
          (filterRole === "sub-agent" && agent.type === "Sub-Agent");

        return searchMatch && roleMatches;
      });

      setFilteredAgents(filtered);
    }
  }, [initialAgents, searchTerm, sortBy, filterRole]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] space-y-4">
        <CircleSlash className="h-16 w-16 text-destructive opacity-80" />
        <h2 className="text-2xl font-semibold text-fg">Error Loading Agents</h2>
        <p className="text-fgMuted">Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-fg tracking-tight">
            Agent System
          </h1>
          <p className="text-fgMuted mt-1 text-sm">
            Six specialized agents. One coordination layer. Doc-driven architecture.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <Separator />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fgMuted" />
          <Input
            placeholder="Search by name, role, or purpose…"
            className="pl-10 w-full bg-bg border-border"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-[150px] bg-bg border-border">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="orchestrator">Orchestrator</SelectItem>
              <SelectItem value="sub-agent">Sub-Agents</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[130px] bg-bg border-border">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Recent</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="temp">Temperature</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-8 w-8 text-brandPurple animate-spin" />
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <Search className="h-12 w-12 text-fgMuted opacity-60" />
          <p className="text-fgMuted">No agents match your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {/* Create card */}
          <Link to="/agents/create" className="block">
            <Card className="h-full border-dashed border-2 border-border hover:border-brandPurple/50 transition-colors bg-transparent hover:bg-bgMuted/40">
              <div className="flex flex-col items-center justify-center h-full py-12">
                <div className="h-11 w-11 rounded-full bg-brandPurple/10 flex items-center justify-center mb-3">
                  <PlusCircle className="h-5 w-5 text-brandPurple" />
                </div>
                <p className="text-sm font-medium text-fg">New Agent</p>
                <p className="text-xs text-fgMuted mt-1">Define a new specialist</p>
              </div>
            </Card>
          </Link>

          {/* Agent cards */}
          {filteredAgents.map((agent) => {
            const docs = getAgentDocs(agent.id);
            const soul = agent.soulSummary || docs?.soulSummary || "";
            const accent = ROLE_ACCENTS[agent.role || ""] || "border-l-border";
            const dot = ROLE_DOT[agent.role || ""] || "bg-fgMuted";
            const isOrch = agent.type === "Orchestrator";

            return (
              <Link to={`/agents/${agent.id}`} key={agent.id} className="block group">
                <Card
                  className={`h-full border-l-[3px] ${accent} transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${
                    isOrch ? "bg-brandPurple/[0.03] dark:bg-brandPurple/[0.06]" : ""
                  }`}
                >
                  <CardContent className="p-5 flex flex-col h-full">
                    {/* Top: Avatar + Name */}
                    <div className="flex items-start gap-3.5 mb-3">
                      <Avatar className={`h-11 w-11 rounded-lg border ${isOrch ? "border-brandPurple/40" : "border-border"} shrink-0`}>
                        <AvatarImage src={agent.avatar} alt={agent.name} className="object-cover" />
                        <AvatarFallback className="rounded-lg bg-bgMuted text-fgMuted text-xs">
                          {agent.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-semibold text-fg truncate">
                            {agent.name}
                          </h3>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 shrink-0 ${
                              isOrch ? "border-brandPurple/40 text-brandPurple" : "border-border text-fgMuted"
                            }`}
                          >
                            {isOrch ? "Orchestrator" : agent.role || "Agent"}
                          </Badge>
                        </div>
                        <p className="text-xs text-fgMuted mt-0.5 line-clamp-2 leading-relaxed">
                          {soul}
                        </p>
                      </div>
                    </div>

                    {/* Purpose */}
                    <p className="text-sm text-fgMuted/80 line-clamp-2 mb-4 leading-relaxed flex-1">
                      {agent.purpose || agent.description}
                    </p>

                    {/* Traits */}
                    {agent.traits && agent.traits.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-4">
                        {agent.traits.slice(0, 3).map((trait) => (
                          <span
                            key={trait}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-bgMuted text-fgMuted border border-border/50"
                          >
                            {trait}
                          </span>
                        ))}
                        {agent.traits.length > 3 && (
                          <span className="text-[10px] px-2 py-0.5 text-fgMuted">
                            +{agent.traits.length - 3}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Footer meta */}
                    <div className="flex items-center justify-between pt-3 border-t border-border/50">
                      <div className="flex items-center gap-3 text-[11px] text-fgMuted">
                        {agent.temperature !== undefined && (
                          <span className="flex items-center gap-1">
                            <Thermometer className="h-3 w-3" />
                            {agent.temperature}
                          </span>
                        )}
                        {agent.sourceDoc && (
                          <span className="flex items-center gap-1 truncate">
                            <FileCode2 className="h-3 w-3" />
                            {agent.sourceDoc.split("/").pop()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                        <span className="text-[11px] text-fgMuted">
                          {agent.status === "active" ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AgentsDashboard;
