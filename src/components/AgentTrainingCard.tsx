
import React, { useState, useRef } from "react";
import { 
  Mic, Upload, CircleDashed, ArrowRight, Clock, BarChart, 
  ChevronUp, CheckCircle2, PlayCircle, User, Download, Trash2,
  FileAudio, PhoneCall, Bot, Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { RolePlayDialog } from "./RolePlayDialog";
import { UserPersonasSidebar } from "./UserPersonasSidebar";
import { CallInterface, RecordingData } from "./CallInterface";
import { toast } from "@/components/ui/use-toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface TrainingRecord {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: string;
  type: 'call' | 'roleplay';
  transcriptions?: string[];
}

interface AgentTrainingCardProps {
  status: 'not-started' | 'in-progress' | 'completed';
  stepNumber: number;
  isActive?: boolean;
  voiceSamples?: number;
  totalSamples?: number;
  voiceConfidence?: number;
  talkTime?: string;
  trainingRecords?: TrainingRecord[];
  onStart?: () => void;
  onComplete?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export const AgentTrainingCard: React.FC<AgentTrainingCardProps> = ({
  status,
  stepNumber,
  isActive = false,
  voiceSamples = 0,
  totalSamples = 10,
  voiceConfidence = 0,
  talkTime = '0s',
  trainingRecords = [],
  onStart,
  onComplete,
  isExpanded: controlledExpanded,
  onToggleExpand
}) => {
  const [localExpanded, setLocalExpanded] = useState(status !== 'completed');
  const isExpanded = onToggleExpand ? controlledExpanded : localExpanded;
  const [localStatus, setLocalStatus] = useState<'not-started' | 'in-progress' | 'completed'>(status);
  const [localTrainingRecords, setLocalTrainingRecords] = useState<TrainingRecord[]>(trainingRecords);
  const [localVoiceSamples, setLocalVoiceSamples] = useState(voiceSamples);
  const [localVoiceConfidence, setLocalVoiceConfidence] = useState(voiceConfidence);
  const [totalRecordingMinutes, setTotalRecordingMinutes] = useState(0);
  const targetMinutes = 10; // Set target to 10 minutes

  const handleToggleExpand = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      setLocalExpanded(!localExpanded);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openRolePlayDialog, setOpenRolePlayDialog] = useState(false);
  const [callRolePlayDialog, setCallRolePlayDialog] = useState(false);
  
  const [userPersonasSidebarOpen, setUserPersonasSidebarOpen] = useState(false);
  const [callInterfaceOpen, setCallInterfaceOpen] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<any>(null);
  const [directCallInfo, setDirectCallInfo] = useState<{
    phoneNumber: string;
    deviceSettings: { mic: string; speaker: string };
  } | null>(null);

  const handleStartDirectCall = (phoneNumber: string, deviceSettings: { mic: string; speaker: string }) => {
    setDirectCallInfo({ phoneNumber, deviceSettings });
    setCallInterfaceOpen(true);
    setUserPersonasSidebarOpen(false);
  };

  const durationToMinutes = (duration: string): number => {
    const [minutes, seconds] = duration.split(':').map(Number);
    return minutes + seconds / 60;
  };

  const calculateTotalMinutes = (records: TrainingRecord[]): number => {
    return records.reduce((total, record) => {
      return total + durationToMinutes(record.duration);
    }, 0);
  };

  const formatMinutes = (minutes: number): string => {
    return minutes.toFixed(1);
  };

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      console.log('Files selected:', files);
      const fileNames = Array.from(files).map(file => file.name);
      console.log('File names:', fileNames);
      
      if (localStatus === 'not-started') {
        setLocalStatus('in-progress');
        if (onStart) onStart();
      }
      
      const now = new Date();
      const newRecordings = Array.from(files).map((file, index) => {
        const minutes = Math.floor(Math.random() * 2) + 1;
        const seconds = Math.floor(Math.random() * 60);
        const duration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        return {
          id: Math.random().toString(36).substring(2, 9),
          title: `Uploaded Recording ${localTrainingRecords.length + index + 1}`,
          date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
          duration,
          type: 'call' as const
        };
      });
      
      const updatedRecords = [...localTrainingRecords, ...newRecordings];
      setLocalTrainingRecords(updatedRecords);
      
      const newTotalMinutes = calculateTotalMinutes(updatedRecords);
      setTotalRecordingMinutes(newTotalMinutes);
      setLocalVoiceSamples(prev => prev + files.length);
      setLocalVoiceConfidence(prev => Math.min(prev + 10, 95));
      
