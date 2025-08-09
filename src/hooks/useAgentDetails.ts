
import { useState, useEffect } from 'react';
import { fetchAgentById } from '@/services/agentService';
import { AgentType } from '@/types/agent';
import { toast } from '@/components/ui/use-toast';

export const useAgentDetails = (agentId: string | undefined) => {
  const [agent, setAgent] = useState<AgentType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRolePlayOpen, setIsRolePlayOpen] = useState(false);
  const [isDirectCallActive, setIsDirectCallActive] = useState(false);
  const [directCallInfo, setDirectCallInfo] = useState<{
    phoneNumber: string;
    deviceSettings: { mic: string; speaker: string };
  } | null>(null);

  useEffect(() => {
    if (!agentId) {
      setError("Agent ID is required");
      setIsLoading(false);
      return;
    }

    // Special case for newly created agent (new123)
    if (agentId === "new123") {
      const newlyCreatedAgent: AgentType = {
        id: "new123",
        name: "New Agent",
        description: "This agent was just created and needs configuration.",
        type: "Other Function",
        status: "inactive",
        createdAt: new Date().toISOString().split('T')[0],
        interactions: 0,
        isPersonal: true,
        model: "GPT-4",
        channels: [],
        channelConfigs: {},
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=new123`,
        purpose: "Your newly created agent needs configuration.",
        prompt: "You are a new AI assistant. Your configuration is incomplete.",
        industry: "",
        botFunction: "",
        customIndustry: "",
        customFunction: "",
        voice: "9BWtsMINqrJLrRacOk9x", // Default voice ID for Aria
        voiceProvider: "Eleven Labs", // Add default voice provider
        // Add explicit zeros for stats to make it clear they don't exist yet
        avmScore: 0,
        csat: 0,
        performance: 0
      };
      
      setAgent(newlyCreatedAgent);
      setError(null);
      setIsLoading(false);
      return;
    }

    const loadAgentDetails = async () => {
      setIsLoading(true);
      try {
        const data = await fetchAgentById(agentId);
        
        // Add default stats if missing
        const channelConfigs = data.channelConfigs || {};
        
        // Ensure voice channel is configured with a phone number
        if (!channelConfigs.voice) {
          channelConfigs.voice = {
            enabled: true,
            details: "+1 (800) 555-1234"
          };
        }
        
        // Ensure chat channel is configured
        if (!channelConfigs.chat) {
          channelConfigs.chat = {
            enabled: true,
            details: "https://yourcompany.com/chat"
          };
        }
        
        // Ensure email channel is configured
        if (!channelConfigs.email) {
          channelConfigs.email = {
            enabled: true,
            details: "support@yourcompany.com"
          };
        }
        
        const enhancedData = {
          ...data,
          interactions: data.interactions || 0,
          csat: data.csat || 85,
          performance: data.performance || 92,
          avmScore: data.avmScore || 7.8,
          channels: data.channels || ["voice", "chat", "email"],
          channelConfigs: channelConfigs,
          // Add default values for new fields if they're missing
          avatar: data.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${data.id}`,
          purpose: data.purpose || "Help users with their questions and provide assistance.",
          prompt: data.prompt || `You are ${data.name}, an AI assistant. Your job is to be helpful, harmless, and honest. Answer questions to the best of your ability.`,
          industry: data.industry || "",
          botFunction: data.botFunction || "",
          customIndustry: data.customIndustry || "",
          customFunction: data.customFunction || "",
          voice: data.voice || "9BWtsMINqrJLrRacOk9x", // Default voice ID for Aria
          voiceProvider: data.voiceProvider || "Eleven Labs" // Default voice provider
        };
        
        setAgent(enhancedData);
        setError(null);
      } catch (err) {
        console.error("Error loading agent details:", err);
        setError("Failed to load agent details");
      } finally {
        setIsLoading(false);
      }
    };

    loadAgentDetails();
  }, [agentId]);

  const openRolePlay = () => {
    setIsRolePlayOpen(true);
  };

  const closeRolePlay = () => {
    setIsRolePlayOpen(false);
  };

  // Start a direct call with a specific phone number
  const startDirectCall = (phoneNumber: string, deviceSettings: { mic: string; speaker: string }) => {
    console.log("Starting direct call in useAgentDetails:", phoneNumber, deviceSettings);
    setDirectCallInfo({ phoneNumber, deviceSettings });
    setIsDirectCallActive(true);
    // Close the role play dialog if it's open
    setIsRolePlayOpen(false);
  };

  // End the active direct call
  const endDirectCall = () => {
    setIsDirectCallActive(false);
    setDirectCallInfo(null);
  };

  // Function to show success toast
  const showSuccessToast = (title: string, description: string) => {
    toast({
      title,
      description
    });
  };

  return { 
    agent, 
    isLoading, 
    error,
    isRolePlayOpen,
    openRolePlay,
    closeRolePlay,
    showSuccessToast,
    // Add direct call related functions and state
    isDirectCallActive,
    directCallInfo,
    startDirectCall,
    endDirectCall
  };
};
