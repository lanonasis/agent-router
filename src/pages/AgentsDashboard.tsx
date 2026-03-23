import { useEffect, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { getAgentDocs } from "@/data/agentDocs";
import { Bot, Search, CircleSlash, Loader2, UserCircle2, MoreVertical, Power, Edit, Eye, Archive, AlertCircle, Calendar, PlusCircle, Thermometer } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { AgentType, AgentStatus } from "@/types/agent";
import { useAgents } from "@/hooks/useAgents";
import { AgentToggle } from "@/components/AgentToggle";
import { ThemeToggle } from "@/components/ThemeToggle";

const AgentsDashboard = () => {
  const [searchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState("");
  const filter = searchParams.get("filter") || "all-agents";
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [agentToDeactivate, setAgentToDeactivate] = useState<string | null>(null);
  const [skipConfirmation, setSkipConfirmation] = useState(() => {
    const saved = localStorage.getItem("skipAgentDeactivationConfirmation");
    return saved === "true";
  });
  
  const { agents: initialAgents, isLoading, error } = useAgents(filter);
  const [filteredAgents, setFilteredAgents] = useState<AgentType[]>([]);
  
  const [sortBy, setSortBy] = useState<string>("recent");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  useEffect(() => {
    if (initialAgents) {
      let sorted = [...initialAgents].sort((a, b) => {
        switch (sortBy) {
          case "oldest":
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          case "most-used":
            return (b.interactions || 0) - (a.interactions || 0);
          case "less-used":
            return (a.interactions || 0) - (b.interactions || 0);
          case "recent":
          default:
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
      });

      const filtered = sorted.filter(agent => {
        const nameMatch = agent.name.toLowerCase().includes(searchTerm.toLowerCase());
        const purposeMatch = agent.purpose?.toLowerCase().includes(searchTerm.toLowerCase()) || false;
        const descMatch = agent.description.toLowerCase().includes(searchTerm.toLowerCase());
        const searchMatches = nameMatch || purposeMatch || descMatch;

        const roleMatches = filterRole === "all" || agent.type === filterRole;
        const statusMatches = filterStatus === "all" || agent.status === filterStatus;

        return searchMatches && roleMatches && statusMatches;
      });

      setFilteredAgents(filtered);
    }
  }, [initialAgents, searchTerm, sortBy, filterRole, filterStatus]);

  const getFilterTitle = () => {
    switch (filter) {
      case "my-agents":
        return "Your Agents";
      case "team-agents":
        return "Team Agents";
      default:
        return "Agent System";
    }
  };

  const executeToggleStatus = (agentId: string, currentStatus: AgentStatus) => {
    const newStatus: AgentStatus = currentStatus === "active" ? "inactive" : "active";
    
    setFilteredAgents(prevAgents => 
      prevAgents.map(agent => 
        agent.id === agentId ? { ...agent, status: newStatus } : agent
      )
    );
    
    toast({
      title: `Agent ${newStatus === "active" ? "Activated" : "Deactivated"}`,
      description: `The agent is now ${newStatus}.`,
    });
  };

  const handleToggleStatus = (e: React.MouseEvent, agentId: string, currentStatus: AgentStatus) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (currentStatus === "inactive" || skipConfirmation) {
      executeToggleStatus(agentId, currentStatus);
      return;
    }
    
    setAgentToDeactivate(agentId);
    setConfirmDialogOpen(true);
  };
  
  const handleSkipConfirmationChange = (checked: boolean) => {
    setSkipConfirmation(checked);
    localStorage.setItem("skipAgentDeactivationConfirmation", checked.toString());
  };
  
  const handleConfirmDeactivation = () => {
    if (agentToDeactivate) {
      const agent = filteredAgents.find(a => a.id === agentToDeactivate);
      if (agent) {
        executeToggleStatus(agentToDeactivate, agent.status);
      }
    }
    setConfirmDialogOpen(false);
    setAgentToDeactivate(null);
  };

  const handleCancelDeactivation = () => {
    setConfirmDialogOpen(false);
    setAgentToDeactivate(null);
  };

  const handleEditAgent = (e: React.MouseEvent, agentId: string) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/agents/${agentId}?tab=settings`);
  };

  const handleViewDetails = (e: React.MouseEvent, agentId: string) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/agents/${agentId}`);
  };

  const handleArchiveAgent = (e: React.MouseEvent, agentId: string) => {
    e.preventDefault();
    e.stopPropagation();
    toast({
      title: "Archive Agent",
      description: "The agent has been archived.",
      variant: "destructive",
    });
    setFilteredAgents(prevAgents => prevAgents.filter(agent => agent.id !== agentId));
  };

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
    <div className="space-y-8 max-w-7xl mx-auto">
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Deactivate Agent?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to deactivate this agent? It will no longer respond to delegated tasks.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center space-x-2 py-3">
            <Checkbox
              id="skipConfirmation"
              checked={skipConfirmation}
              onCheckedChange={handleSkipConfirmationChange}
            />
            <label
              htmlFor="skipConfirmation"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Don't ask me again
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDeactivation}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDeactivation} className="bg-brandPurple text-white hover:bg-brandPurple/90">
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-semibold text-fg tracking-tight">
            {getFilterTitle()}
          </h1>
          <p className="text-fgMuted mt-1">
            Orchestrate, specialize, and govern your multi-agent architecture
          </p>
        </div>
        <ThemeToggle />
      </div>
      
      <Separator />
      
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fgMuted" />
          <Input
            placeholder="Search agents by name, role, or purpose..."
            className="pl-10 w-full"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-[160px] bg-bg border-border">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="Orchestrator">Orchestrator</SelectItem>
              <SelectItem value="Sub-Agent">Sub-Agent</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px] bg-bg border-border">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[140px] bg-bg border-border">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Most Recent</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="most-used">Most Used</SelectItem>
              <SelectItem value="less-used">Less Used</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-8 w-8 text-brandPurple animate-spin" />
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <Bot className="h-16 w-16 text-fgMuted opacity-80" />
          <h2 className="text-2xl font-semibold text-fg">No Agents Found</h2>
          <p className="text-fgMuted">
            {searchTerm ? "Try a different search term" : "No agents match the current filters"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Link to="/agents/create" className="block">
            <Card className="h-full border-dashed border-2 border-brandPurple/30 hover:border-brandPurple/70 transition-all bg-transparent hover:bg-bgMuted/50">
              <div className="flex flex-col items-center justify-center h-full py-10">
                <div className="h-12 w-12 rounded-full bg-brandPurple/10 flex items-center justify-center mb-4">
                  <PlusCircle className="h-6 w-6 text-brandPurple" />
                </div>
                <h3 className="text-lg font-medium text-fg">Create New Agent</h3>
                <p className="text-sm text-fgMuted text-center mt-2 max-w-xs">
                  Define a new specialized agent with its own RISEN prompt and identity
                </p>
              </div>
            </Card>
          </Link>
        
          {filteredAgents.map((agent) => {
            const docs = getAgentDocs(agent.id);
            return (
              <Link to={`/agents/${agent.id}`} key={agent.id} className="block">
                <Card className={`h-full transition-all hover:shadow-md hover:border-brandPurple/30 ${agent.type === "Orchestrator" ? "border-brandPurple/20 bg-brandPurple/[0.02]" : ""}`}>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <Avatar className={`h-12 w-12 border rounded-lg overflow-hidden ${agent.type === "Orchestrator" ? "border-brandPurple/40" : "border-border"}`}>
                          <AvatarImage src={agent.avatar} alt={agent.name} className="object-cover" />
                          <AvatarFallback><UserCircle2 className="h-6 w-6" /></AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-fg">{agent.name}</h3>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {agent.type === "Orchestrator" ? "Orchestrator" : "Sub-Agent"}
                            </Badge>
                          </div>
                          <p className="text-xs text-fgMuted line-clamp-1 mt-0.5">
                            {docs?.soulSummary || agent.description}
                          </p>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.preventDefault()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 bg-bg z-50">
                          <DropdownMenuItem onClick={(e) => handleToggleStatus(e, agent.id, agent.status)}>
                            <Power className="mr-2 h-4 w-4" />
                            {agent.status === "active" ? "Deactivate" : "Activate"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => handleEditAgent(e, agent.id)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit Agent
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => handleViewDetails(e, agent.id)}>
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => handleArchiveAgent(e, agent.id)}>
                            <Archive className="mr-2 h-4 w-4" />
                            Archive Agent
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    
                    <div className="mt-3">
                      <CardDescription className="line-clamp-2 text-fgMuted mb-2">
                        {agent.purpose || agent.description}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="pb-3">
                    <div className="flex items-center gap-4 text-xs text-fgMuted">
                      {docs && (
                        <div className="flex items-center gap-1">
                          <Thermometer className="h-3 w-3" />
                          <span>Temp: {docs.temperature}</span>
                        </div>
                      )}
                      {agent.interactions !== undefined && (
                        <span>{agent.interactions.toLocaleString()} interactions</span>
                      )}
                      {agent.sourceDoc && (
                        <span className="text-brandPurple/60 truncate">{agent.sourceDoc.split('/').pop()}</span>
                      )}
                    </div>
                  </CardContent>
                  
                  <CardFooter className="border-t border-border pt-4 flex justify-between items-center">
                    <AgentToggle 
                      isActive={agent.status === "active"} 
                      onToggle={(e) => handleToggleStatus(e, agent.id, agent.status)} 
                    />
                    <div className="text-sm text-fg font-medium">View Details &rarr;</div>
                  </CardFooter>
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
