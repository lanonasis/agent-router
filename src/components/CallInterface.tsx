import React, { useState, useEffect, useRef } from "react";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogDescription } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, PhoneOff, Volume, Volume2, User, Bot, Phone } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface UserPersona {
  id: string;
  name: string;
  type: "customer" | "agent" | "bot";
  description: string;
  scenario?: string;
}

interface CallInterfaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  persona: UserPersona | null;
  onCallComplete?: (recordingData: RecordingData) => void;
  directCallInfo?: {
    phoneNumber: string;
    deviceSettings: {
      mic: string;
      speaker: string;
    };
  };
}

export interface RecordingData {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: string;
  type: 'call' | 'roleplay';
  transcriptions?: string[];
}

export const CallInterface: React.FC<CallInterfaceProps> = ({
  open,
  onOpenChange,
  persona,
  onCallComplete,
  directCallInfo
}) => {
  const [callStatus, setCallStatus] = useState<"connecting" | "active" | "ended">("connecting");
  const [isMuted, setIsMuted] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [selectedMic, setSelectedMic] = useState<string>("");
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>("");
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [availableSpeakers, setAvailableSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [transcriptions, setTranscriptions] = useState<string[]>([]);
  const [isDirectCall, setIsDirectCall] = useState(false);

  const timerRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const callStartTimeRef = useRef<Date | null>(null);
  
  useEffect(() => {
    if (directCallInfo) {
      setIsDirectCall(true);
      if (directCallInfo.deviceSettings) {
        setSelectedMic(directCallInfo.deviceSettings.mic);
        setSelectedSpeaker(directCallInfo.deviceSettings.speaker);
      }
    } else {
      setIsDirectCall(false);
    }
  }, [directCallInfo]);
  
  const clearAllTimers = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      const resetState = () => {
        setCallStatus("connecting");
        setCallDuration(0);
        setTranscriptions([]);
        setIsMuted(false);
        setIsAudioMuted(false);
        setIsDirectCall(Boolean(directCallInfo));
      };
      
      setTimeout(resetState, 100);
    }
  }, [open, directCallInfo]);

  useEffect(() => {
    return () => {
      clearAllTimers();
    };
  }, []);

  useEffect(() => {
    if (open && callStatus === "connecting") {
      const timer = setTimeout(() => {
        setCallStatus("active");
        callStartTimeRef.current = new Date();
        
        if (isDirectCall) {
          setTranscriptions([`System: Connected to ${directCallInfo?.phoneNumber}. You are now speaking with a real person.`]);
        } else if (persona) {
          const initialMessage = getInitialMessage(persona);
          setTranscriptions([`${persona.name}: ${initialMessage}`]);
        }
      }, 1500);
      
      return () => clearTimeout(timer);
    }
  }, [open, callStatus, persona, isDirectCall, directCallInfo]);

  useEffect(() => {
    const getDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => {
            stream.getTracks().forEach(track => track.stop());
          })
          .catch(error => {
            console.error("Microphone permission denied:", error);
            toast({
              title: "Microphone Access Denied",
              description: "Please allow microphone access to use the call feature",
            });
          });

        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter(device => device.kind === "audioinput");
        const speakers = devices.filter(device => device.kind === "audiooutput");
        
        setAvailableMics(mics);
        setAvailableSpeakers(speakers);
        
        if (mics.length > 0) setSelectedMic(mics[0].deviceId);
        if (speakers.length > 0) setSelectedSpeaker(speakers[0].deviceId);
      } catch (error) {
        console.error("Error accessing media devices:", error);
        toast({
          title: "Device Error",
          description: "Unable to access audio devices",
        });
      }
    };
    
    if (open) {
      getDevices();
    }
    
    const deviceChangeHandler = () => {
      if (open) {
        getDevices();
      }
    };
    
    navigator.mediaDevices.addEventListener('devicechange', deviceChangeHandler);
    
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', deviceChangeHandler);
    };
  }, [open]);

  useEffect(() => {
    if (open && callStatus === "active") {
      timerRef.current = window.setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [open, callStatus]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcriptions]);

  const getInitialMessage = (persona: UserPersona): string => {
    switch (persona.id) {
      case "1": return "Hi there! I'm interested in learning more about your product. Can you tell me about the basic features?";
      case "2": return "I've been trying to use your software for hours and I'm really frustrated. Nothing is working!";
      case "3": return "Hello, I've been using your service for a while now and I'm thinking about upgrading. What options do you have?";
      case "4": return "Hello agent, I'll be simulating various customer scenarios. Let's start with a basic inquiry about your product.";
      case "5": return "Hi, I've been comparing your product with your competitors. I have some technical questions.";
      case "6": return "I'm considering cancelling my subscription. I'm not happy with the recent changes you've made.";
      default: return "Hello, how can you help me today?";
    }
  };

  const formatTimestamp = (date: Date): string => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndCall = () => {
    setCallStatus("ended");
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    if (onCallComplete) {
      const now = new Date();
      const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      
      const recordingData: RecordingData = {
        id: Math.random().toString(36).substring(2, 9),
        title: isDirectCall 
          ? `Call with ${directCallInfo?.phoneNumber}`
          : `Call with ${persona?.name || 'Unknown'}`,
        date,
        time,
        duration: formatDuration(callDuration),
        type: isDirectCall ? 'call' : 'roleplay',
        transcriptions: [...transcriptions]
      };
      
      onCallComplete(recordingData);
    }
    
    onOpenChange(false);
  };

  const handleToggleMute = () => {
    setIsMuted(!isMuted);
    toast({
      title: isMuted ? "Microphone Unmuted" : "Microphone Muted",
      description: isMuted ? "Your microphone is now active" : "Your microphone has been muted",
    });
  };

  const handleToggleAudio = () => {
    setIsAudioMuted(!isAudioMuted);
    toast({
      title: isAudioMuted ? "Audio Unmuted" : "Audio Muted",
      description: isAudioMuted ? "You can now hear the call" : "Call audio has been muted",
    });
  };

  const handleSendMessage = () => {
    const userMessage = "I understand. Let me help you with that...";
    setTranscriptions(prev => [...prev, `You: ${userMessage}`]);
    
    setTimeout(() => {
      if (persona) {
        const responseText = "Thank you for your help. Can you tell me more about the pricing options?";
        setTranscriptions(prev => [...prev, `${persona.name}: ${responseText}`]);
      }
    }, 3000);
  };

  if (!persona && !isDirectCall) return null;

  return (
    <AlertDialog 
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) {
          clearAllTimers();
          setTimeout(() => {
            onOpenChange(false);
          }, 50);
        } else {
          onOpenChange(newOpen);
        }
      }}
    >
      <AlertDialogContent className="max-w-md sm:max-w-2xl bg-white dark:bg-[#0F172A] border-gray-200 dark:border-gray-800">
        <AlertDialogDescription className="sr-only">
          {isDirectCall 
            ? `Direct call to ${directCallInfo?.phoneNumber}` 
            : `Call interface with ${persona?.name}. You can communicate and train with this persona.`}
        </AlertDialogDescription>
        
        <AlertDialogHeader className="space-y-2 border-b border-gray-200 dark:border-gray-800 pb-4">
          <AlertDialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isDirectCall ? (
                <Phone className="h-5 w-5 text-green-500 dark:text-green-400" />
              ) : persona?.type === "customer" ? (
                <User className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              ) : (
                <Bot className="h-5 w-5 text-primary" />
              )}
              <span className="text-gray-900 dark:text-white">
                {isDirectCall 
                  ? `Direct Call: ${directCallInfo?.phoneNumber}`
                  : persona?.name}
              </span>
              <Badge variant="outline" className="ml-2">
                {isDirectCall 
                  ? "Live Call" 
                  : persona?.type === "customer" ? "Customer" : "Training Bot"}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-sm font-normal">
              {callStatus === "connecting" ? (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                  Connecting...
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></span>
                    {formatDuration(callDuration)}
                  </span>
                </Badge>
              )}
            </div>
          </AlertDialogTitle>
          
          {callStatus === "connecting" && (
            <div className="py-10 flex flex-col items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4 relative">
                {isDirectCall ? (
                  <Phone className="h-8 w-8 text-green-500 dark:text-green-400" />
                ) : persona?.type === "customer" ? (
                  <User className="h-8 w-8 text-gray-600 dark:text-gray-400" />
                ) : (
                  <Bot className="h-8 w-8 text-primary" />
                )}
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-amber-500 rounded-full animate-pulse"></div>
              </div>
              <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">
                {isDirectCall
                  ? `Connecting to ${directCallInfo?.phoneNumber}...`
                  : `Connecting to ${persona?.name}...`}
              </h3>
              <Progress value={45} className="w-48 h-1" />
            </div>
          )}
        </AlertDialogHeader>

        {callStatus === "active" && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr] gap-4 my-4 h-[350px]">
            <div className="space-y-4 h-full flex flex-col">
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-gray-50 dark:bg-gray-900/50 text-sm flex-shrink-0">
                <h4 className="font-medium text-sm mb-1.5 text-gray-900 dark:text-white">
                  {isDirectCall ? "Direct Call Info" : `About ${persona?.name}`}
                </h4>
                {isDirectCall ? (
                  <p className="text-gray-600 dark:text-gray-400 mb-2">
                    Live call with {directCallInfo?.phoneNumber}. The person on the other end will roleplay as a customer.
                  </p>
                ) : (
                  <>
                    <p className="text-gray-600 dark:text-gray-400 mb-2">{persona?.description}</p>
                    {persona?.scenario && (
                      <div className="bg-gray-100 dark:bg-gray-800 rounded p-2 text-xs text-gray-700 dark:text-gray-300">
                        <span className="font-medium">Scenario:</span> {persona?.scenario}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-3 flex-grow overflow-auto">
                <h4 className="font-medium text-sm text-gray-900 dark:text-white">Audio Devices</h4>
                <div className="space-y-2">
                  <Label htmlFor="mic-select" className="text-xs text-gray-700 dark:text-gray-300">Microphone</Label>
                  <Select 
                    value={selectedMic} 
                    onValueChange={setSelectedMic}
                    disabled={isDirectCall}
                  >
                    <SelectTrigger id="mic-select" className="h-8 text-xs border-gray-300 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                      <SelectValue placeholder="Select microphone" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableMics.map((mic) => (
                        <SelectItem key={mic.deviceId} value={mic.deviceId}>
                          {mic.label || `Microphone ${mic.deviceId.slice(0, 5)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="speaker-select" className="text-xs text-gray-700 dark:text-gray-300">Speaker</Label>
                  <Select 
                    value={selectedSpeaker} 
                    onValueChange={setSelectedSpeaker}
                    disabled={isDirectCall}
                  >
                    <SelectTrigger id="speaker-select" className="h-8 text-xs border-gray-300 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                      <SelectValue placeholder="Select speaker" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSpeakers.map((speaker) => (
                        <SelectItem key={speaker.deviceId} value={speaker.deviceId}>
                          {speaker.label || `Speaker ${speaker.deviceId.slice(0, 5)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 flex flex-col h-full overflow-hidden">
              <h4 className="font-medium text-sm mb-3 text-gray-900 dark:text-white">Live Transcription</h4>
              <ScrollArea className="flex-1 pr-2">
                <div className="space-y-4">
                  {transcriptions.map((text, index) => {
                    const [speaker, ...messageParts] = text.split(": ");
                    const message = messageParts.join(": ");
                    
                    return (
                      <div key={index} className="pb-3 border-b border-gray-200 dark:border-gray-800 last:border-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs py-0 px-2 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                            {speaker}
                          </Badge>
                          <span className="text-xs text-gray-500 dark:text-gray-500">
                            {formatTimestamp(new Date(Date.now() - (transcriptions.length - 1 - index) * 3000))}
                          </span>
                        </div>
                        <p className="text-sm text-gray-800 dark:text-gray-300 break-words overflow-hidden">{message}</p>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        <AlertDialogFooter className="flex justify-center space-x-2 border-t border-gray-200 dark:border-gray-800 pt-4">
          <Button
            variant={isMuted ? "destructive" : "outline"}
            size="icon"
            onClick={handleToggleMute}
            className={cn(
              isMuted ? "bg-red-500/90" : "border-gray-300 dark:border-gray-700",
              "text-gray-900 dark:text-white"
            )}
          >
            {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          
          <Button
            variant="outline"
            size="icon"
            onClick={handleToggleAudio}
            className={cn(
              isAudioMuted ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/30" : "border-gray-300 dark:border-gray-700",
              "text-gray-900 dark:text-white"
            )}
          >
            {isAudioMuted ? <Volume className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          
          <Button
            variant="default"
            onClick={handleSendMessage}
            disabled={callStatus !== "active" || isMuted}
            className="bg-white text-black hover:bg-gray-200 dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Speak
          </Button>
          
          <Button
            variant="destructive"
            size="icon"
            onClick={handleEndCall}
          >
            <PhoneOff className="h-4 w-4" />
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
