
import { useState, useEffect } from 'react';
import { fetchAgents } from '@/services/agentService';
import { AgentType } from '@/types/agent';

export const useAgents = (filter: string = 'all-agents') => {
  const [agents, setAgents] = useState<AgentType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAgents = async () => {
      setIsLoading(true);
      try {
        const data = await fetchAgents(filter);
        setAgents(data);
        setError(null);
      } catch (err) {
        setError("Failed to load agents");
        console.error("Error loading agents:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadAgents();
  }, [filter]);

  return { agents, isLoading, error };
};