      toast({
        title: "Files uploaded successfully",
        description: `${files.length} recording${files.length > 1 ? 's' : ''} added to training data.`
      });
      
      if (newTotalMinutes >= targetMinutes && localStatus !== 'completed') {
        setLocalStatus('completed');
        if (onComplete) onComplete();
      }
    }
  };
  
  const handleSelectPersona = (persona: any) => {
    setSelectedPersona(persona);
    setUserPersonasSidebarOpen(false);
    setCallInterfaceOpen(true);
  };
  
  const handleCallComplete = (recordingData: RecordingData) => {
    if (localStatus === 'not-started') {
      setLocalStatus('in-progress');
      if (onStart) onStart();
    }
    
    const updatedRecords = [...localTrainingRecords, recordingData];
    setLocalTrainingRecords(updatedRecords);
    
    const newTotalMinutes = calculateTotalMinutes(updatedRecords);
    setTotalRecordingMinutes(newTotalMinutes);
    setLocalVoiceSamples(prev => prev + 1);
    setLocalVoiceConfidence(prev => Math.min(prev + 15, 95));
    
    toast({
      title: "Call recording saved",
      description: "The role-play session has been added to your training data."
    });
    
    if (newTotalMinutes >= targetMinutes && localStatus !== 'completed') {
      setLocalStatus('completed');
      if (onComplete) onComplete();
    }
  };
  
  const handleRemoveRecording = (id: string) => {
    const updatedRecords = localTrainingRecords.filter(record => record.id !== id);
    setLocalTrainingRecords(updatedRecords);
    
    const newTotalMinutes = calculateTotalMinutes(updatedRecords);
    setTotalRecordingMinutes(newTotalMinutes);
    setLocalVoiceSamples(prev => Math.max(prev - 1, 0));
    
    if (newTotalMinutes < targetMinutes && localStatus === 'completed') {
      setLocalStatus('in-progress');
    }
    
    toast({
      title: "Recording removed",
      description: "The recording has been removed from your training data."
    });
  };
  
  const handlePlayRecording = (record: TrainingRecord) => {
    toast({
      title: "Playing recording",
      description: `Now playing: ${record.title}`
    });
    
    console.log("Playing recording:", record);
  };

  React.useEffect(() => {
    const minutes = calculateTotalMinutes(localTrainingRecords);
    setTotalRecordingMinutes(minutes);
  }, []);

  const progressPercentage = localStatus === 'completed' 
    ? 100 
    : Math.min(Math.round((totalRecordingMinutes / targetMinutes) * 100), 100);

  return (
    <div className={`rounded-lg overflow-hidden mb-6 border transition-colors bg-bg ${
      isActive 
        ? 'border-brand-purple shadow-md border-2' 
        : 'border-border'
    }`}>
      <div className="p-6 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-full bg-bg-muted w-8 h-8 text-fg">
              {stepNumber}
            </div>
            <h3 className="text-xl font-semibold text-fg">Agent Training</h3>
            {localStatus === 'in-progress' && (
              <Badge variant="outline" className="bg-warning/20 text-warning border-warning/30 ml-2">
                In Progress
              </Badge>
            )}
            {localStatus === 'completed' && (
              <Badge variant="outline" className="bg-success/20 text-success border-success/30 ml-2">
                Completed
              </Badge>
            )}
            {localStatus === 'not-started' && (
              <Badge variant="outline" className="bg-bg-muted text-fg-muted border-border ml-2">
                Not Started
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {localStatus === 'in-progress' && (
              <span className="text-sm text-fg-muted">
                {progressPercentage}%
              </span>
            )}
            {localStatus === 'completed' && <span className="text-sm text-fg-muted">100%</span>}
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleToggleExpand}
              className="text-fg-muted hover:text-fg"
            >
              <ChevronUp className={`h-5 w-5 ${!isExpanded ? 'transform rotate-180' : ''}`} />
            </Button>
          </div>
        </div>
        
        <p className="text-fg-muted mb-4">
          Train your voice agent by uploading call recordings or role-play a conversation where you act as the agent
        </p>
        
        {localStatus !== 'not-started' && (
          <Progress 
            value={progressPercentage} 
            className="h-1.5 mb-6" 
          />
        )}
        
        {isExpanded && (
          <>
            {localStatus === 'not-started' && (
              <div className="bg-bg-muted/30 border border-border rounded-lg p-8 mb-8 text-center">
                <Mic className="h-12 w-12 text-fg-muted mx-auto mb-4" />
                <h4 className="text-lg font-medium text-fg mb-2 text-center">No voice samples yet</h4>
                <p className="text-sm text-fg-muted mb-6 max-w-md mx-auto text-center">
                  Upload call recordings or start a role-playing session to begin training your agent.
                </p>
                
                <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
                  <div 
                    onClick={handleUploadClick} 
                    className="aspect-square flex flex-col items-center justify-center p-6 rounded-lg border-2 border-dashed border-border hover:border-brand-purple hover:bg-bg-muted/50 transition-colors cursor-pointer"
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      style={{ display: 'none' }}
                      onChange={handleFileChange}
                      multiple
                      accept="audio/*"
                    />
                    <FileAudio className="h-12 w-12 text-fg-muted mb-3" />
                    <span className="text-sm font-medium text-fg">Upload Recordings</span>
                    <span className="text-xs text-fg-muted mt-1">Drag files here</span>
                  </div>
                  
                  <div 
                    onClick={() => setUserPersonasSidebarOpen(true)} 
                    className="aspect-square flex flex-col items-center justify-center p-6 rounded-lg border-2 border-brand-purple bg-brand-purple/5 hover:bg-brand-purple/10 transition-colors cursor-pointer"
                  >
                    <PhoneCall className="h-12 w-12 text-brand-purple mb-3" />
                    <span className="text-sm font-medium text-brand-purple">Call to Role Play</span>
                    <span className="text-xs text-brand-purple/70 mt-1">Call to generate training recordings</span>
                  </div>
                </div>
              </div>
            )}

            {localStatus === 'in-progress' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-bg-muted/30 p-6 rounded-lg border border-border flex flex-col">
                    <div className="flex items-center gap-2 mb-1 text-fg-muted">
                      <Clock className="h-4 w-4" />
                      <span className="text-xs font-medium">Recording Duration</span>
                    </div>
                    <div className="flex items-end justify-between mt-auto">
                      <div className="text-3xl font-bold text-fg">{formatMinutes(totalRecordingMinutes)}/{targetMinutes}m</div>
                      <div className="text-xs text-fg-muted">Target minutes</div>
                    </div>
                  </div>
                  <div className="bg-bg-muted/30 p-6 rounded-lg border border-border flex flex-col">
                    <div className="flex items-center gap-2 mb-1 text-fg-muted">
                      <BarChart className="h-4 w-4" />
                      <span className="text-xs font-medium">Voice Cloning Confidence</span>
                    </div>
                    <div className="flex items-end justify-between mt-auto">
                      <div className="text-3xl font-bold text-fg">{localVoiceConfidence}%</div>
                      <div className="text-xs text-fg-muted">Current confidence level</div>
                    </div>
                  </div>
                  <div className="bg-bg-muted/30 p-6 rounded-lg border border-border flex flex-col">
                    <div className="flex items-center gap-2 mb-1 text-fg-muted">
                      <Mic className="h-4 w-4" />
                      <span className="text-xs font-medium">Voice Samples</span>
                    </div>
                    <div className="flex items-end justify-between mt-auto">
                      <div className="text-3xl font-bold text-fg">{localVoiceSamples}</div>
                      <div className="text-xs text-fg-muted">Total recordings</div>
                    </div>
                  </div>
                </div>

                <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 mb-6">
                  <div className="flex items-start gap-3">
                    <div className="bg-warning/20 p-2 rounded-full">
                      <ArrowRight className="h-4 w-4 text-warning" />
                    </div>
                    <div>
                      <h4 className="font-medium mb-1 text-fg">
                        Progress: {formatMinutes(totalRecordingMinutes)} of {targetMinutes} minutes recorded
                      </h4>
                      <p className="text-sm text-fg-muted">
                        Upload or record {formatMinutes(Math.max(targetMinutes - totalRecordingMinutes, 0))} more minutes to complete this step.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Get Started with Training section */}
                <div className="bg-bg-muted/30 p-6 rounded-lg mb-6 border border-border">
                  <h4 className="font-medium text-fg mb-3 text-center">Get Started with Training</h4>
                  <p className="text-sm text-fg-muted mb-4 text-center">Choose one of the following options to begin training your AI agent:</p>
                  
                  <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
                    <div 
                      onClick={handleUploadClick} 
                      className="aspect-square flex flex-col items-center justify-center p-6 rounded-lg border-2 border-dashed border-border hover:border-brand-purple hover:bg-bg-muted/50 transition-colors cursor-pointer"
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                        multiple
                        accept="audio/*"
                      />
                      <FileAudio className="h-12 w-12 text-fg-muted mb-3" />
                      <span className="text-sm font-medium text-fg">Upload Recordings</span>
                      <span className="text-xs text-fg-muted mt-1">Drag files here</span>
                    </div>
                    
                    <div 
                      onClick={() => setUserPersonasSidebarOpen(true)} 
                      className="aspect-square flex flex-col items-center justify-center p-6 rounded-lg border-2 border-brand-purple bg-brand-purple/5 hover:bg-brand-purple/10 transition-colors cursor-pointer"
                    >
                      <PhoneCall className="h-12 w-12 text-brand-purple mb-3" />
                      <span className="text-sm font-medium text-brand-purple">Call to Role Play</span>
                      <span className="text-xs text-brand-purple/70 mt-1">Call to generate training recordings</span>
                    </div>
                  </div>
                </div>

                <div className="mb-6">
                  <h4 className="font-medium text-fg mb-4">Training Recordings ({formatMinutes(totalRecordingMinutes)} minutes total)</h4>
                  <div className="space-y-3">
                    {localTrainingRecords.map((record, index) => (
                      <div key={record.id} className="bg-bg-muted/30 border border-border rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="bg-bg-muted p-2 rounded-full">
                              {record.type === 'call' ? (
                                <Mic className="h-5 w-5 text-fg-muted" />
                              ) : (
                                <User className="h-5 w-5 text-fg-muted" />
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <h5 className="font-medium text-fg">{record.title}</h5>
                              {index === localTrainingRecords.length - 1 && (
                                <Badge variant="new" className="ml-2">New</Badge>
                              )}
                            </div>
                            <p className="text-xs text-fg-muted">{record.date}, {record.time} • {record.duration}</p>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className="gap-2 text-fg"
                                    onClick={() => handlePlayRecording(record)}
                                  >
                                    <PlayCircle className="h-4 w-4" />
                                    <span className="hidden sm:inline">Play</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Play recording</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    className="gap-2 text-fg"
                                  >
                                    <Sparkles className="h-4 w-4" />
                                    <span className="hidden sm:inline">Use for Training</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Use this recording to enhance agent training</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                                    onClick={() => handleRemoveRecording(record.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    <span className="hidden sm:inline">Remove</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Remove recording</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {localTrainingRecords.length === 0 && (
                      <div className="bg-bg-muted/30 border border-border rounded-lg p-6 text-center">
                        <p className="text-fg-muted">No recordings yet. Add recordings using one of the methods below.</p>
                      </div>
                    )}
                  </div>
                </div>
                
                {totalRecordingMinutes >= targetMinutes && onComplete && (
                  <Button onClick={onComplete} className="mb-4">Complete Training</Button>
                )}
              </>
            )}

            {localStatus === 'completed' && (
              <>
                <div className="bg-success/10 border border-success/30 rounded-lg p-4 mb-6">
                  <div className="flex items-start gap-3">
                    <div className="bg-success/20 p-2 rounded-full">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    </div>
                    <div>
                      <h4 className="font-medium mb-1 text-fg">Completed: Voice training finished</h4>
                      <p className="text-sm text-fg-muted">The required {targetMinutes} minutes of voice recordings have been collected and processed.</p>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-bg-muted/30 p-6 rounded-lg border border-border flex flex-col">
                    <div className="flex items-center gap-2 mb-1 text-fg-muted">
                      <Clock className="h-4 w-4" />
                      <span className="text-xs font-medium">Recording Duration</span>
                    </div>
                    <div className="flex items-end justify-between mt-auto">
                      <div className="text-3xl font-bold text-fg">{formatMinutes(Math.max(totalRecordingMinutes, targetMinutes))}/{targetMinutes}m</div>
                      <div className="text-xs text-fg-muted">Goal achieved</div>
                    </div>
                  </div>
                  <div className="bg-bg-muted/30 p-6 rounded-lg border border-border flex flex-col">
                    <div className="flex items-center gap-2 mb-1 text-fg-muted">
                      <BarChart className="h-4 w-4" />
                      <span className="text-xs font-medium">Voice Cloning Confidence</span>
                    </div>
                    <div className="flex items-end justify-between mt-auto">
                      <div className="text-3xl font-bold text-fg">95%</div>
                      <div className="text-xs text-fg-muted">High confidence level</div>
                    </div>
                  </div>
                  <div className="bg-bg-muted/30 p-6 rounded-lg border border-border flex flex-col">
                    <div className="flex items-center gap-2 mb-1 text-fg-muted">
                      <Mic className="h-4 w-4" />
                      <span className="text-xs font-medium">Voice Samples</span>
                    </div>
                    <div className="flex items-end justify-between mt-auto">
                      <div className="text-3xl font-bold text-fg">{localTrainingRecords.length}</div>
                      <div className="text-xs text-fg-muted">Total recordings</div>
                    </div>
                  </div>
                </div>
                
                {/* Continue Training section */}
                <div className="bg-bg-muted/30 p-6 rounded-lg mb-6 border border-border">
                  <h4 className="font-medium text-fg mb-3 text-center">Continue Training</h4>
                  <p className="text-sm text-fg-muted mb-4 text-center">Add more voice samples to further improve your AI agent's voice quality and recognition capabilities.</p>
                  
                  <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
                    <div 
                      onClick={handleUploadClick} 
                      className="aspect-square flex flex-col items-center justify-center p-6 rounded-lg border-2 border-dashed border-border hover:border-brand-purple hover:bg-bg-muted/50 transition-colors cursor-pointer"
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                        multiple
                        accept="audio/*"
                      />
                      <FileAudio className="h-12 w-12 text-fg-muted mb-3" />
                      <span className="text-sm font-medium text-fg">Upload Recordings</span>
                      <span className="text-xs text-fg-muted mt-1">Drag files here</span>
                    </div>
                    
                    <div 
                      onClick={() => setUserPersonasSidebarOpen(true)}
                      className="aspect-square flex flex-col items-center justify-center p-6 rounded-lg border-2 border-brand-purple bg-brand-purple/5 hover:bg-brand-purple/10 transition-colors cursor-pointer"
                    >
                      <PhoneCall className="h-12 w-12 text-brand-purple mb-3" />
                      <span className="text-sm font-medium text-brand-purple">Call to Role Play</span>
                      <span className="text-xs text-brand-purple/70 mt-1">Call to generate training recordings</span>
                    </div>
                  </div>
                </div>
                
                {/* Training Recordings section */}
                <div className="mb-6">
                  <h4 className="font-medium text-fg mb-4">Training Recordings ({formatMinutes(totalRecordingMinutes)} minutes total)</h4>
                  <div className="space-y-3">
                    {[...trainingRecords, 
                      {
                        id: '3',
                        title: 'Customer Support Call #2',
                        date: 'Feb 23, 2024',
                        time: '10:30 AM',
                        duration: '4:15',
                        type: 'call' as const
                      },
                      {
                        id: '4',
                        title: 'Role-Play Session #2',
                        date: 'Feb 24, 2024',
                        time: '2:45 PM',
                        duration: '8:30',
                        type: 'roleplay' as const
                      }
                    ].map((record, index, arr) => (
                      <div key={record.id} className="bg-bg-muted/30 border border-border rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="bg-bg-muted p-2 rounded-full">
                              {record.type === 'call' ? (
                                <Mic className="h-5 w-5 text-fg-muted" />
                              ) : (
                                <User className="h-5 w-5 text-fg-muted" />
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <h5 className="font-medium text-fg">{record.title}</h5>
                              {index === arr.length - 1 && (
                                <Badge variant="new" className="ml-2">New</Badge>
                              )}
                            </div>
                            <p className="text-xs text-fg-muted">{record.date}, {record.time} • {record.duration}</p>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className="gap-2 text-fg"
                                    onClick={() => handlePlayRecording(record)}
                                  >
                                    <PlayCircle className="h-4 w-4" />
                                    <span className="hidden sm:inline">Play</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Play recording</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    className="gap-2 text-fg"
                                  >
                                    <Sparkles className="h-4 w-4" />
                                    <span className="hidden sm:inline">Use for Training</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Use this recording to enhance agent training</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                                    onClick={() => handleRemoveRecording(record.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    <span className="hidden sm:inline">Remove</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Remove recording</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
      
      {userPersonasSidebarOpen && (
        <UserPersonasSidebar 
          open={userPersonasSidebarOpen} 
          onOpenChange={() => setUserPersonasSidebarOpen(false)}
          onSelectPersona={handleSelectPersona}
          onStartDirectCall={handleStartDirectCall}
        />
      )}
      
      {callInterfaceOpen && (
        <CallInterface 
          open={callInterfaceOpen}
          onOpenChange={() => setCallInterfaceOpen(false)}
          persona={selectedPersona}
          directCallInfo={directCallInfo}
          onCallComplete={handleCallComplete}
        />
      )}
    </div>
  );
};
