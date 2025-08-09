
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Bot, Mic, Phone, CheckCircle2, Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import { LiveTranscription } from "@/components/LiveTranscription";
import { AgentConfigSidebar } from "@/components/AgentConfigSidebar";

const AgentCreate = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [callState, setCallState] = useState<"idle" | "connecting" | "active" | "completed">("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transcription, setTranscription] = useState<{ role: "system" | "user", text: string }[]>([]);
  const [agentConfig, setAgentConfig] = useState({
    name: "",
    description: "",
    agentType: "",
    model: "gpt-4",
    purpose: "",
    prompt: "",
    industry: "",
    botFunction: "",
    customIndustry: "",
    customFunction: "",
  });
  
  const handlePhoneNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^\d\s()\-+]/g, '');
    setPhoneNumber(value);
  };
  
  const validatePhoneNumber = () => {
    return phoneNumber.replace(/[^\d]/g, '').length >= 10;
  };
  
  const startAgentCreationCall = () => {
    if (!validatePhoneNumber()) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid phone number.",
        variant: "destructive",
      });
      return;
    }
    
    setCallState("connecting");
    
    setTimeout(() => {
      setCallState("active");
      simulateConversation();
    }, 2000);
  };
  
  const simulateConversation = () => {
    const conversation = [
      { delay: 1000, role: "system" as const, text: "Hello! I'm your AI assistant, and I'll help you create a new agent. What would you like to name your agent?" },
      { delay: 4000, role: "user" as const, text: "Customer Support Bot" },
      { delay: 2000, role: "system" as const, text: "Great name! What industry will this agent be working in?" },
      { delay: 4000, role: "user" as const, text: "E-commerce" },
      { delay: 2000, role: "system" as const, text: "E-commerce is selected. What function will this agent serve? For example, customer service, sales, or technical support?" },
      { delay: 4000, role: "user" as const, text: "Customer service for order issues and returns" },
      { delay: 2000, role: "system" as const, text: "I've set the function to Customer Service. Can you describe the main purpose of this agent?" },
      { delay: 5000, role: "user" as const, text: "Help customers track orders, process returns, and resolve common shopping issues" },
      { delay: 2000, role: "system" as const, text: "Great! Based on our conversation, I've created a prompt for your agent. You can review and edit it in the sidebar. Is there anything else you'd like to customize?" },
      { delay: 4000, role: "user" as const, text: "No, that looks good" },
      { delay: 2000, role: "system" as const, text: "Perfect! Your Customer Support Bot has been created successfully. You can now review all the details in the sidebar and make any final adjustments before finishing." },
    ];
    
    let cumulativeDelay = 0;
    
    conversation.forEach((item, index) => {
      cumulativeDelay += item.delay;
      
      setTimeout(() => {
        setTranscription(prev => [...prev, item]);
        
        if (item.role === "user") {
          switch (index) {
            case 1: // Name response
              setAgentConfig(prev => ({ ...prev, name: item.text }));
              break;
            case 3: // Industry response
              setAgentConfig(prev => ({ ...prev, industry: "retail" }));
              break;
            case 5: // Function response
              setAgentConfig(prev => ({ ...prev, botFunction: "customer-service" }));
              break;
            case 7: // Purpose response
              setAgentConfig(prev => ({ 
                ...prev, 
                description: item.text,
                purpose: item.text,
                prompt: `You are a Customer Support Bot for an e-commerce platform. Your main purpose is to ${item.text.toLowerCase()}. Always be helpful, friendly, and efficient in addressing customer concerns.`
              }));
              break;
          }
        }
        
        if (index === conversation.length - 1) {
          setTimeout(() => {
            setCallState("completed");
          }, 2000);
        }
      }, cumulativeDelay);
    });
  };
  
  const handleCreateAgent = () => {
    setIsSubmitting(true);
    
    setTimeout(() => {
      toast({
        title: "Agent Created!",
        description: `${agentConfig.name} has been successfully created.`,
      });
      setIsSubmitting(false);
      navigate("/agents");
    }, 1500);
  };
  
  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      <div className="mb-8">
        <Link to="/agents" className="flex items-center text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Agents
        </Link>
      </div>
      
      <div className="flex items-center space-x-3 mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-foreground">Create New Agent by Voice</h1>
          <p className="text-muted-foreground mt-1">Talk with our system to configure your new agent</p>
        </div>
      </div>
      
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1">
          {callState === "idle" ? (
            <Card>
              <CardHeader>
                <CardTitle>Step 1: Start Agent Creation Call</CardTitle>
                <CardDescription>
                  Enter your phone number to begin the guided agent creation process
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <div className="flex space-x-2">
                    <div className="relative flex-1">
                      <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="phone"
                        placeholder="+1 (555) 123-4567"
                        value={phoneNumber}
                        onChange={handlePhoneNumberChange}
                        className="pl-10"
                      />
                    </div>
                    <Button 
                      onClick={startAgentCreationCall}
                      disabled={!phoneNumber}
                      className="gap-2"
                      variant="contrast"
                    >
                      <Mic className="h-4 w-4" />
                      Start Call
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    We'll call you at this number to guide you through agent creation
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>
                      {callState === "connecting" && "Connecting..."}
                      {callState === "active" && "Agent Creation Call"}
                      {callState === "completed" && "Agent Configuration Complete"}
                    </CardTitle>
                    <CardDescription>
                      {callState === "connecting" && "Please wait while we connect your call..."}
                      {callState === "active" && "Live transcription of your conversation"}
                      {callState === "completed" && "Your agent has been configured based on the call"}
                    </CardDescription>
                  </div>
                  <div>
                    {callState === "connecting" && (
                      <div className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Connecting
                      </div>
                    )}
                    {callState === "active" && (
                      <div className="bg-green-500/20 text-green-600 dark:text-green-400 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                        <span className="h-2 w-2 bg-green-500 rounded-full animate-pulse"></span>
                        Active Call
                      </div>
                    )}
                    {callState === "completed" && (
                      <div className="bg-blue-500/20 text-blue-600 dark:text-blue-400 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        Completed
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <LiveTranscription messages={transcription} isCallActive={callState === "active"} />
              </CardContent>
              {callState === "completed" && (
                <CardFooter className="flex justify-end border-t pt-6">
                  <Button 
                    onClick={handleCreateAgent} 
                    disabled={isSubmitting}
                    className="gap-2"
                    variant="contrast"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Create Agent
                      </>
                    )}
                  </Button>
                </CardFooter>
              )}
            </Card>
          )}
        </div>
        
        <div className="w-full md:w-[400px]">
          <AgentConfigSidebar agentConfig={agentConfig} />
        </div>
      </div>
    </div>
  );
};

export default AgentCreate;
