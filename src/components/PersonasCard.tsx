import React, { useState } from "react";
import { 
  Users, ChevronUp, CheckCircle2, CircleDashed, 
  Trash2, ArrowRight, PlusCircle, User, UserRound
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

interface Persona {
  id: string;
  name: string;
  role: string;
  age: string;
  description: string;
  pain_points: string[];
  goals: string[];
}

interface PersonasCardProps {
  status: 'not-started' | 'in-progress' | 'completed';
  personas?: Persona[];
  generatedCount?: number;
  totalCount?: number;
}

export const PersonasCard: React.FC<PersonasCardProps> = ({
  status,
  personas = [],
  generatedCount = 0,
  totalCount = 10
}) => {
  const [isExpanded, setIsExpanded] = useState(status !== 'completed');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [audienceDescription, setAudienceDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateClick = () => {
    setIsDialogOpen(true);
  };

  const handleDialogClose = () => {
    setIsDialogOpen(false);
    setAudienceDescription("");
  };

  const handleGeneratePersonas = () => {
    if (!audienceDescription.trim()) {
      toast({
        title: "Description Required",
        description: "Please provide a description of your target audience",
        variant: "destructive"
      });
      return;
    }

    setIsGenerating(true);
    // Simulate persona generation
    setTimeout(() => {
      setIsGenerating(false);
      setIsDialogOpen(false);
      setAudienceDescription("");
      toast({
        title: "Personas Generated",
        description: "Your personas are being created based on your description",
      });
    }, 2000);
  };

  return (
    <div className="rounded-lg overflow-hidden mb-6 border border-gray-200 dark:border-gray-800">
      <div className="p-6 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 w-8 h-8 text-gray-900 dark:text-white">
              2
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Create Personas</h3>
            {status === 'in-progress' && (
              <Badge variant="outline" className="bg-amber-500/20 text-amber-500 dark:text-amber-400 border-amber-500/30 ml-2">
                In Progress
              </Badge>
            )}
            {status === 'completed' && (
              <Badge variant="outline" className="bg-green-500/20 text-green-500 dark:text-green-400 border-green-500/30 ml-2">
                Completed
              </Badge>
            )}
            {status === 'not-started' && (
              <Badge variant="outline" className="bg-gray-500/20 text-gray-500 dark:text-gray-400 border-gray-500/30 ml-2">
                Not Started
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {status === 'in-progress' && <span className="text-sm text-gray-500 dark:text-gray-400">{Math.round((generatedCount / totalCount) * 100)}%</span>}
            {status === 'completed' && <span className="text-sm text-gray-500 dark:text-gray-400">100%</span>}
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white"
            >
              <ChevronUp className={`h-5 w-5 ${!isExpanded ? 'transform rotate-180' : ''}`} />
            </Button>
          </div>
        </div>
        
        <p className="text-gray-700 dark:text-gray-300 mb-4">
          Define user personas to help your agent understand your target audience
        </p>
        
        {status !== 'not-started' && (
          <Progress 
            value={status === 'completed' ? 100 : Math.round((generatedCount / totalCount) * 100)} 
            className="h-1.5 mb-6" 
          />
        )}
        
        {isExpanded && (
          <>
            {status === 'not-started' && (
              <div className="bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-800 rounded-lg p-8 mb-8 text-center">
                <Users className="h-12 w-12 text-gray-500 mx-auto mb-4" />
                <h4 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-2">No personas created yet</h4>
                <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
                  Create personas that represent your target users to help your agent better understand their needs and pain points.
                </p>
                <div className="flex justify-center">
                  <Button 
                    className="gap-2 bg-primary"
                    onClick={handleGenerateClick}
                  >
                    <PlusCircle className="h-4 w-4" />
                    Generate Personas
                  </Button>
                </div>
              </div>
            )}

            {status === 'in-progress' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-gray-50 dark:bg-gray-800/30 p-6 rounded-lg border border-gray-200 dark:border-gray-800/50 flex flex-col">
                    <div className="flex items-center gap-2 mb-1 text-gray-500 dark:text-gray-400">
                      <User className="h-4 w-4" />
                      <span className="text-xs font-medium">Personas Created</span>
                    </div>
                    <div className="flex items-end justify-between mt-auto">
                      <div className="text-3xl font-bold text-gray-900 dark:text-white">{generatedCount}/{totalCount}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">Target personas</div>
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800/30 p-6 rounded-lg border border-gray-200 dark:border-gray-800/50 flex flex-col">
                    <div className="flex items-center gap-2 mb-1 text-gray-500 dark:text-gray-400">
                      <CircleDashed className="h-4 w-4" />
                      <span className="text-xs font-medium">Processing</span>
                    </div>
                    <div className="flex items-end justify-between mt-auto">
                      <div className="text-3xl font-bold text-gray-900 dark:text-white">{Math.round((generatedCount / totalCount) * 100)}%</div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">Generation progress</div>
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800/30 p-6 rounded-lg border border-gray-200 dark:border-gray-800/50 flex flex-col">
                    <div className="flex items-center gap-2 mb-1 text-gray-500 dark:text-gray-400">
                      <Users className="h-4 w-4" />
                      <span className="text-xs font-medium">Remaining</span>
                    </div>
                    <div className="flex items-end justify-between mt-auto">
                      <div className="text-3xl font-bold text-gray-900 dark:text-white">{totalCount - generatedCount}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">Personas to create</div>
                    </div>
                  </div>
                </div>

                <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg p-4 mb-6">
                  <div className="flex items-start gap-3">
                    <div className="bg-amber-100 dark:bg-amber-900/20 p-2 rounded-full">
                      <ArrowRight className="h-4 w-4 text-amber-500" />
                    </div>
                    <div>
                      <h4 className="font-medium mb-1 text-gray-900 dark:text-white">Processing: {generatedCount} of {totalCount} personas created</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Personas are being generated based on your agent's knowledge base.</p>
                    </div>
                  </div>
                </div>

                <div className="mb-6">
                  <h4 className="font-medium text-gray-900 dark:text-white mb-4">Generated Personas</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {personas.map((persona) => (
                      <Card key={persona.id} className="p-4 border border-gray-200 dark:border-gray-800">
                        <div className="flex items-start justify-between">
                          <div className="flex gap-3">
                            <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded-full h-10 w-10 flex items-center justify-center">
                              <UserRound className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                            </div>
                            <div>
                              <h5 className="font-medium text-gray-900 dark:text-white">{persona.name}</h5>
                              <p className="text-xs text-gray-500 dark:text-gray-500">{persona.role} • {persona.age}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">{persona.description}</p>
                        
                        <div className="mt-3">
                          <h6 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Pain Points:</h6>
                          <div className="flex flex-wrap gap-1">
                            {persona.pain_points.map((point, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/30">
                                {point}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        
                        <div className="mt-3">
                          <h6 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Goals:</h6>
                          <div className="flex flex-wrap gap-1">
                            {persona.goals.map((goal, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs bg-green-50 dark:bg-green-900/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800/30">
                                {goal}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>

                <div className="flex justify-center mb-6">
                  <Button 
                    className="gap-2 bg-primary"
                    onClick={handleGenerateClick}
                  >
                    <PlusCircle className="h-4 w-4" />
                    Generate More Personas
                  </Button>
                </div>
              </>
            )}

            {status === 'completed' && (
              <>
                <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/30 rounded-lg p-4 mb-6">
                  <div className="flex items-start gap-3">
                    <div className="bg-green-100 dark:bg-green-900/20 p-2 rounded-full">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </div>
                    <div>
                      <h4 className="font-medium mb-1 text-gray-900 dark:text-white">Completed: All 10 personas created</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">You've successfully created all required user personas for your agent.</p>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-gray-50 dark:bg-gray-800/30 p-6 rounded-lg border border-gray-200 dark:border-gray-800/50 flex flex-col">
                    <div className="flex items-center gap-2 mb-1 text-gray-500 dark:text-gray-400">
                      <User className="h-4 w-4" />
                      <span className="text-xs font-medium">Personas Created</span>
                    </div>
                    <div className="flex items-end justify-between mt-auto">
                      <div className="text-3xl font-bold text-gray-900 dark:text-white">{totalCount}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">Target personas</div>
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800/30 p-6 rounded-lg border border-gray-200 dark:border-gray-800/50 flex flex-col">
                    <div className="flex items-center gap-2 mb-1 text-gray-500 dark:text-gray-400">
                      <Users className="h-4 w-4" />
                      <span className="text-xs font-medium">Coverage</span>
                    </div>
                    <div className="flex items-end justify-between mt-auto">
                      <div className="text-3xl font-bold text-gray-900 dark:text-white">100%</div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">Audience coverage</div>
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800/30 p-6 rounded-lg border border-gray-200 dark:border-gray-800/50 flex flex-col">
                    <div className="flex items-center gap-2 mb-1 text-gray-500 dark:text-gray-400">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-xs font-medium">Quality</span>
                    </div>
                    <div className="flex items-end justify-between mt-auto">
                      <div className="text-3xl font-bold text-gray-900 dark:text-white">High</div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">Persona quality</div>
                    </div>
                  </div>
                </div>
                
                <div className="mb-6">
                  <h4 className="font-medium text-gray-900 dark:text-white mb-4">All Personas</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {personas.map((persona) => (
                      <Card key={persona.id} className="p-4 border border-gray-200 dark:border-gray-800">
                        <div className="flex items-start justify-between">
                          <div className="flex gap-3">
                            <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded-full h-10 w-10 flex items-center justify-center">
                              <UserRound className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                            </div>
                            <div>
                              <h5 className="font-medium text-gray-900 dark:text-white">{persona.name}</h5>
                              <p className="text-xs text-gray-500 dark:text-gray-500">{persona.role} • {persona.age}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">{persona.description}</p>
                        
                        <div className="mt-3">
                          <h6 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Pain Points:</h6>
                          <div className="flex flex-wrap gap-1">
                            {persona.pain_points.map((point, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/30">
                                {point}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        
                        <div className="mt-3">
                          <h6 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Goals:</h6>
                          <div className="flex flex-wrap gap-1">
                            {persona.goals.map((goal, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs bg-green-50 dark:bg-green-900/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800/30">
                                {goal}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>

                <div className="flex justify-center mb-6">
                  <Button 
                    className="gap-2"
                    onClick={handleGenerateClick}
                  >
                    <PlusCircle className="h-4 w-4" />
                    Generate Additional Personas
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[525px]">
          <DialogHeader>
            <DialogTitle>Describe Your Target Audience</DialogTitle>
            <DialogDescription>
              Provide details about who your typical users are to help generate accurate personas.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <Textarea 
              placeholder="Example: Our audience includes working professionals aged 30-45 in the finance industry who need help with investment decisions. They are typically pressed for time, technically savvy, and concerned about financial security."
              rows={6}
              className="w-full resize-none"
              value={audienceDescription}
              onChange={(e) => setAudienceDescription(e.target.value)}
            />
          </div>
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={handleDialogClose}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleGeneratePersonas}
              disabled={isGenerating}
              className="bg-primary"
            >
              {isGenerating ? "Generating..." : "Generate Personas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
