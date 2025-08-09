import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, ChevronRight, Target, PlayCircle, Percent, Zap, Bot, BrainCircuit, PenLine, Users2, Phone, Building, FileText, Database, Lightbulb, BarChart, File, CheckCircle } from 'lucide-react';

interface SimulationStep {
  title: string;
  description: string;
  icon: React.ReactNode;
}

interface Simulation {
  id: string;
  title: string;
  description: string;
  scenarios: string[];
  coverage: number;
  performance: number;
  tokens: string | number;
  count?: number;
}

interface SimulationStepsProps {
  onComplete: (data: any) => void;
  initialStatus?: 'not-started' | 'in-progress' | 'completed';
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
  hideProgressBar?: boolean;
  onStart?: () => void;
}

const STEPS: SimulationStep[] = [
  {
    title: "Select Simulations",
    description: "Choose and customize simulation scenarios",
    icon: <Target className="h-5 w-5" />
  },
  {
    title: "Review & Run",
    description: "Confirm settings and start simulations",
    icon: <PlayCircle className="h-5 w-5" />
  }
];

const SIMULATION_INSIGHTS = [
  "Analyzing agent purpose and industry context...",
  "Extracting key user personas from data...",
  "Identifying common interaction patterns...",
  "Processing call recordings for tone and content...",
  "Mapping customer journey touchpoints...",
  "Designing scenarios for maximum coverage...",
  "Calibrating difficulty levels across scenarios...",
  "Optimizing for performance metrics...",
  "Generating diverse conversation flows...",
  "Creating edge cases for thorough testing...",
  "Finalizing simulation parameters..."
];

const EXPANDED_SIMULATIONS: Simulation[] = [
  {
    id: "1",
    title: "Schedule Appointment",
    description: "Test appointment scheduling flow",
    scenarios: [
      "New customer scheduling first appointment",
      "Angry customer rescheduling",
      "Customer with poor connection",
      "Customer hanging up mid-conversation",
      "Customer with background noise"
    ],
    coverage: 35,
    performance: 40,
    tokens: "2500",
    count: 1
  },
  {
    id: "2",
    title: "Product Inquiry",
    description: "Handle product-related questions",
    scenarios: [
      "Technical product questions",
      "Price comparisons",
      "Feature inquiries",
      "Product availability check"
    ],
    coverage: 25,
    performance: 30,
    tokens: "2000",
    count: 1
  },
  {
    id: "3",
    title: "Troubleshooting",
    description: "Resolve technical issues and customer problems",
    scenarios: [
      "Basic troubleshooting steps",
      "Complex technical problem",
      "Frustrated customer with recurring issue",
      "Service outage explanation"
    ],
    coverage: 20,
    performance: 25,
    tokens: "1800",
    count: 1
  },
  {
    id: "4",
    title: "Billing Questions",
    description: "Handle payment and invoice inquiries",
    scenarios: [
      "Billing cycle explanation",
      "Disputed charge",
      "Payment method update",
      "Invoice request",
      "Late payment discussion"
    ],
    coverage: 15,
    performance: 20,
    tokens: "1700",
    count: 1
  },
  {
    id: "5",
    title: "Order Status",
    description: "Provide updates on order processing and delivery",
    scenarios: [
      "Check order status",
      "Delivery delay explanation",
      "Order modification request",
      "Lost package handling"
    ],
    coverage: 18,
    performance: 22,
    tokens: "1900",
    count: 1
  },
  {
    id: "6",
    title: "Returns and Refunds",
    description: "Process return requests and issue refunds",
    scenarios: [
      "Return policy explanation",
      "Damaged product return",
      "Refund status inquiry",
      "Exchange process"
    ],
    coverage: 12,
    performance: 18,
    tokens: "1600",
    count: 1
  },
  {
    id: "7",
    title: "Account Management",
    description: "Help with account-related tasks and questions",
    scenarios: [
      "Password reset assistance",
      "Account upgrade discussion",
      "Account verification",
      "Profile update help"
    ],
    coverage: 10,
    performance: 15,
    tokens: "1500",
    count: 1
  },
  {
    id: "8",
    title: "Feature Onboarding",
    description: "Guide customers through new features",
    scenarios: [
      "First-time user guidance",
      "Advanced feature tutorial",
      "Mobile app walkthrough",
      "Integration explanation"
    ],
    coverage: 22,
    performance: 28,
    tokens: "2100",
    count: 1
  },
  {
    id: "9",
    title: "Complaint Handling",
    description: "Address and resolve customer complaints",
    scenarios: [
      "Service quality complaint",
      "Employee behavior complaint",
      "Long wait time complaint",
      "Repeated issues complaint"
    ],
    coverage: 30,
    performance: 35,
    tokens: "2300",
    count: 1
  },
  {
    id: "10",
    title: "Cross-selling Opportunities",
    description: "Identify and present related products",
    scenarios: [
      "Complementary product suggestion",
      "Upgrade opportunity",
      "New service introduction",
      "Loyalty program enrollment"
    ],
    coverage: 28,
    performance: 33,
    tokens: "2200",
    count: 1
  }
];

