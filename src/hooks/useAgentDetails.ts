
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

    const loadAgentDetails = async () => {
      setIsLoading(true);
      try {
        const data = await fetchAgentById(agentId);
        setAgent(data);
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

  const openRolePlay = () => setIsRolePlayOpen(true);
  const closeRolePlay = () => setIsRolePlayOpen(false);

  const startDirectCall = (phoneNumber: string, deviceSettings: { mic: string; speaker: string }) => {
    setDirectCallInfo({ phoneNumber, deviceSettings });
    setIsDirectCallActive(true);
    setIsRolePlayOpen(false);
  };

  const endDirectCall = () => {
    setIsDirectCallActive(false);
    setDirectCallInfo(null);
  };

  const showSuccessToast = (title: string, description: string) => {
    toast({ title, description });
  };

  return { 
    agent, 
    isLoading, 
    error,
    isRolePlayOpen,
    openRolePlay,
    closeRolePlay,
    showSuccessToast,
    isDirectCallActive,
    directCallInfo,
    startDirectCall,
    endDirectCall
  };
};
