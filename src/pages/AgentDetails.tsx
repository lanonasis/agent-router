import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Bot, Trash2, AlertCircle, Loader2, History, Cpu, Calendar, Mic, Volume2, MessageSquare, Plus, Play, Pause, Phone, Copy, PhoneOutgoing, PhoneIncoming, Mail, Send, MoreVertical, Archive, UserMinus, PenSquare, Cog } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { VoiceTrait, AgentType } from "@/types/agent";
import { useAgentDetails } from "@/hooks/useAgentDetails";
import { AgentSetupStepper } from "@/components/AgentSetupStepper";
import { AgentToggle } from "@/components/AgentToggle";
import { AgentChannels } from "@/components/AgentChannels";
import { AgentStats } from "@/components/AgentStats";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { updateAgent } from "@/services/agentService";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import AgentConfigSettings from "@/components/AgentConfigSettings";
import { RolePlayDialog } from "@/components/RolePlayDialog";
import { CustomTooltip } from "@/components/CustomTooltip";
import { UserPersonasSidebar } from "@/components/UserPersonasSidebar";
import { CallInterface } from "@/components/CallInterface";
import { Rocket } from "lucide-react";
import { TestAgentSidebar } from "@/components/TestAgentSidebar";

const SAMPLE_TEXT = "Hello, I'm an AI assistant and I'm here to help you with your questions.";

interface VoiceDefinition {
  id: string;
  name: string;
  traits: VoiceTrait[];
  avatar?: string;
  audioSample: string;
}

const voiceSamples: Record<string, Record<string, VoiceDefinition>> = {
  "Eleven Labs": {
    "Emma": {
      id: "9BWtsMINqrJLrRacOk9x",
      name: "Emma",
      traits: [{
        name: "British",
        color: "bg-blue-100 text-blue-800"
      }, {
        name: "Professional",
        color: "bg-purple-100 text-purple-800"
      }],
      avatar: "/voices/avatars/emma.jpg",
      audioSample: "/voices/eleven-emma.mp3"
    },
    "Josh": {
      id: "CwhRBWXzGAHq8TQ4Fs17",
      name: "Josh",
      traits: [{
        name: "American",
        color: "bg-red-100 text-red-800"
      }, {
        name: "Casual",
        color: "bg-green-100 text-green-800"
      }],
      avatar: "/voices/avatars/josh.jpg",
      audioSample: "/voices/eleven-josh.mp3"
    },
    "Aria": {
      id: "EXAVITQu4vr4xnSDxMaL",
      name: "Aria",
      traits: [{
        name: "Young",
        color: "bg-yellow-100 text-yellow-800"
      }, {
        name: "Friendly",
        color: "bg-pink-100 text-pink-800"
      }],
      avatar: "/voices/avatars/aria.jpg",
      audioSample: "/voices/eleven-aria.mp3"
    },
    "Charlie": {
      id: "IKne3meq5aSn9XLyUdCD",
      name: "Charlie",
      traits: [{
        name: "Australian",
        color: "bg-green-100 text-green-800"
      }, {
        name: "Energetic",
        color: "bg-orange-100 text-orange-800"
      }],
      avatar: "/voices/avatars/charlie.jpg",
      audioSample: "/voices/eleven-charlie.mp3"
    }
  },
  "Amazon Polly": {
    "Joanna": {
      id: "Joanna",
      name: "Joanna",
      traits: [{
        name: "American",
        color: "bg-red-100 text-red-800"
      }, {
        name: "Professional",
        color: "bg-purple-100 text-purple-800"
      }],
      avatar: "/voices/avatars/joanna.jpg",
      audioSample: "/voices/polly-joanna.mp3"
    },
    "Matthew": {
      id: "Matthew",
      name: "Matthew",
      traits: [{
        name: "American",
        color: "bg-red-100 text-red-800"
      }, {
        name: "Deep",
        color: "bg-blue-100 text-blue-800"
      }],
      avatar: "/voices/avatars/matthew.jpg",
      audioSample: "/voices/polly-matthew.mp3"
    }
  },
  "Google TTS": {
    "Wavenet A": {
      id: "en-US-Wavenet-A",
      name: "Wavenet A",
      traits: [{
        name: "American",
        color: "bg-red-100 text-red-800"
      }, {
        name: "Neutral",
        color: "bg-gray-100 text-gray-800"
      }],
      avatar: "/voices/avatars/wavenet-a.jpg",
      audioSample: "/voices/google-wavenet-a.mp3"
    },
    "Wavenet B": {
      id: "en-US-Wavenet-B",
      name: "Wavenet B",
      traits: [{
        name: "British",
        color: "bg-blue-100 text-blue-800"
      }, {
        name: "Formal",
        color: "bg-indigo-100 text-indigo-800"
      }],
      avatar: "/voices/avatars/wavenet-b.jpg",
      audioSample: "/voices/google-wavenet-b.mp3"
    }
  }
};

