
import React, { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Search, Users, UserRound, MessageCircle, Brain, ArrowRight, Send, Phone, Mic, PhoneCall, Pause, Play, PhoneOff, Volume2, Timer, FileText, Volume, MicOff, Save, Redo, CheckCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

const samplePersonas = [
  { id: 1, name: "Emily", role: "Product Manager", avatar: "E", description: "Focused on feature prioritization and roadmap planning", background: "8 years in product management, previously worked at Google", communication: "Direct and data-driven", painPoints: "Tight deadlines, resource constraints" },
  { id: 2, name: "Michael", role: "IT Support", avatar: "M", description: "Technical support specialist with hardware expertise", background: "5 years in IT support, CompTIA certified", communication: "Patient and methodical", painPoints: "Complex legacy systems, urgent requests" },
  { id: 3, name: "Sarah", role: "Customer Success", avatar: "S", description: "Helps customers achieve their goals with the product", background: "4 years in customer-facing roles", communication: "Empathetic and solution-oriented", painPoints: "Feature gaps, customer churn risk" },
  { id: 4, name: "David", role: "Finance Manager", avatar: "D", description: "Handles budgeting and financial planning inquiries", background: "10+ years in finance, CPA certified", communication: "Analytical and detail-oriented", painPoints: "Budget constraints, audit compliance" },
  { id: 5, name: "Jessica", role: "HR Representative", avatar: "J", description: "Specializes in employee benefits and policies", background: "6 years in HR management", communication: "Supportive and diplomatic", painPoints: "Policy enforcement, employee satisfaction" },
  { id: 6, name: "Robert", role: "Sales Representative", avatar: "R", description: "Focuses on addressing prospect questions and concerns", background: "12 years in B2B sales", communication: "Persuasive and relationship-focused", painPoints: "Meeting quotas, competitive landscape" },
  { id: 7, name: "Amanda", role: "Marketing Specialist", avatar: "A", description: "Expert in digital marketing strategies", background: "7 years in digital marketing", communication: "Creative and data-informed", painPoints: "ROI measurement, campaign deadlines" },
  { id: 8, name: "James", role: "Operations Manager", avatar: "J", description: "Focuses on operational efficiency and processes", background: "9 years in operations management", communication: "Process-oriented and pragmatic", painPoints: "Supply chain issues, quality control" },
  { id: 9, name: "Lisa", role: "Legal Advisor", avatar: "L", description: "Provides guidance on legal and compliance matters", background: "Attorney with 8 years of corporate law experience", communication: "Precise and risk-aware", painPoints: "Regulatory changes, compliance deadlines" },
  { id: 10, name: "Thomas", role: "Product Support", avatar: "T", description: "Technical product expert for troubleshooting", background: "3 years with the product, engineering background", communication: "Technical but approachable", painPoints: "Complex edge cases, version compatibility" },
];

interface Message {
  id: string;
  sender: 'user' | 'persona';
  text: string;
  timestamp: Date;
}

export const RolePlayDialog = ({ 
  open, 
  onOpenChange 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) => {
  const [stage, setStage] = useState<'selection' | 'persona-list' | 'persona-detail' | 'chat' | 'call' | 'success'>('selection');
  const [selectedPersona, setSelectedPersona] = useState<typeof samplePersonas[0] | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [knowledgeResults, setKnowledgeResults] = useState<string[]>([]);
  
  const [isCallActive, setIsCallActive] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isCallMuted, setIsCallMuted] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [transcription, setTranscription] = useState<string[]>([]);
  const [isLoadingTranscription, setIsLoadingTranscription] = useState(false);
  const [isRecording, setIsRecording] = useState(true);
  const [isPlayingRecording, setIsPlayingRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneNumberError, setPhoneNumberError] = useState('');

  const [selectedMic, setSelectedMic] = useState<string>("");
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>("");
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [availableSpeakers, setAvailableSpeakers] = useState<MediaDeviceInfo[]>([]);

  const handleOptionSelect = (option: 'someone' | 'personas') => {
    if (option === 'someone') {
      setStage('call');
      setSelectedPersona(null);
    } else {
      setStage('persona-list');
    }
  };

  useEffect(() => {
    const getDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => {
            stream.getTracks().forEach(track => track.stop());
          })
          .catch(error => {
            console.error('Permission denied for audio:', error);
            toast({
              title: "Permission Error",
              description: "Please allow microphone access to use audio features"
            });
            return;
          });

        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter(device => device.kind === 'audioinput' && device.deviceId);
        const speakers = devices.filter(device => device.kind === 'audiooutput' && device.deviceId);
        
        setAvailableMics(mics);
        setAvailableSpeakers(speakers);
        
        if (mics.length > 0) setSelectedMic(mics[0].deviceId);
        if (speakers.length > 0) setSelectedSpeaker(speakers[0].deviceId);

      } catch (error) {
        console.error('Error accessing media devices:', error);
        toast({
          title: "Device Error",
          description: "Unable to access audio devices. Please check your browser permissions."
        });
      }
    };

    if (stage === 'call') {
      getDevices();

      navigator.mediaDevices.addEventListener('devicechange', getDevices);
      
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', getDevices);
      };
    }
  }, [stage]);

  useEffect(() => {
    if (isCallActive && !timerRef.current) {
      timerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else if (!isCallActive && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isCallActive]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePersonaSelect = (persona: typeof samplePersonas[0]) => {
    setSelectedPersona(persona);
    setStage('persona-detail');
  };

  const handleStartRolePlay = () => {
    if (selectedPersona) {
      setStage('call');
      setTimeout(() => {
        setIsCallActive(true);
        setCallDuration(0);
        setTranscription([`Call connected with ${selectedPersona.name}`]);
      }, 500);
    }
  };

  const validatePhoneNumber = (number: string) => {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(number);
  };

  const handleStartCall = () => {
    if (selectedPersona) {
      setIsCallActive(true);
      setCallDuration(0);
      
      setTimeout(() => {
        setTranscription([`Call connected with ${selectedPersona.name}`]);
      }, 2000);
      return;
    }

    if (!phoneNumber) {
      setPhoneNumberError('Please enter a phone number');
      return;
    }

    if (!validatePhoneNumber(phoneNumber)) {
      setPhoneNumberError('Please enter a valid phone number');
      return;
    }

    if (!selectedMic || !selectedSpeaker) {
      toast({
        title: "Device Error",
        description: "Please select both microphone and speaker devices"
      });
      return;
    }

    setPhoneNumberError('');
    setIsCallActive(true);
    setCallDuration(0);
    
    setTimeout(() => {
      setTranscription([`Call connected with ${phoneNumber}`]);
      toast({
        title: "Call Connected",
        description: "Call connected successfully"
      });
    }, 2000);
  };

  const handleToggleMic = () => {
    setIsMicMuted(!isMicMuted);
    toast({
      title: isMicMuted ? "Microphone Unmuted" : "Microphone Muted",
      description: isMicMuted ? "Your microphone is now active" : "Your microphone has been muted"
    });
  };

  const handleToggleAudio = () => {
    setIsAudioMuted(!isAudioMuted);
    toast({
      title: isAudioMuted ? "Audio Unmuted" : "Audio Muted",
      description: isAudioMuted ? "You can now hear the call" : "Call audio has been muted"
    });
  };

  const handleEndCall = () => {
    setIsCallActive(false);
    
    if (transcription.length > 0) {
      setStage('success');
    }
  };

  const handleToggleMute = () => {
    setIsCallMuted(!isCallMuted);
  };

  const handleToggleRecording = () => {
    setIsRecording(!isRecording);
    
    if (!isRecording) {
      setIsLoadingTranscription(true);
      setTimeout(() => {
        setIsLoadingTranscription(false);
        
        const userTranscript = "Thanks for explaining that. I have a question about your experience with our product.";
        setTranscription(prev => [...prev, `You: ${userTranscript}`]);
        
        setTimeout(() => {
          if (selectedPersona) {
            setTranscription(prev => [...prev, `${selectedPersona.name}: I've been using your product for about 6 months now. It's mostly been positive, but I've had some challenges with the reporting features.`]);
          }
        }, 3000);
      }, 2000);
    }
  };

  const handleSendMessage = () => {
    if (currentMessage.trim() === '') return;

    const newUserMessage: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: currentMessage,
      timestamp: new Date(),
    };
    
    setMessages([...messages, newUserMessage]);
    setCurrentMessage('');

    setTimeout(() => {
      const newPersonaMessage: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'persona',
        text: `I understand your question about "${currentMessage}". Let me help you with that...`,
        timestamp: new Date(),
      };
      setMessages(prevMessages => [...prevMessages, newPersonaMessage]);
    }, 1000);
  };

  const handleKnowledgeSearch = () => {
    if (searchQuery.trim() === '') return;

    setKnowledgeResults([
      `Article about "${searchQuery}" from the knowledge base.`,
      `FAQ entry related to "${searchQuery}".`,
      `Best practices for handling "${searchQuery}" situations.`,
    ]);
  };

  const handlePlayRecording = () => {
    setIsPlayingRecording(true);
    setRecordingProgress(0);
    
    recordingTimerRef.current = setInterval(() => {
      setRecordingProgress(prev => {
        if (prev >= 100) {
          clearInterval(recordingTimerRef.current as NodeJS.Timeout);
          setIsPlayingRecording(false);
          return 100;
        }
        return prev + 1;
      });
    }, 50); // Make it faster to simulate a realistic playback
  };

  const handleStopPlayback = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsPlayingRecording(false);
  };

  const handleSaveAndTrain = () => {
    toast({
      title: "Recording Saved",
      description: "Your recording has been saved and will be used for training."
    });
    handleClose();
  };

  const handleRetake = () => {
    setStage('call');
    setIsCallActive(false);
    setCallDuration(0);
    setTranscription([]);
    setRecordingProgress(0);
    setIsPlayingRecording(false);
    
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const handleClose = () => {
    setStage('selection');
    setSelectedPersona(null);
    setMessages([]);
    setCurrentMessage('');
    setSearchQuery('');
    setKnowledgeResults([]);
    setIsCallActive(false);
    setCallDuration(0);
    setIsCallMuted(false);
    setIsMicMuted(false);
    setIsAudioMuted(false);
    setTranscription([]);
    setIsLoadingTranscription(false);
    setIsRecording(false);
    setIsPlayingRecording(false);
    setRecordingProgress(0);
    setPhoneNumber('');
    setPhoneNumberError('');
    setSelectedMic('');
    setSelectedSpeaker('');
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[95vw] lg:max-w-[85vw] max-h-[90vh] flex flex-col">
        {stage === 'selection' && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Role-Play Session</DialogTitle>
              <DialogDescription>
                Choose a role-play option to start training your agent
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-6">
              <div 
                className="border border-gray-200 dark:border-gray-800 rounded-lg p-6 hover:border-primary/50 hover:bg-primary/5 cursor-pointer flex flex-col items-center text-center transition-all"
                onClick={() => handleOptionSelect('someone')}
              >
                <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <PhoneCall className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-medium mb-2">Role-Play Call</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Start a voice call session with someone from your team or a real user to practice customer conversations
                </p>
              </div>
              
              <div 
                className="border border-gray-200 dark:border-gray-800 rounded-lg p-6 hover:border-primary/50 hover:bg-primary/5 cursor-pointer flex flex-col items-center text-center transition-all"
                onClick={() => handleOptionSelect('personas')}
              >
                <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <UserRound className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-medium mb-2">User Personas</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Choose from common user personas for targeted training calls
                </p>
              </div>
            </div>
          </>
        )}

        {stage === 'persona-list' && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Select a Persona</DialogTitle>
              <DialogDescription>
                Choose one of the personas to start a role-play session
              </DialogDescription>
            </DialogHeader>
            
            <div className="py-4 overflow-y-auto grid grid-cols-1 gap-3 max-h-[400px]">
              {samplePersonas.map((persona) => (
                <div 
                  key={persona.id}
                  className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 hover:border-primary/50 hover:bg-primary/5 cursor-pointer flex items-center gap-4 transition-all"
                  onClick={() => handlePersonaSelect(persona)}
                >
                  <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center text-lg font-medium text-primary">
                    {persona.avatar}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium">{persona.name}</h4>
                    <p className="text-sm text-muted-foreground">{persona.role}</p>
                    <p className="mt-2">{persona.description}</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-gray-400" />
                </div>
              ))}
            </div>
            
            <DialogFooter>
              <Button 
                variant="outline"
                onClick={() => setStage('selection')}
              >
                Back
              </Button>
            </DialogFooter>
          </>
        )}
        
        {stage === 'persona-detail' && selectedPersona && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Persona Details</DialogTitle>
              <DialogDescription>
                Review this persona's information before starting the role-play
              </DialogDescription>
            </DialogHeader>
            
            <div className="py-4">
              <div className="flex items-start gap-4 mb-6">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="bg-primary/10 text-primary text-xl">
                    {selectedPersona.avatar}
                  </AvatarFallback>
                </Avatar>
                
                <div>
                  <h3 className="text-xl font-medium">{selectedPersona.name}</h3>
                  <p className="text-sm text-muted-foreground">{selectedPersona.role}</p>
                  <p className="mt-2">{selectedPersona.description}</p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                <div className="bg-secondary/30 dark:bg-secondary/10 p-4 rounded-lg">
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <UserRound className="h-4 w-4 text-primary" />
                    Background
                  </h4>
                  <p className="text-sm">{selectedPersona.background}</p>
                </div>
                
                <div className="bg-secondary/30 dark:bg-secondary/10 p-4 rounded-lg">
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-primary" />
                    Communication Style
                  </h4>
                  <p className="text-sm">{selectedPersona.communication}</p>
                </div>
                
                <div className="bg-secondary/30 dark:bg-secondary/10 p-4 rounded-lg col-span-1 md:col-span-2">
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary" />
                    Pain Points
                  </h4>
                  <p className="text-sm">{selectedPersona.painPoints}</p>
                </div>
              </div>
            </div>
            
            <DialogFooter>
              <Button 
                variant="outline"
                onClick={() => setStage('persona-list')}
              >
                Back
              </Button>
              <Button
                onClick={handleStartRolePlay}
                className="bg-gradient-to-r from-purple-500 to-indigo-500 text-white"
              >
                Start Role-Play Call
              </Button>
            </DialogFooter>
          </>
        )}

        {stage === 'call' && !isCallActive && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center">
                  <Phone className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <DialogTitle className="text-xl">Role-Play Call</DialogTitle>
                  <DialogDescription>
                    {selectedPersona ? `Call with ${selectedPersona.name}` : "External Call"}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            
            {!selectedPersona ? (
              <div className="flex flex-col items-center justify-center flex-1 max-w-md mx-auto w-full gap-8">
                <div className="w-full space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="phoneNumber">Phone Number</Label>
                    <Input
                      id="phoneNumber"
                      type="tel"
                      placeholder="+1234567890"
                      value={phoneNumber}
                      onChange={(e) => {
                        setPhoneNumber(e.target.value);
                        setPhoneNumberError('');
                      }}
                      className={phoneNumberError ? 'border-red-500' : ''}
                    />
                    {phoneNumberError && (
                      <p className="text-sm text-red-500">{phoneNumberError}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Microphone</Label>
                      <Select value={selectedMic} onValueChange={setSelectedMic}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select microphone" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableMics.map((device) => (
                            <SelectItem key={device.deviceId} value={device.deviceId}>
                              {device.label || `Microphone ${device.deviceId.slice(0, 5)}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Speaker</Label>
                      <Select value={selectedSpeaker} onValueChange={setSelectedSpeaker}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select speaker" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableSpeakers.map((device) => (
                            <SelectItem key={device.deviceId} value={device.deviceId}>
                              {device.label || `Speaker ${device.deviceId.slice(0, 5)}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="w-full">
                  <Button 
                    onClick={handleStartCall} 
                    className="bg-primary hover:bg-primary/90 text-white w-full"
                    size="lg"
                  >
                    <PhoneCall className="mr-2 h-5 w-5" />
                    Start Call
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8">
                <div className="bg-primary/10 h-24 w-24 rounded-full flex items-center justify-center mb-6">
                  <Avatar className="h-20 w-20">
                    <AvatarFallback className="bg-primary/10 text-primary text-2xl">
                      {selectedPersona.avatar}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <h3 className="text-xl font-medium mb-2">Ready to call {selectedPersona.name}</h3>
                <p className="text-sm text-center text-muted-foreground mb-6 max-w-lg">
                  You'll be connected with {selectedPersona.name}, a {selectedPersona.role}. 
                  This call will help you practice handling typical conversations with this persona type.
                </p>
                <Button 
                  onClick={handleStartCall} 
                  className="bg-green-500 hover:bg-green-600 text-white"
                  size="lg"
                >
                  <PhoneCall className="mr-2 h-5 w-5" />
                  Start Call with {selectedPersona.name}
                </Button>
              </div>
            )}
          </>
        )}

        {stage === 'call' && isCallActive && (
          <>
            <DialogHeader className="border-b pb-3">
              <div className="flex items-center gap-3">
                {selectedPersona ? (
                  <>
                    <div className="h-10 w-10 bg-primary/10 rounded-full flex items-center justify-center text-lg font-medium text-primary">
                      {selectedPersona.avatar}
                    </div>
                    <div>
                      <DialogTitle className="text-xl">{selectedPersona.name}</DialogTitle>
                      <DialogDescription className="text-sm">
                        {selectedPersona.role}
                      </DialogDescription>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="h-10 w-10 bg-primary/10 rounded-full flex items-center justify-center text-lg font-medium text-primary">
                      <Phone className="h-5 w-5" />
                    </div>
                    <div>
                      <DialogTitle className="text-xl">{phoneNumber || "Role-Play Call"}</DialogTitle>
                      <DialogDescription className="text-sm">
                        External Call
                      </DialogDescription>
                    </div>
                  </>
                )}
                {isCallActive && (
                  <Badge variant="outline" className="ml-auto border-green-500/30 text-green-500 bg-green-500/10">
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></span>
                      Call in progress
                    </span>
                  </Badge>
                )}
              </div>
            </DialogHeader>
            
            <div className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden py-4">
              <div className="flex-1 flex flex-col h-[400px]">
                <div className="flex flex-col space-y-2 mb-4">
                  <div className="flex items-center justify-between bg-secondary/30 p-3 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Timer className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{formatTime(callDuration)}</span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className={`${isMicMuted ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30' : ''}`}
                        onClick={handleToggleMic}
                      >
                        {isMicMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        <span className="ml-1.5">{isMicMuted ? 'Unmute' : 'Mute'}</span>
                      </Button>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        className={`${isAudioMuted ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30' : ''}`}
                        onClick={handleToggleAudio}
                      >
                        {isAudioMuted ? <Volume className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                        <span className="ml-1.5">{isAudioMuted ? 'Unmute' : 'Mute'}</span>
                      </Button>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        className={`${isRecording ? 'bg-red-500/10 text-red-500 border-red-500/30' : ''}`}
                        onClick={handleToggleRecording}
                      >
                        {isRecording ? <Pause className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        <span className="ml-1.5">{isRecording ? 'Stop' : 'Record'}</span>
                      </Button>
                      
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleEndCall}
                      >
                        <PhoneOff className="h-4 w-4" />
                        <span className="ml-1.5">End</span>
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 bg-secondary/10 p-3 rounded-lg">
                    <div className="space-y-1">
                      <Label className="text-xs">Microphone</Label>
                      <Select value={selectedMic} onValueChange={setSelectedMic}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select microphone" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableMics.map((device) => (
                            <SelectItem key={device.deviceId} value={device.deviceId}>
                              {device.label || `Microphone ${device.deviceId.slice(0, 5)}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Speaker</Label>
                      <Select value={selectedSpeaker} onValueChange={setSelectedSpeaker}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select speaker" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableSpeakers.map((device) => (
                            <SelectItem key={device.deviceId} value={device.deviceId}>
                              {device.label || `Speaker ${device.deviceId.slice(0, 5)}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto mb-4 bg-secondary/20 rounded-lg p-4">
                  <div className="space-y-6">
                    <div className="flex items-center justify-center">
                      <Badge className="bg-blue-500/10 text-blue-500 border border-blue-500/30">
                        Call started with {selectedPersona ? selectedPersona.name : phoneNumber}
                      </Badge>
                    </div>
                    
                    {isLoadingTranscription && (
                      <div className="flex items-center justify-center py-4">
                        <div className="flex flex-col items-center">
                          <div className="flex space-x-1">
                            <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }}></div>
                          </div>
                          <span className="text-xs text-muted-foreground mt-2">Transcribing...</span>
                        </div>
                      </div>
                    )}
                    
                    {transcription.map((line, index) => {
                      const [speaker, ...textParts] = line.split(': ');
                      const text = textParts.join(': ');
                      
                      return (
                        <div key={index} className="flex flex-col space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs px-2 py-0.5 rounded-full">
                              {speaker}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(Date.now() - (transcription.length - 1 - index) * 5000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-sm ml-1">{text}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {stage === 'success' && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Great Job!</DialogTitle>
              <DialogDescription>
                You are one step closer to a great and human-like AI. Here's the recording from your call.
              </DialogDescription>
            </DialogHeader>
            
            <div className="py-6 flex flex-col items-center">
              <div className="w-full max-w-xl mx-auto bg-secondary/10 rounded-lg p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <span className="font-medium">Call Recording</span>
                  </div>
                  <Badge variant="outline" className="border-green-500/30 text-green-500 bg-green-500/10">
                    {formatTime(callDuration)}
                  </Badge>
                </div>
                
                <div className="mb-6">
                  <div className="flex items-center gap-4 mb-3">
                    <Button 
                      size="sm"
                      variant="outline"
                      className="rounded-full w-10 h-10 p-0 flex items-center justify-center"
                      onClick={isPlayingRecording ? handleStopPlayback : handlePlayRecording}
                    >
                      {isPlayingRecording ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    
                    <div className="flex-1">
                      <Progress value={recordingProgress} className="h-2" />
                    </div>
                    
                    <span className="text-sm text-muted-foreground">
                      {formatTime(Math.floor(callDuration * recordingProgress / 100))} / {formatTime(callDuration)}
                    </span>
                  </div>
                </div>
                
                <div className="bg-background rounded-md p-4 max-h-[200px] overflow-y-auto border">
                  <h4 className="text-sm font-medium mb-3">Transcript Preview</h4>
                  <div className="space-y-4">
                    {transcription.slice(0, 3).map((line, index) => {
                      const [speaker, ...textParts] = line.split(': ');
                      const text = textParts.join(': ');
                      
                      return (
                        <div key={index} className="flex flex-col space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs px-2 py-0.5 rounded-full">
                              {speaker}
                            </Badge>
                          </div>
                          <p className="text-sm ml-1">{text}</p>
                        </div>
                      );
                    })}
                    
                    {transcription.length > 3 && (
                      <p className="text-sm text-muted-foreground italic">
                        + {transcription.length - 3} more messages
                      </p>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4 mt-4 justify-between w-full max-w-xl">
                <Button
                  onClick={handleRetake}
                  variant="outline"
                  size="lg"
                >
                  <Redo className="mr-2 h-5 w-5" />
                  Retake Call
                </Button>
                
                <Button
                  onClick={handleSaveAndTrain}
                  className="bg-gradient-to-r from-green-500 to-emerald-600 text-white"
                  size="lg"
                >
                  <Save className="mr-2 h-5 w-5" />
                  Save & Train AI
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
