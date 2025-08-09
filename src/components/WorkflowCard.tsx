
import React, { useState, useRef } from "react";
import { 
  ArrowRight, Play, MessageSquare, Database, Mail, Calendar, Trash2, 
  Edit, MoreHorizontal, CheckCircle2, Clock, ChevronUp, PlusCircle,
  Eye, Bot
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Define workflow interface
export interface Workflow {
  id: string;
  title: string;
  description: string;
  createdDate: string;
  isActive: boolean;
  steps: WorkflowStep[];
}

interface WorkflowStep {
  id: string;
  appName: string;
  iconComponent: React.ReactNode;
}

interface WorkflowCardProps {
  status: 'not-started' | 'in-progress' | 'completed';
  workflows?: Workflow[];
  processedCount?: number;
  totalCount?: number;
  stepNumber?: number;
  onStart?: () => void;
  onComplete?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export const WorkflowCard: React.FC<WorkflowCardProps> = ({ 
  status = 'not-started',
  workflows = [],
  processedCount = 0,
  totalCount = 0,
  stepNumber = 4,
  onStart,
  onComplete,
  isExpanded: controlledExpanded,
  onToggleExpand
}) => {
  // Let parent component control expanded state if provided
  const [localExpanded, setLocalExpanded] = useState(status !== 'completed');
  
  // Use either controlled or uncontrolled state
  const isExpanded = onToggleExpand ? controlledExpanded : localExpanded;
  
  const handleToggleExpand = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      setLocalExpanded(!localExpanded);
    }
  };

  // Sample workflow icons mapping
  const getIconForApp = (appName: string) => {
    switch (appName.toLowerCase()) {
      case 'chat':
        return <MessageSquare className="h-5 w-5 text-purple-500" />;
      case 'email':
        return <Mail className="h-5 w-5 text-blue-500" />;
      case 'database':
        return <Database className="h-5 w-5 text-green-500" />;
      case 'calendar':
        return <Calendar className="h-5 w-5 text-orange-500" />;
      case 'agent':
        return <Bot className="h-5 w-5 text-indigo-500" />;
      default:
        return <MessageSquare className="h-5 w-5 text-gray-500" />;
    }
  };

  return (
    <div className="rounded-lg overflow-hidden mb-6 border border-gray-200 dark:border-gray-800">
      <div className="p-6 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 w-8 h-8 text-gray-900 dark:text-white">
              {stepNumber}
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Workflow</h3>
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
            {status === 'in-progress' && <span className="text-sm text-gray-500 dark:text-gray-400">40%</span>}
            {status === 'completed' && <span className="text-sm text-gray-500 dark:text-gray-400">100%</span>}
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleToggleExpand}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white"
            >
              <ChevronUp className={`h-5 w-5 ${!isExpanded ? 'transform rotate-180' : ''}`} />
            </Button>
          </div>
        </div>
        
        <p className="text-gray-700 dark:text-gray-300 mb-4">
          Design and customize your agent's conversation flow, set active hours, and configure handoff triggers
        </p>
        
        {status !== 'not-started' && (
          <Progress 
            value={status === 'completed' ? 100 : 40} 
            className="h-1.5 mb-6" 
          />
        )}
        
        {isExpanded && (
          <>
            {status === 'not-started' && (
              <div className="bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-800 rounded-lg p-8 mb-8 text-center">
                <Play className="h-12 w-12 text-gray-500 mx-auto mb-4" />
                <h4 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-2">No workflows created yet</h4>
                <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
                  Create your first workflow to automate your agent's conversation flow and integrations.
                </p>
                <div className="flex justify-center gap-4">
                  <Button 
                    className="gap-2 bg-gradient-to-r from-purple-500 to-indigo-500"
                    onClick={onStart}
                  >
                    <PlusCircle className="h-4 w-4" />
                    Create Workflow
                  </Button>
                </div>
              </div>
            )}

            {status === 'in-progress' && (
              <>
                <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg p-4 mb-6">
                  <div className="flex items-start gap-3">
                    <div className="bg-amber-100 dark:bg-amber-900/20 p-2 rounded-full">
                      <ArrowRight className="h-4 w-4 text-amber-500" />
                    </div>
                    <div>
                      <h4 className="font-medium mb-1 text-gray-900 dark:text-white">Progress: 2 of 5 workflows created</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Create more workflows or finish configuring existing ones.</p>
                    </div>
                  </div>
                </div>

                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium text-gray-900 dark:text-white">Automation Workflows</h4>
                    <Button size="sm" variant="outline" className="gap-2">
                      <PlusCircle className="h-3.5 w-3.5" />
                      Add Workflow
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {/* Workflow Item 1 */}
                    <div className="bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="flex items-center">
                              <div className="bg-blue-100 dark:bg-blue-900/20 p-1.5 rounded-full">
                                {getIconForApp('email')}
                              </div>
                              <ArrowRight className="h-4 w-4 text-gray-400 mx-1" />
                              <div className="bg-green-100 dark:bg-green-900/20 p-1.5 rounded-full">
                                {getIconForApp('database')}
                              </div>
                            </div>
                            <h5 className="font-medium text-gray-900 dark:text-white">Lead Capture to CRM</h5>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Automatically creates a new lead in your CRM when a contact form is submitted
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">OFF</span>
                            <Switch />
                            <span className="text-xs text-gray-500">ON</span>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2">
                                <Edit className="h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2">
                                <Eye className="h-4 w-4" />
                                View
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2 text-red-500 hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                                Deactivate
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">
                        Created Mar 15, 2024
                      </div>
                    </div>

                    {/* Workflow Item 2 */}
                    <div className="bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="flex items-center">
                              <div className="bg-purple-100 dark:bg-purple-900/20 p-1.5 rounded-full">
                                {getIconForApp('chat')}
                              </div>
                              <ArrowRight className="h-4 w-4 text-gray-400 mx-1" />
                              <div className="bg-orange-100 dark:bg-orange-900/20 p-1.5 rounded-full">
                                {getIconForApp('calendar')}
                              </div>
                            </div>
                            <h5 className="font-medium text-gray-900 dark:text-white">Meeting Scheduler</h5>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Schedule meetings automatically when customers request appointments via chat
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">OFF</span>
                            <Switch checked={true} />
                            <span className="text-xs text-gray-500">ON</span>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2">
                                <Edit className="h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2">
                                <Eye className="h-4 w-4" />
                                View
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2 text-red-500 hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                                Deactivate
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">
                        Created Mar 18, 2024
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex justify-end mb-6">
                  <Button 
                    onClick={onComplete}
                    className="gap-2 bg-gradient-to-r from-green-500 to-emerald-500"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Complete Setup
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
                      <h4 className="font-medium mb-1 text-gray-900 dark:text-white">Completed: All workflows configured</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Your agent's workflows are fully configured and ready to use.</p>
                    </div>
                  </div>
                </div>
                
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium text-gray-900 dark:text-white">Automation Workflows</h4>
                    <Button size="sm" variant="outline" className="gap-2">
                      <PlusCircle className="h-3.5 w-3.5" />
                      Add Workflow
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {/* Workflow Item 1 */}
                    <div className="bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="flex items-center">
                              <div className="bg-blue-100 dark:bg-blue-900/20 p-1.5 rounded-full">
                                {getIconForApp('email')}
                              </div>
                              <ArrowRight className="h-4 w-4 text-gray-400 mx-1" />
                              <div className="bg-green-100 dark:bg-green-900/20 p-1.5 rounded-full">
                                {getIconForApp('database')}
                              </div>
                            </div>
                            <h5 className="font-medium text-gray-900 dark:text-white">Lead Capture to CRM</h5>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Automatically creates a new lead in your CRM when a contact form is submitted
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">OFF</span>
                            <Switch checked={true} />
                            <span className="text-xs text-gray-500">ON</span>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2">
                                <Edit className="h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2">
                                <Eye className="h-4 w-4" />
                                View
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2 text-red-500 hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                                Deactivate
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">
                        Created Mar 15, 2024
                      </div>
                    </div>

                    {/* Workflow Item 2 */}
                    <div className="bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="flex items-center">
                              <div className="bg-purple-100 dark:bg-purple-900/20 p-1.5 rounded-full">
                                {getIconForApp('chat')}
                              </div>
                              <ArrowRight className="h-4 w-4 text-gray-400 mx-1" />
                              <div className="bg-orange-100 dark:bg-orange-900/20 p-1.5 rounded-full">
                                {getIconForApp('calendar')}
                              </div>
                            </div>
                            <h5 className="font-medium text-gray-900 dark:text-white">Meeting Scheduler</h5>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Schedule meetings automatically when customers request appointments via chat
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">OFF</span>
                            <Switch checked={true} />
                            <span className="text-xs text-gray-500">ON</span>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2">
                                <Edit className="h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2">
                                <Eye className="h-4 w-4" />
                                View
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2 text-red-500 hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                                Deactivate
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">
                        Created Mar 18, 2024
                      </div>
                    </div>

                    {/* Workflow Item 3 */}
                    <div className="bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="flex items-center">
                              <div className="bg-indigo-100 dark:bg-indigo-900/20 p-1.5 rounded-full">
                                {getIconForApp('agent')}
                              </div>
                              <ArrowRight className="h-4 w-4 text-gray-400 mx-1" />
                              <div className="bg-blue-100 dark:bg-blue-900/20 p-1.5 rounded-full">
                                {getIconForApp('email')}
                              </div>
                            </div>
                            <h5 className="font-medium text-gray-900 dark:text-white">Support Escalation</h5>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Escalates complex inquiries to human agents via email notification
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">OFF</span>
                            <Switch checked={true} />
                            <span className="text-xs text-gray-500">ON</span>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2">
                                <Edit className="h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2">
                                <Eye className="h-4 w-4" />
                                View
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer flex items-center gap-2 text-red-500 hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                                Deactivate
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">
                        Created Mar 22, 2024
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
