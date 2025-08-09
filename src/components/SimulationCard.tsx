
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SimulationSteps } from "./SimulationSteps";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ChevronUp } from "lucide-react";

interface SimulationCardProps {
  status?: 'not-started' | 'in-progress' | 'completed';
  coverage?: number;
  performance?: number;
  scenarios?: Array<{
    id: string;
    name: string;
    completed: boolean;
  }>;
  simulations?: Array<{
    id: string;
    name: string;
    date: string;
    coverage: number;
    performance: number;
    scenarios: number;
    tokens: string | number;
  }>;
  onStart?: () => void;
  onComplete?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export const SimulationCard = ({
  status = 'not-started',
  coverage,
  performance,
  scenarios,
  simulations,
  onStart,
  onComplete,
  isExpanded = true,
  onToggleExpand
}: SimulationCardProps) => {
  const { toast } = useToast();
  // Let parent component control expanded state if provided
  const [localExpanded, setLocalExpanded] = useState(status !== 'completed');
  
  // Use either controlled or uncontrolled state
  const expanded = onToggleExpand ? isExpanded : localExpanded;

  const handleToggleExpand = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      setLocalExpanded(!localExpanded);
    }
  };

  const handleSimulationComplete = (data: any) => {
    toast({
      title: "Starting Simulations",
      description: "Your simulations are being processed...",
    });
    console.log("Simulation data:", data);
    if (onComplete) {
      onComplete();
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'not-started':
        return (
          <Badge variant="outline" className="bg-bgMuted text-fgMuted border-border">
            Not Started
          </Badge>
        );
      case 'in-progress':
        return (
          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
            In Progress
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="outline" className="bg-success/10 text-success border-success/30">
            Completed
          </Badge>
        );
      default:
        return null;
    }
  };

  const getProgressValue = () => {
    switch (status) {
      case 'not-started':
        return 0;
      case 'in-progress':
        return 50;
      case 'completed':
        return 100;
      default:
        return 0;
    }
  };

  const getProgressColorClass = () => {
    switch (status) {
      case 'not-started':
        return "bg-fgMuted";
      case 'in-progress':
        return "bg-warning";
      case 'completed':
        return "bg-success";
      default:
        return "bg-fgMuted";
    }
  };

  return (
    <div className="rounded-lg overflow-hidden mb-6 border border-border bg-bg">
      <div className="p-6 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-full bg-bgMuted w-8 h-8 text-fg">
              3
            </div>
            <h3 className="text-xl font-semibold text-fg">Simulations</h3>
            {getStatusBadge()}
          </div>
          <div className="flex items-center gap-2">
            {status !== 'not-started' && (
              <span className="text-sm text-fgMuted">
                {status === 'completed' ? '100' : '50'}%
              </span>
            )}
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleToggleExpand}
              className="text-fgMuted hover:text-fg"
            >
              <ChevronUp className={`h-5 w-5 ${!expanded ? 'transform rotate-180' : ''}`} />
            </Button>
          </div>
        </div>
        
        <p className="text-fgMuted mb-4">
          Generate and run scenarios to test your agent's performance
        </p>
        
        <Progress 
          value={getProgressValue()} 
          className={`h-1.5 mb-6 [&>div]:${getProgressColorClass()}`}
        />
        
        {expanded && (
          <CardContent className="p-0 pb-6">
            <SimulationSteps 
              onComplete={handleSimulationComplete}
              initialStatus={status}
              coverage={coverage}
              performance={performance}
              scenarios={scenarios}
              simulations={simulations}
              hideProgressBar={true}
              onStart={onStart}
            />
          </CardContent>
        )}
      </div>
    </div>
  );
};