const LOADING_CAPTIONS = [
  "Analyzing your agent purpose...",
  "Studying your industry context...",
  "Mapping user personas...",
  "Processing call recordings...",
  "Crafting simulation scenarios...",
  "Optimizing difficulty levels...",
  "Balancing conversation flows...",
  "Finalizing simulations..."
];

export const SimulationSteps = ({ 
  onComplete, 
  initialStatus = 'not-started', 
  coverage: initialCoverage, 
  performance: initialPerformance,
  scenarios: initialScenarios,
  simulations: initialSimulations,
  hideProgressBar,
  onStart
}: SimulationStepsProps) => {
  const [currentStep, setCurrentStep] = useState(initialStatus === 'not-started' ? 0 : initialStatus === 'in-progress' ? 0 : 1);
  const [selectedSimulations, setSelectedSimulations] = useState<string[]>([]);
  const [simulationCount, setSimulationCount] = useState(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [currentInsight, setCurrentInsight] = useState(0);
  const [simulationsGenerated, setSimulationsGenerated] = useState(false);
  const [availableSimulations, setAvailableSimulations] = useState<Simulation[]>([]);
  const [loadingCaption, setLoadingCaption] = useState(LOADING_CAPTIONS[0]);
  const [loadingCaptionIndex, setLoadingCaptionIndex] = useState(0);
  const [simulationCounts, setSimulationCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (initialScenarios && initialScenarios.length > 0) {
      const simulationIds = EXPANDED_SIMULATIONS
        .filter(sim => sim.scenarios.some(scenario => 
          initialScenarios.some(initScenario => 
            scenario.includes(initScenario.name)
          )
        ))
        .map(sim => sim.id);
      
      setSelectedSimulations(simulationIds);
    }
  }, [initialScenarios]);

  useEffect(() => {
    if (isGenerating) {
      const interval = setInterval(() => {
        setLoadingCaptionIndex(prev => {
          const newIndex = (prev + 1) % LOADING_CAPTIONS.length;
          setLoadingCaption(LOADING_CAPTIONS[newIndex]);
          return newIndex;
        });
      }, 2500);
      
      return () => clearInterval(interval);
    }
  }, [isGenerating]);

  const toggleSimulation = (id: string) => {
    setSelectedSimulations(prev => 
      prev.includes(id) 
        ? prev.filter(simId => simId !== id)
        : [...prev, id]
    );
    
    if (!simulationCounts[id]) {
      setSimulationCounts(prev => ({
        ...prev,
        [id]: 1
      }));
    }
  };

  const updateSimulationCount = (id: string, count: number) => {
    const validCount = Math.max(1, count);
    setSimulationCounts(prev => ({
      ...prev,
      [id]: validCount
    }));
  };

  const calculateTotals = () => {
    return availableSimulations
      .filter(sim => selectedSimulations.includes(sim.id))
      .reduce((acc, sim) => {
        const count = simulationCounts[sim.id] || 1;
        const tokenValue = typeof sim.tokens === 'string' ? parseInt(sim.tokens) : sim.tokens;
        return {
          coverage: acc.coverage + sim.coverage,
          performance: acc.performance + sim.performance,
          tokens: acc.tokens + (tokenValue * count)
        };
      }, { coverage: 0, performance: 0, tokens: 0 });
  };

  const canProceed = () => {
    if (currentStep === 0) {
      return selectedSimulations.length > 0;
    }
    return true;
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      if (currentStep === 0 && !simulationsGenerated) {
        setIsGenerating(true);
        startGenerationAnimation();
      } else {
        setCurrentStep(prev => prev + 1);
      }
    } else {
      onComplete({
        selectedSimulations,
        simulationCount
      });
    }
  };

  const startGenerationAnimation = () => {
    setGenerationProgress(0);
    setCurrentInsight(0);
    
    let progress = 0;
    const insightInterval = setInterval(() => {
      setCurrentInsight(prev => {
        if (prev < SIMULATION_INSIGHTS.length - 1) {
          return prev + 1;
        }
        return prev;
      });
    }, 1800);
    
    const progressInterval = setInterval(() => {
      progress += 1;
      setGenerationProgress(progress);
      
      if (progress >= 100) {
        clearInterval(progressInterval);
        clearInterval(insightInterval);
        
        setTimeout(() => {
          setIsGenerating(false);
          setSimulationsGenerated(true);
          setAvailableSimulations(EXPANDED_SIMULATIONS);
        }, 500);
      }
    }, 100);
  };

  const handleGenerateSimulations = () => {
    setIsGenerating(true);
    startGenerationAnimation();
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        if (isGenerating) {
          return (
            <div className="space-y-8 py-4 animate-fade-in">
              <div className="text-center space-y-4">
                <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-full">
                  <BrainCircuit className="h-10 w-10 text-primary animate-pulse" />
                </div>
                <h3 className="text-xl font-medium">Generating Your Simulations</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  We're analyzing your inputs to create the most effective simulation scenarios for your agent.
                </p>
              </div>
              
              <div className="max-w-md mx-auto space-y-6">
                <Progress value={generationProgress} className="h-2" />
                <div className="flex items-center px-4 py-3 rounded-lg border bg-card">
                  <div className="mr-4">
                    {currentInsight <= 2 ? (
                      <PenLine className="h-5 w-5 text-blue-500" />
                    ) : currentInsight <= 5 ? (
                      <Users2 className="h-5 w-5 text-violet-500" />
                    ) : currentInsight <= 8 ? (
                      <Bot className="h-5 w-5 text-orange-500" />
                    ) : (
                      <Lightbulb className="h-5 w-5 text-green-500" />
                    )}
                  </div>
                  <p className="text-sm font-medium">{SIMULATION_INSIGHTS[currentInsight]}</p>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2 px-4 py-3 rounded-lg border bg-card">
                    <Building className="h-4 w-4 text-primary" />
                    <span className="text-sm">Analyzing industry context</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-3 rounded-lg border bg-card">
                    <Phone className="h-4 w-4 text-primary" />
                    <span className="text-sm">Processing call recordings</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-3 rounded-lg border bg-card">
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="text-sm">Creating varied scenarios</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-3 rounded-lg border bg-card">
                    <Database className="h-4 w-4 text-primary" />
                    <span className="text-sm">Optimizing token usage</span>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        if (!simulationsGenerated) {
          return (
            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-800 rounded-lg p-8 mb-8 text-center">
                <Target className="h-12 w-12 text-gray-500 mx-auto mb-4" />
                <h4 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-2">Generate Simulations</h4>
                <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
                  Generate simulation scenarios to test your agent's performance under different conditions.
                </p>
                <div className="flex justify-center">
                  <Button 
                    className="gap-2 bg-primary"
                    onClick={handleGenerateSimulations}
                  >
                    <PlayCircle className="h-4 w-4" />
                    Generate Simulations
                  </Button>
                </div>
              </div>
            </div>
          );
        }

        const totals = calculateTotals();
        return (
          <div className="space-y-4 animate-fade-in">
            {simulationsGenerated && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900 rounded-lg p-4 mb-6 flex items-center gap-3">
                <div className="bg-green-100 dark:bg-green-800/30 p-2 rounded-full">
                  <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-400">Simulations Generated Successfully</p>
                  <p className="text-xs text-green-700 dark:text-green-500 mt-0.5">
                    {availableSimulations.length} simulations created based on your inputs
                  </p>
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-3 gap-4 mb-6">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center">
                    <div className="flex items-center justify-center mb-2">
                      <Percent className="h-5 w-5 text-blue-500" />
                    </div>
                    <div className="text-2xl font-bold text-primary">
                      {totals.coverage}%
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Coverage
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center">
                    <div className="flex items-center justify-center mb-2">
                      <BarChart className="h-5 w-5 text-purple-500" />
                    </div>
                    <div className="text-2xl font-bold text-primary">
                      {totals.performance}%
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Performance
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center">
                    <div className="flex items-center justify-center mb-2">
                      <Zap className="h-5 w-5 text-yellow-500" />
                    </div>
                    <div className="text-2xl font-bold text-primary">
                      {totals.tokens.toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Tokens
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              {availableSimulations.map((sim) => (
                <Card
                  key={sim.id}
                  className={`cursor-pointer transition-colors ${
                    selectedSimulations.includes(sim.id)
                      ? "border-primary"
                      : "hover:border-primary/50"
                  }`}
                  onClick={() => toggleSimulation(sim.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium">{sim.title}</h3>
                        <p className="text-sm text-muted-foreground">
                          {sim.description}
                        </p>
                      </div>
                      {selectedSimulations.includes(sim.id) && (
                        <Check className="h-5 w-5 text-primary" />
                      )}
                    </div>
                    <div className="mt-4">
                      <Label className="text-xs">Scenarios:</Label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {sim.scenarios.map((scenario, index) => (
                          <Badge
                            key={index}
                            variant="secondary"
                            className="text-xs"
                          >
                            {scenario}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                      <div className="flex items-center gap-1">
                        <Percent className="h-3 w-3 text-blue-500" />
                        <span className="text-muted-foreground">Coverage:</span>
                        <span className="font-medium">+{sim.coverage}%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <BarChart className="h-3 w-3 text-purple-500" />
                        <span className="text-muted-foreground">Performance:</span>
                        <span className="font-medium">+{sim.performance}%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Zap className="h-3 w-3 text-yellow-500" />
                        <span className="text-muted-foreground">Tokens:</span>
                        <span className="font-medium">{sim.tokens}</span>
                      </div>
                    </div>
                    
                    {selectedSimulations.includes(sim.id) && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <div className="flex items-center justify-between">
                          <Label htmlFor={`sim-count-${sim.id}`} className="text-xs">Simulation Runs:</Label>
                          <div className="flex items-center w-24">
                            <Input
                              id={`sim-count-${sim.id}`}
                              type="number"
                              value={simulationCounts[sim.id] || 1}
                              onChange={(e) => {
                                e.stopPropagation();
                                updateSimulationCount(sim.id, parseInt(e.target.value) || 1);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              min={1}
                              max={20}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        <div className="mt-2 text-xs flex justify-between">
                          <span className="text-muted-foreground">Total tokens:</span>
                          <span className="font-medium">
                            {(typeof sim.tokens === 'string' 
                              ? parseInt(sim.tokens) * (simulationCounts[sim.id] || 1)
                              : sim.tokens * (simulationCounts[sim.id] || 1)).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );

      case 1:
        const finalTotals = calculateTotals();
        return (
          <div className="space-y-6">
            <div className="rounded-lg border p-4">
              <h3 className="font-medium mb-4">Summary</h3>
              <div className="space-y-4">
                <div className="flex justify-between">
                  <span>Selected Simulations:</span>
                  <span>{selectedSimulations.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Scenarios:</span>
                  <span>
                    {availableSimulations
                      .filter(sim => selectedSimulations.includes(sim.id))
                      .reduce((acc, sim) => acc + sim.scenarios.length, 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Expected Coverage:</span>
                  <span>{finalTotals.coverage}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Performance Impact:</span>
                  <span>{finalTotals.performance}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Token Usage:</span>
                  <span>{finalTotals.tokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Simulation Runs:</span>
                  <span>
                    {selectedSimulations.reduce((total, simId) => total + (simulationCounts[simId] || 1), 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
    }
  };

  if (initialStatus === 'completed') {
    return (
      <div className="space-y-6">
        <div className="bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30 rounded-lg p-4 mb-6 flex items-center gap-3">
          <div className="bg-green-100 dark:bg-green-800/30 p-2 rounded-full">
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-green-800 dark:text-green-400">Simulations Completed Successfully</p>
            <p className="text-xs text-green-700 dark:text-green-500 mt-0.5">
              All selected simulations have been processed
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="flex items-center justify-center mb-2">
                  <Percent className="h-5 w-5 text-blue-500" />
                </div>
                <div className="text-2xl font-bold text-primary">
                  {initialCoverage || 85}%
                </div>
                <div className="text-sm text-muted-foreground">
                  Coverage
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="flex items-center justify-center mb-2">
                  <BarChart className="h-5 w-5 text-purple-500" />
                </div>
                <div className="text-2xl font-bold text-primary">
                  {initialPerformance || 92}%
                </div>
                <div className="text-sm text-muted-foreground">
                  Performance
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="flex items-center justify-center mb-2">
                  <Zap className="h-5 w-5 text-yellow-500" />
                </div>
                <div className="text-2xl font-bold text-primary">
                  {initialSimulations ? 
                    initialSimulations.reduce((total, sim) => {
                      const tokenValue = typeof sim.tokens === 'string' 
                        ? parseInt(sim.tokens.replace(/[^\d]/g, ''))
                        : sim.tokens;
                      return total + tokenValue;
                    }, 0).toLocaleString() :
                    "45,200"
                  }
                </div>
                <div className="text-sm text-muted-foreground">
                  Tokens
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {!hideProgressBar && <Progress value={100} className="h-2 mb-6" />}

        <div className="mb-6">
          <h4 className="font-medium text-gray-900 dark:text-white mb-4">Completed Simulations</h4>
          <div className="space-y-4">
            {initialSimulations ? initialSimulations.map((sim) => (
              <Card key={sim.id} className="border-gray-200 dark:border-gray-800">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-medium">{sim.name}</h3>
                      <p className="text-xs text-muted-foreground">{sim.date}</p>
                    </div>
                    <Badge variant="outline" className="bg-green-50 text-green-600 dark:bg-green-900/20 border-green-200">
                      Completed
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <Percent className="h-3 w-3 text-blue-500" />
                      <span className="text-muted-foreground">Coverage:</span>
                      <span className="font-medium">{sim.coverage}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <BarChart className="h-3 w-3 text-purple-500" />
                      <span className="text-muted-foreground">Performance:</span>
                      <span className="font-medium">{sim.performance}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Zap className="h-3 w-3 text-yellow-500" />
                      <span className="text-muted-foreground">Tokens:</span>
                      <span className="font-medium">{sim.tokens}</span>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <File className="h-3 w-3 text-gray-500" />
                      <span className="text-xs text-muted-foreground">Scenarios:</span>
                      <span className="text-xs font-medium">{sim.scenarios}</span>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                      View Details
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )) : (
              <div className="text-center py-6 text-muted-foreground">
                No simulation results available
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => onComplete({ action: "view-results" })}>
            View Detailed Reports
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-8">
        {STEPS.map((step, index) => (
          <React.Fragment key={index}>
            <div
              className={`flex items-center gap-2 ${
                index <= currentStep ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  index <= currentStep
                    ? "bg-primary text-white"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {step.icon}
              </div>
              <div className="hidden sm:block">
                <div className="text-sm font-medium">{step.title}</div>
                <div className="text-xs text-muted-foreground">
                  {step.description}
                </div>
              </div>
            </div>
            {index < STEPS.length - 1 && (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </React.Fragment>
        ))}
      </div>

      {!hideProgressBar && <Progress value={((currentStep + 1) / STEPS.length) * 100} />}

      <div className="mt-8">{renderStepContent()}</div>

      <div className="flex justify-end gap-4 mt-6">
        {currentStep > 0 && !isGenerating && (
          <Button
            variant="outline"
            onClick={() => setCurrentStep((prev) => prev - 1)}
          >
            Back
          </Button>
        )}
        <Button
          onClick={handleNext}
          disabled={!canProceed() || isGenerating}
          className={isGenerating ? "min-w-[180px]" : ""}
        >
          {isGenerating ? (
            <div className="flex items-center">
              <div className="relative mr-3">
                <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
                <BrainCircuit className="absolute inset-0 h-3 w-3 m-auto text-white" />
              </div>
              <span className="text-sm">{loadingCaption}</span>
            </div>
          ) : currentStep === STEPS.length - 1 ? "Start Simulations" : "Continue"}
        </Button>
      </div>
    </div>
  );
};