const AgentDetails = () => {
  const {
    agentId
  } = useParams<{
    agentId: string;
  }>();
  const navigate = useNavigate();
  const {
    toast
  } = useToast();
  const {
    agent,
    isLoading,
    error,
    isRolePlayOpen,
    openRolePlay,
    closeRolePlay,
    isDirectCallActive,
    directCallInfo,
    startDirectCall,
    endDirectCall
  } = useAgentDetails(agentId);
  const [isActive, setIsActive] = useState(false);
  const [model, setModel] = useState<string>("GPT-4");
  const [voice, setVoice] = useState<string>("Emma");
  const [voiceProvider, setVoiceProvider] = useState<string>("Eleven Labs");
  const [isVoiceDialogOpen, setIsVoiceDialogOpen] = useState(false);
  const [customVoiceId, setCustomVoiceId] = useState<string>("");
  const [isCustomVoice, setIsCustomVoice] = useState(false);
  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null);
  const [selectedVoiceTraits, setSelectedVoiceTraits] = useState<VoiceTrait[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const [activeTab, setActiveTab] = useState("setup");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isCallTooltipOpen, setIsCallTooltipOpen] = useState(false);
  const [customCallNumber, setCustomCallNumber] = useState<string>("");
  const [isPersonasSidebarOpen, setIsPersonasSidebarOpen] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<any>(null);
  const [isTestAgentSidebarOpen, setIsTestAgentSidebarOpen] = useState(false);
  
  useEffect(() => {
    if (agent) {
      setIsActive(agent.status === "active");
      setModel(agent.model || "GPT-4");
      setVoice(agent.voice || "Emma");
      setVoiceProvider(agent.voiceProvider || "Eleven Labs");
      setCustomVoiceId(agent.customVoiceId || "");
      setIsCustomVoice(agent.voice === "Custom");
      if (agent.voice && agent.voiceProvider && !isCustomVoice) {
        const voiceDef = voiceSamples[agent.voiceProvider]?.[agent.voice];
        if (voiceDef) {
          setSelectedVoiceTraits(voiceDef.traits || []);
          setSelectedVoiceId(voiceDef.id || "");
        }
      }
    }
  }, [agent]);
  
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);
  
  const handleStatusToggle = () => {
    setIsActive(!isActive);
    toast({
      title: !isActive ? "Agent Activated" : "Agent Deactivated",
      description: !isActive ? "Your agent is now active and will process requests." : "Your agent has been deactivated and won't process new requests.",
      variant: !isActive ? "default" : "destructive"
    });
  };
  
  const handleModelChange = async (value: string) => {
    setModel(value);
    if (agent && agentId) {
      try {
        await updateAgent(agentId, {
          ...agent,
          model: value
        });
        toast({
          title: "Model updated",
          description: `The agent model has been updated to ${value}.`
        });
      } catch (error) {
        toast({
          title: "Failed to update model",
          description: "There was an error updating the agent model.",
          variant: "destructive"
        });
      }
    }
  };
  
  const handleVoiceChange = async (voiceName: string) => {
    setVoice(voiceName);
    setIsCustomVoice(voiceName === "Custom");
    if (voiceName !== "Custom") {
      const voiceDef = voiceSamples[voiceProvider]?.[voiceName];
      if (voiceDef) {
        setSelectedVoiceTraits(voiceDef.traits || []);
        setSelectedVoiceId(voiceDef.id || "");
      }
      if (currentlyPlaying !== voiceName) {
        handlePlaySample(voiceName);
      }
    } else {
      setSelectedVoiceTraits([]);
      setSelectedVoiceId(customVoiceId);
    }
  };
  
  const handleProviderChange = async (value: string) => {
    setVoiceProvider(value);
    const voices = Object.keys(voiceSamples[value as keyof typeof voiceSamples] || {});
    if (voices.length > 0) {
      setVoice(voices[0]);
      const voiceDef = voiceSamples[value]?.[voices[0]];
      if (voiceDef) {
        setSelectedVoiceTraits(voiceDef.traits || []);
        setSelectedVoiceId(voiceDef.id || "");
      }
      setIsCustomVoice(voices[0] === "Custom");
    }
    if (audioRef.current) {
      audioRef.current.pause();
      setCurrentlyPlaying(null);
    }
  };
  
  const handleCustomVoiceIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomVoiceId(e.target.value);
    setSelectedVoiceId(e.target.value);
  };
  
  const handlePlaySample = (voiceName: string) => {
    if (currentlyPlaying === voiceName) {
      if (audioRef.current) {
        audioRef.current.pause();
        setCurrentlyPlaying(null);
      }
      return;
    }
    const voicePath = voiceSamples[voiceProvider as keyof typeof voiceSamples]?.[voiceName]?.audioSample;
    if (!voicePath) return;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(voicePath);
    audioRef.current = audio;
    audio.onended = () => {
      setCurrentlyPlaying(null);
    };
    audio.onplay = () => {
      setCurrentlyPlaying(voiceName);
    };
    audio.onerror = () => {
      toast({
        title: "Audio Error",
        description: `Could not play sample for ${voiceName}.`,
        variant: "destructive"
      });
      setCurrentlyPlaying(null);
    };
    audio.play().catch(err => {
      console.error("Error playing audio:", err);
      setCurrentlyPlaying(null);
    });
  };
  
  const handleVoiceSelectionSave = async () => {
    if (agent && agentId) {
      try {
        const updatedAgent = {
          ...agent,
          voice: isCustomVoice ? "Custom" : voice,
          voiceProvider: voiceProvider,
          customVoiceId: isCustomVoice ? customVoiceId : undefined,
          voiceTraits: isCustomVoice ? [] : selectedVoiceTraits
        };
        await updateAgent(agentId, updatedAgent);
        toast({
          title: "Voice settings updated",
          description: `The voice settings have been updated.`
        });
        setIsVoiceDialogOpen(false);
      } catch (error) {
        toast({
          title: "Failed to update voice settings",
          description: "There was an error updating the voice settings.",
          variant: "destructive"
        });
      }
    }
  };
  
  const handleDelete = () => {
    toast({
      title: "Agent deleted",
      description: "The agent has been successfully deleted.",
      variant: "destructive"
    });
    navigate("/agents");
  };
  
  const handleUpdateChannel = async (channel: string, config: {
    enabled: boolean;
    details?: string;
    config?: Record<string, any>;
  }) => {
    if (!agent || !agentId) return;
    let updatedChannels: string[] = [...(agent.channels || [])];
    if (config.enabled && !updatedChannels.includes(channel)) {
      updatedChannels.push(channel);
    } else if (!config.enabled && updatedChannels.includes(channel)) {
      updatedChannels = updatedChannels.filter(c => c !== channel);
    }
    try {
      const updatedAgent = {
        ...agent,
        channels: updatedChannels,
        channelConfigs: {
          ...(agent.channelConfigs || {}),
          [channel]: config
        }
      };
      await updateAgent(agentId, updatedAgent);
      setIsActive(updatedAgent.status === "active");
      toast({
        title: config.enabled ? "Channel enabled" : "Channel disabled",
        description: `The ${channel} channel has been updated.`
      });
    } catch (error) {
      toast({
        title: "Failed to update channel",
        description: "There was an error updating the channel configuration.",
        variant: "destructive"
      });
    }
  };
  
  const handleCopyPhoneNumber = () => {
    if (voicePhoneNumber) {
      navigator.clipboard.writeText(voicePhoneNumber);
      toast({
        title: "Phone number copied",
        description: "Phone number has been copied to clipboard."
      });
    }
  };
  
  const handleTestCall = () => {
    if (voicePhoneNumber) {
      window.location.href = `tel:${voicePhoneNumber}`;
      toast({
        title: "Calling agent",
        description: `Initiating call to ${voicePhoneNumber}`
      });
    } else {
      toast({
        title: "No phone number available",
        description: "Please configure a phone number for voice channel first.",
        variant: "destructive"
      });
    }
  };
  
  const handleCopyEmail = () => {
    if (emailAddress) {
      navigator.clipboard.writeText(emailAddress);
      toast({
        title: "Email address copied",
        description: "Email address has been copied to clipboard."
      });
    }
  };
  
  const handleTestEmail = () => {
    if (emailAddress) {
      window.location.href = `mailto:${emailAddress}?subject=Test Email for ${agent?.name || 'Agent'}&body=This is a test email for your AI agent.`;
      toast({
        title: "Composing email",
        description: `Opening email client to send test email to ${emailAddress}`
      });
    } else {
      toast({
        title: "No email address available",
        description: "Please configure an email address for email channel first.",
        variant: "destructive"
      });
    }
  };
  
  const handleCallMe = () => {
    if (customCallNumber && customCallNumber.trim() !== "") {
      toast({
        title: "Outbound call initiated",
        description: `Your agent will call ${customCallNumber} shortly.`
      });
      setIsCallTooltipOpen(false);
    } else {
      toast({
        title: "Phone number required",
        description: "Please enter a valid phone number.",
        variant: "destructive"
      });
    }
  };
  
  const handleDeactivateAgent = () => {
    setIsActive(false);
    toast({
      title: "Agent Deactivated",
      description: "Your agent has been deactivated and won't process new requests.",
      variant: "destructive"
    });
  };
  
  const handleArchiveAgent = () => {
    toast({
      title: "Agent Archived",
      description: "The agent has been archived and can be restored later."
    });
    navigate("/agents");
  };
  
  const handleEditClick = () => {
    toast({
      title: "Edit Mode",
      description: "You can now edit your agent's details."
    });
    // In a real app, you might navigate to an edit page or enable edit mode
  };
  
  const handleCopyAvatar = () => {
    const avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${agent?.id}`;
    if (avatarUrl) {
      navigator.clipboard.writeText(avatarUrl);
      toast({
        title: "Avatar copied",
        description: "Avatar URL has been copied to clipboard."
      });
    }
  };
  
  const handleAgentUpdate = (updatedAgent: AgentType) => {
    setIsActive(updatedAgent.status === "active");
    if (updatedAgent.name !== agent?.name) {
      toast({
        title: "Agent name updated",
        description: `The agent name has been updated to ${updatedAgent.name}.`
      });
    }
  };
  
  const handleOpenPersonasSidebar = () => {
    setIsPersonasSidebarOpen(true);
  };
  
  const handleOpenTestAgentSidebar = () => {
    setIsTestAgentSidebarOpen(true);
  };
  
  if (isLoading) {
    return <div className="flex justify-center items-center h-[80vh]">
        <Loader2 className="h-8 w-8 text-agent-primary animate-spin" />
      </div>;
  }
  
  if (error || !agent) {
    return <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <Link to="/agents" className="flex items-center text-gray-500 hover:text-agent-primary">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Agents
          </Link>
        </div>
        
        <Alert variant="destructive" className="mb-8">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error || "This agent could not be found or you don't have permission to view it."}
          </AlertDescription>
        </Alert>
        
        <Button onClick={() => navigate("/agents")}>Return to Dashboard</Button>
      </div>;
  }
  
  const lastUpdated = new Date().toLocaleString();
  const voicePhoneNumber = agent.channelConfigs?.voice?.details || null;
  const emailAddress = agent.channelConfigs?.email?.details || null;
  const activeChannels = Object.entries(agent.channelConfigs || {}).filter(([_, config]) => config.enabled).map(([channel]) => channel);
  const isNewAgent = agent.id === "new123";
  
  return <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="mb-6">
        <Link to="/agents" className="flex items-center text-gray-500 hover:text-agent-primary transition-colors duration-200">
          <ArrowLeft className="h-4 w-4 mr-2" />
          <span className="text-sm font-medium">Back to Agents</span>
        </Link>
      </div>
      
      <Card className="mb-6 overflow-hidden">
        <CardHeader className="pb-3">
          <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto] gap-4 items-start">
            <div className="relative">
              <Avatar className="h-16 w-16 border-2 border-agent-primary/30">
                <AvatarImage src={`https://api.dicebear.com/7.x/bottts/svg?seed=${agent.id}`} alt={agent.name} />
                <AvatarFallback className="bg-agent-primary/20 text-agent-primary">
                  <Bot className="h-8 w-8" />
                </AvatarFallback>
              </Avatar>
            </div>
            
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">
                  {agent.name}
                </h1>
                {isActive ? <Badge variant="outline" className="border-green-500/30 text-green-500 bg-green-500/10">
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></span>
                      Active
                    </span>
                  </Badge> : <Badge variant="outline" className="border-border">
                    {agent.type}
                  </Badge>}
              </div>
              <p className="text-muted-foreground mt-1.5 max-w-2xl">{agent.description}</p>
            </div>
            
            <div className="flex items-center justify-end space-x-3">
              <AgentToggle isActive={isActive} onToggle={handleStatusToggle} />
              
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleOpenTestAgentSidebar}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
              >
                <Rocket className="h-4 w-4" />
                Test Agent
              </Button>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="hover:bg-secondary">
                    <MoreVertical className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={handleEditClick} className="cursor-pointer flex items-center gap-2">
                    <PenSquare className="h-4 w-4 text-muted-foreground" />
                    <span>Edit Agent</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDeactivateAgent} className="cursor-pointer flex items-center gap-2">
                    <UserMinus className="h-4 w-4 text-muted-foreground" />
                    <span>Deactivate Agent</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleArchiveAgent} className="cursor-pointer flex items-center gap-2">
                    <Archive className="h-4 w-4 text-muted-foreground" />
                    <span>Archive Agent</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDelete} className="cursor-pointer flex items-center gap-2 text-red-400">
                    <Trash2 className="h-4 w-4" />
                    <span>Delete Agent</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>
        
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-3">
              {activeChannels.length > 0 && <div className="flex flex-wrap gap-2">
                  {activeChannels.includes('voice') && <Badge variant="channel">
                      <Mic className="h-3 w-3 mr-1" />
                      <span className="text-xs">Voice</span>
                    </Badge>}
                  {activeChannels.includes('chat') && <Badge variant="channel">
                      <MessageSquare className="h-3 w-3 mr-1" />
                      <span className="text-xs">Chat</span>
                    </Badge>}
                  {activeChannels.includes('email') && <Badge variant="channel">
                      <Mail className="h-3 w-3 mr-1" />
                      <span className="text-xs">Email</span>
                    </Badge>}
                </div>}
              
              <div className="flex flex-wrap gap-3">
                {/* Phone and email information has been removed */}
              </div>
              
              <div className="mt-2">
                <AgentStats avmScore={agent.avmScore} interactionCount={agent.interactions || 0} csat={agent.csat} performance={agent.performance} isNewAgent={isNewAgent} showZeroValues={false} hideInteractions={true} />
              </div>
              
              <div className="flex justify-end text-xs text-muted-foreground mt-4">
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Created: {agent.createdAt}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <History className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Updated: {lastUpdated.split(',')[0]}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Tabs defaultValue={activeTab} onValueChange={setActiveTab} className="mt-8">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="setup" className="text-sm">
            <span className="flex items-center gap-2">
              <Cog className="h-4 w-4" />
              Setup
            </span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="text-sm">
            <span className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Settings
            </span>
          </TabsTrigger>
        </TabsList>
        
        <div className="mt-6">
          <TabsContent value="setup" className="space-y-6">
            <AgentSetupStepper agent={agent} />
          </TabsContent>
          
          <TabsContent value="settings" className="space-y-6">
            <AgentConfigSettings agent={agent} onAgentUpdate={handleAgentUpdate} />
          </TabsContent>
        </div>
      </Tabs>

      <CallInterface
        open={isDirectCallActive}
        onOpenChange={(open) => {
          if (!open) endDirectCall();
        }}
        persona={selectedPersona}
        directCallInfo={directCallInfo}
        onCallComplete={(recordingData) => {
          toast({
            title: "Call completed",
            description: `Call with ${recordingData.title} has been recorded.`
          });
        }}
      />

      <UserPersonasSidebar
        open={isPersonasSidebarOpen}
        onOpenChange={setIsPersonasSidebarOpen}
        onSelectPersona={(persona) => {
          setSelectedPersona(persona);
        }}
        onStartDirectCall={startDirectCall}
      />
      
      <TestAgentSidebar
        open={isTestAgentSidebarOpen}
        onOpenChange={setIsTestAgentSidebarOpen}
        agent={agent}
        onStartDirectCall={startDirectCall}
        onStartChat={() => {
          toast({
            title: "Chat interface started",
            description: "You can now chat with your agent."
          });
        }}
      />
    </div>;
};

export default AgentDetails;
