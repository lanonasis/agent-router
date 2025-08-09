
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { 
  Bot, Target, Building, Briefcase, Code,
  HeartPulse, Landmark, ShoppingCart, CircuitBoard, GraduationCap, 
  Plane, Factory, ShieldCheck, Phone, Home, Headphones, BarChart4,
  Wrench, MessageSquare, Calendar, Wallet
} from 'lucide-react';

interface AgentConfigProps {
  name: string;
  description: string;
  purpose: string;
  prompt: string;
  industry: string;
  botFunction: string;
  customIndustry?: string;
  customFunction?: string;
  agentType?: string;
  model?: string;
}

interface AgentConfigSidebarProps {
  agentConfig: AgentConfigProps;
}

const INDUSTRIES = {
  "healthcare": { name: "Healthcare", icon: <HeartPulse className="h-4 w-4" /> },
  "finance": { name: "Finance & Banking", icon: <Landmark className="h-4 w-4" /> },
  "retail": { name: "Retail & E-commerce", icon: <ShoppingCart className="h-4 w-4" /> },
  "technology": { name: "Technology", icon: <CircuitBoard className="h-4 w-4" /> },
  "education": { name: "Education", icon: <GraduationCap className="h-4 w-4" /> },
  "hospitality": { name: "Hospitality & Travel", icon: <Plane className="h-4 w-4" /> },
  "manufacturing": { name: "Manufacturing", icon: <Factory className="h-4 w-4" /> },
  "insurance": { name: "Insurance", icon: <ShieldCheck className="h-4 w-4" /> },
  "telecommunications": { name: "Telecommunications", icon: <Phone className="h-4 w-4" /> },
  "real-estate": { name: "Real Estate", icon: <Home className="h-4 w-4" /> },
  "other": { name: "Other Industry", icon: null }
};

const BOT_FUNCTIONS = {
  "customer-service": { name: "Customer Service", icon: <Headphones className="h-4 w-4" /> },
  "sales": { name: "Sales & Marketing", icon: <BarChart4 className="h-4 w-4" /> },
  "support": { name: "Technical Support", icon: <Wrench className="h-4 w-4" /> },
  "it-helpdesk": { name: "IT Helpdesk", icon: <CircuitBoard className="h-4 w-4" /> },
  "lead-generation": { name: "Lead Generation", icon: <Target className="h-4 w-4" /> },
  "booking": { name: "Appointment Booking", icon: <Calendar className="h-4 w-4" /> },
  "faq": { name: "FAQ & Knowledge Base", icon: <MessageSquare className="h-4 w-4" /> },
  "billing": { name: "Billing & Payments", icon: <Wallet className="h-4 w-4" /> },
  "other": { name: "Other Function", icon: null }
};

export const AgentConfigSidebar: React.FC<AgentConfigSidebarProps> = ({ agentConfig }) => {
  const industryInfo = INDUSTRIES[agentConfig.industry as keyof typeof INDUSTRIES] || 
                       { name: agentConfig.customIndustry || "Not Selected", icon: null };
  
  const functionInfo = BOT_FUNCTIONS[agentConfig.botFunction as keyof typeof BOT_FUNCTIONS] || 
                       { name: agentConfig.customFunction || "Not Selected", icon: null };
  
  return (
    <Card className="sticky top-4 dark:bg-bgMuted/80">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-brandPurple" />
          Agent Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Agent name display */}
        {agentConfig.name ? (
          <div className="space-y-1.5">
            <Label className="text-xs text-fgMuted">Agent Name</Label>
            <div className="font-medium text-lg text-fg">{agentConfig.name}</div>
          </div>
        ) : (
          <div className="bg-bgMuted/30 p-3 rounded-md flex items-center gap-2 text-fgMuted">
            <Bot className="h-4 w-4" />
            <span>Agent name will appear here</span>
          </div>
        )}
        
        {/* Industry and Function */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-fgMuted">Industry</Label>
            {agentConfig.industry ? (
              <Badge variant="outline" className="flex gap-1 items-center">
                {industryInfo.icon}
                <span>{industryInfo.name}</span>
              </Badge>
            ) : (
              <div className="text-fgMuted text-sm">Not selected</div>
            )}
          </div>
          
          <div className="space-y-1.5">
            <Label className="text-xs text-fgMuted">Function</Label>
            {agentConfig.botFunction ? (
              <Badge variant="outline" className="flex gap-1 items-center">
                {functionInfo.icon}
                <span>{functionInfo.name}</span>
              </Badge>
            ) : (
              <div className="text-fgMuted text-sm">Not selected</div>
            )}
          </div>
        </div>

        {/* Description/Purpose */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Target className="h-4 w-4 text-brandPurple" />
            <Label>Purpose</Label>
          </div>
          {agentConfig.purpose ? (
            <div className="bg-bgMuted/30 p-2 rounded-md text-sm text-fg">
              {agentConfig.purpose}
            </div>
          ) : (
            <div className="bg-bgMuted/30 p-3 rounded-md flex items-center gap-2 text-fgMuted text-sm">
              Agent purpose will appear here
            </div>
          )}
        </div>
        
        {/* Prompt */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Code className="h-4 w-4 text-brandPurple" />
            <Label>Prompt</Label>
          </div>
          {agentConfig.prompt ? (
            <Textarea 
              value={agentConfig.prompt} 
              readOnly 
              className="min-h-[150px] text-sm font-mono bg-bgMuted/30"
            />
          ) : (
            <div className="bg-bgMuted/30 p-3 rounded-md h-[150px] flex items-center justify-center text-fgMuted text-sm">
              Agent prompt will appear here
            </div>
          )}
        </div>
        
        {/* Additional settings info */}
        <div className="text-xs text-fgMuted pt-2 border-t border-border">
          Once your agent is created, you can further customize settings and connect to channels.
        </div>
      </CardContent>
    </Card>
  );
};
