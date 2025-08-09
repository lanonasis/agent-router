import React, { useState } from "react";
import { AgentTrainingCard } from "./AgentTrainingCard";
import { WorkflowCard } from "./WorkflowCard";
import { SimulationCard } from "./SimulationCard";
import { Progress } from "@/components/ui/progress";

interface AgentSetupStepperProps {
  agent: any;
}

// Define the status type for better TypeScript support
type StepStatus = 'not-started' | 'in-progress' | 'completed';

interface StepState {
  status: StepStatus;
  active: boolean;
}

export const AgentSetupStepper: React.FC<AgentSetupStepperProps> = ({ agent }) => {
  const [steps, setSteps] = useState({
    training: { status: 'not-started' as StepStatus, active: true },
    workflow: { status: 'not-started' as StepStatus, active: false },
    simulation: { status: 'not-started' as StepStatus, active: false }
  });

  // Track expanded state for each card
  const [expanded, setExpanded] = useState({
    training: true,
    workflow: false,
    simulation: false
  });
  
  // Track training records
  const [trainingRecords, setTrainingRecords] = useState<any[]>([]);

  const toggleExpanded = (stepName: keyof typeof steps) => {
    setExpanded(prev => ({
      ...prev,
      [stepName]: !prev[stepName]
    }));
  };

  const totalSteps = Object.keys(steps).length;
  const completedSteps = Object.values(steps).filter(step => step.status === 'completed').length;
  const overallProgress = Math.round((completedSteps / totalSteps) * 100);

  const handleStepComplete = (stepName: keyof typeof steps) => {
    setSteps(prevSteps => {
      const newSteps = { ...prevSteps };
      
      // Mark current step as completed
      newSteps[stepName].status = 'completed' as StepStatus;
      newSteps[stepName].active = false;

      // Find next incomplete step
      const stepKeys = Object.keys(steps) as Array<keyof typeof steps>;
      const currentIndex = stepKeys.indexOf(stepName);
      const nextStep = stepKeys[currentIndex + 1];

      if (nextStep) {
        newSteps[nextStep].status = 'in-progress' as StepStatus;
        newSteps[nextStep].active = true;
        
        // Auto-collapse completed step and expand next step
        setExpanded(prev => ({
          ...prev,
          [stepName]: false,
          [nextStep]: true
        }));
      }

      return newSteps;
    });
  };

  const handleStepStart = (stepName: keyof typeof steps) => {
    setSteps(prevSteps => ({
      ...prevSteps,
      [stepName]: {
        ...prevSteps[stepName],
        status: 'in-progress' as StepStatus
      }
    }));
  };

  const sampleTrainingRecords = [
    {
      id: '1',
      title: 'Customer Support Call #1',
      date: 'Feb 20, 2024',
      time: '8:30 AM',
      duration: '5:30',
      type: 'call' as const
    },
    {
      id: '2',
      title: 'Role-Play Session #1',
      date: 'Feb 21, 2024',
      time: '3:15 PM',
      duration: '3:45',
      type: 'roleplay' as const
    }
  ];

  const sampleScenarios = [
    { id: "1", name: "Product Information Requests", completed: true },
    { id: "2", name: "Account Management", completed: true },
    { id: "3", name: "Billing Questions", completed: true },
    { id: "4", name: "Service Status Updates", completed: true }
  ];

  const sampleSimulations = [
    {
      id: "1",
      name: "Basic Customer Inquiries",
      date: "Feb 25, 2024",
      coverage: 52,
      performance: 68,
      scenarios: 4,
      tokens: "25.3k"
    },
    {
      id: "2",
      name: "Technical Support Basics",
      date: "Feb 24, 2024",
      coverage: 48,
      performance: 65,
      scenarios: 3,
      tokens: "18.6k"
    }
  ];
  
  // Combine default training records with any new ones
  const combinedTrainingRecords = [...sampleTrainingRecords, ...trainingRecords];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="mb-8">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xl font-semibold text-fg">Agent Setup</h2>
          <div className="flex items-center">
            <span className="text-sm font-medium mr-2 text-fgMuted">{overallProgress}% Complete</span>
            <Progress value={overallProgress} className="w-24 h-2" />
          </div>
        </div>
        
        <p className="text-fgMuted">
          Complete these steps in order to fully configure your agent for optimal performance
        </p>
      </div>
      
      <div className="space-y-4 mt-8">
        {steps.training.status === 'not-started' && (
          <AgentTrainingCard 
            status="not-started" 
            stepNumber={1}
            isActive={steps.training.active}
            onStart={() => handleStepStart('training')}
            onComplete={() => handleStepComplete('training')}
            isExpanded={expanded.training}
            onToggleExpand={() => toggleExpanded('training')}
          />
        )}
        
        {steps.training.status === 'in-progress' && (
          <AgentTrainingCard 
            status="in-progress"
            stepNumber={1}
            voiceSamples={3}
            voiceConfidence={65}
            talkTime="45s"
            trainingRecords={combinedTrainingRecords}
            isActive={steps.training.active}
            onComplete={() => handleStepComplete('training')}
            isExpanded={expanded.training}
            onToggleExpand={() => toggleExpanded('training')}
          />
        )}
        
        {steps.training.status === 'completed' && (
          <AgentTrainingCard 
            status="completed"
            stepNumber={1}
            voiceSamples={10}
            totalSamples={10}
            voiceConfidence={95}
            talkTime="120s"
            trainingRecords={combinedTrainingRecords}
            isActive={steps.training.active}
            isExpanded={expanded.training}
            onToggleExpand={() => toggleExpanded('training')}
          />
        )}
        
        {steps.workflow.status === 'not-started' && (
          <WorkflowCard 
            status="not-started"
            stepNumber={2}
            onStart={() => handleStepStart('workflow')}
            onComplete={() => handleStepComplete('workflow')}
            isExpanded={expanded.workflow}
            onToggleExpand={() => toggleExpanded('workflow')}
          />
        )}
        
        {steps.workflow.status === 'in-progress' && (
          <WorkflowCard 
            status="in-progress"
            stepNumber={2}
            onComplete={() => handleStepComplete('workflow')}
            isExpanded={expanded.workflow}
            onToggleExpand={() => toggleExpanded('workflow')}
          />
        )}
        
        {steps.workflow.status === 'completed' && (
          <WorkflowCard 
            status="completed"
            stepNumber={2}
            isExpanded={expanded.workflow}
            onToggleExpand={() => toggleExpanded('workflow')}
          />
        )}
        
        {steps.simulation.status === 'not-started' && (
          <SimulationCard 
            status="not-started"
            onStart={() => handleStepStart('simulation')}
            onComplete={() => handleStepComplete('simulation')}
            isExpanded={expanded.simulation}
            onToggleExpand={() => toggleExpanded('simulation')}
          />
        )}
        
        {steps.simulation.status === 'in-progress' && (
          <SimulationCard 
            status="in-progress"
            coverage={52}
            performance={68}
            scenarios={sampleScenarios}
            simulations={sampleSimulations}
            onComplete={() => handleStepComplete('simulation')}
            isExpanded={expanded.simulation}
            onToggleExpand={() => toggleExpanded('simulation')}
          />
        )}
        
        {steps.simulation.status === 'completed' && (
          <SimulationCard 
            status="completed"
            isExpanded={expanded.simulation}
            onToggleExpand={() => toggleExpanded('simulation')}
          />
        )}
      </div>
    </div>
  );
};
