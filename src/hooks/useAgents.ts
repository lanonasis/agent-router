
import { useState, useEffect } from 'react';
import { fetchAgents } from '@/services/agentService';
import { AgentType } from '@/types/agent';

// Helper function to generate a random phone number
const generateRandomPhone = (id: string) => {
  // Ensure we have at least 3 characters in the ID to work with
  const safeId = id.padEnd(3, 'a');
  
  // Use a more reliable method to generate area code and phone parts
  const areaCode = 100 + (safeId.charCodeAt(0) % 900);
  const firstPart = 100 + (safeId.charCodeAt(1) % 900);
  const secondPart = 1000 + (safeId.charCodeAt(2) % 9000);
  
  // Format the phone number properly
  return `+1 (${areaCode}) ${firstPart}-${secondPart}`;
};

// Helper function to generate a random email based on agent name
const generateRandomEmail = (id: string, name: string) => {
  const domains = ['agentai.com', 'assistants.io', 'aihelpers.org', 'botmail.net'];
  // Ensure we have enough characters in the ID to work with
  const safeId = id.padEnd(4, 'a');
  
  const domainIndex = safeId.charCodeAt(3) % domains.length;
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Use a substring up to 3 characters if available, otherwise use what we have
  const idPart = safeId.length >= 3 ? safeId.slice(0, 3) : safeId;
  
  return `${normalizedName}${idPart}@${domains[domainIndex]}`;
};

export const useAgents = (filter: string = 'all-agents') => {
  const [agents, setAgents] = useState<AgentType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAgents = async () => {
      setIsLoading(true);
      try {
        const data = await fetchAgents(filter);
        
        // Add phone and email to each agent
        const enhancedData = data.map(agent => ({
          ...agent,
          phone: generateRandomPhone(agent.id),
          email: generateRandomEmail(agent.id, agent.name)
        }));
        
        setAgents(enhancedData);
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
