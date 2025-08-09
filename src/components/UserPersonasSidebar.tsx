
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { User, Bot, X, ArrowLeft, PhoneCall, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

interface UserPersona {
  id: string;
  name: string;
  type: "customer" | "agent" | "bot";
  description: string;
  scenario?: string;
}

interface UserPersonasSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPersona: (persona: UserPersona) => void;
  onStartDirectCall?: (phoneNumber: string, deviceSettings: {mic: string, speaker: string}) => void;
}

export const UserPersonasSidebar: React.FC<UserPersonasSidebarProps> = ({
  open,
  onOpenChange,
  onSelectPersona,
  onStartDirectCall
}) => {
  const personas: UserPersona[] = [
    {
      id: "1",
      name: "Jane Smith",
      type: "customer",
      description: "First-time customer with basic questions about your product",
      scenario: "Wants to understand your product features and pricing"
    },
    {
      id: "2",
      name: "Michael Brown",
      type: "customer",
      description: "Frustrated customer having technical issues",
      scenario: "Has tried troubleshooting but can't resolve the problem"
    },
    {
      id: "3",
      name: "Sarah Johnson",
      type: "customer",
      description: "High-value customer considering an upgrade",
      scenario: "Currently using your basic tier but interested in premium features"
    },
    {
      id: "4",
      name: "Training Bot",
      type: "bot",
      description: "AI-powered training assistant",
      scenario: "Will simulate various customer scenarios to help train your agent"
    },
    {
      id: "5",
      name: "Robert Chen",
      type: "customer",
      description: "New customer with detailed technical questions",
      scenario: "Evaluating your product against competitors"
    },
    {
      id: "6",
      name: "Emily Davis",
      type: "customer",
      description: "Customer considering cancellation",
      scenario: "Unhappy with recent changes to your service"
    }
  ];

  const [hoveredPersonaId, setHoveredPersonaId] = useState<string | null>(null);
  
  const [showDirectCall, setShowDirectCall] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneNumberError, setPhoneNumberError] = useState('');
  const [selectedMic, setSelectedMic] = useState<string>("");
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>("");
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [availableSpeakers, setAvailableSpeakers] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (open && showDirectCall) {
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

      getDevices();

      navigator.mediaDevices.addEventListener('devicechange', getDevices);
      
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', getDevices);
      };
    }
  }, [open, showDirectCall]);

  const handleSelectPersona = (persona: UserPersona) => {
    onSelectPersona(persona);
    onOpenChange(false);
  };

  const validatePhoneNumber = (number: string) => {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(number);
  };

  const handleStartDirectCall = () => {
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
    
    if (onStartDirectCall) {
      onStartDirectCall(phoneNumber, {
        mic: selectedMic,
        speaker: selectedSpeaker
      });
      onOpenChange(false); // Close sidebar when starting call
    } else {
      console.error("Direct call handler is not defined");
      toast({
        title: "Function Error",
        description: "Direct call functionality is not available in this context.",
        variant: "destructive"
      });
      // Don't close the sidebar if we can't start a call
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={() => onOpenChange(false)}
      />
      
      <div className={cn(
        "fixed top-0 bottom-0 right-0 z-50 w-full max-w-md bg-white dark:bg-[#0F172A] border-l border-gray-200 dark:border-[#1E293B] shadow-xl transition-transform duration-300 ease-in-out overflow-hidden flex flex-col",
        open ? "translate-x-0" : "translate-x-full"
      )}>
        <div className="p-4 border-b border-gray-200 dark:border-[#1E293B] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              className="mr-2 rounded-full hover:bg-gray-100 dark:hover:bg-[#1E293B]"
              onClick={() => onOpenChange(false)}
            >
              <ArrowLeft className="h-5 w-5 text-gray-700 dark:text-white" />
            </Button>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Role-Play Options</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Choose a persona or call someone directly
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full hover:bg-gray-100 dark:hover:bg-[#1E293B]"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5 text-gray-700 dark:text-white" />
          </Button>
        </div>
        
        <ScrollArea className="flex-1 overflow-auto">
          {!showDirectCall ? (
            <div className="p-4 space-y-4">
              <div 
                className="border border-gray-200 dark:border-[#1E293B] rounded-lg bg-gray-50 dark:bg-[#111827] overflow-hidden cursor-pointer hover:bg-gray-100 dark:hover:bg-[#141e33] transition-colors p-4"
                onClick={() => setShowDirectCall(true)}
              >
                <div className="flex items-center gap-4 mb-3">
                  <div className="bg-gray-200 dark:bg-[#1E293B] rounded-full p-2">
                    <PhoneCall className="h-5 w-5 text-green-500 dark:text-green-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white">Direct Call</h3>
                    <Badge className="mt-1 px-3 py-0.5 rounded-full text-xs font-normal bg-gray-200 dark:bg-[#1E293B] text-gray-700 dark:text-gray-300">
                      Role-Play with a Colleague
                    </Badge>
                  </div>
                </div>
                
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Call a colleague or a real customer directly to practice your agent skills
                </p>
                
                <div className="bg-gray-200 dark:bg-[#1E293B] rounded p-3 text-xs text-gray-700 dark:text-gray-300 mb-2">
                  <span className="text-gray-600 dark:text-gray-400">Instructions:</span> You will pretend to be the agent while your colleague or customer plays the user role.
                </div>
              </div>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-[#1E293B]"></div>
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white dark:bg-[#0F172A] px-4 text-sm text-gray-500 dark:text-gray-400">Or choose a persona</span>
                </div>
              </div>
              
              {personas.map((persona) => (
                <div
                  key={persona.id}
                  className="border border-gray-200 dark:border-[#1E293B] rounded-lg bg-gray-50 dark:bg-[#111827] overflow-hidden cursor-pointer hover:bg-gray-100 dark:hover:bg-[#141e33] transition-colors relative"
                  onClick={() => handleSelectPersona(persona)}
                  onMouseEnter={() => setHoveredPersonaId(persona.id)}
                  onMouseLeave={() => setHoveredPersonaId(null)}
                >
                  <div className="p-4">
                    <div className="flex items-center gap-4 mb-3">
                      <div className="bg-gray-200 dark:bg-[#1E293B] rounded-full p-2">
                        {persona.type === "customer" ? (
                          <User className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                        ) : (
                          <Bot className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900 dark:text-white">{persona.name}</h3>
                        <Badge 
                          className={cn(
                            "mt-1 px-3 py-0.5 rounded-full text-xs font-normal",
                            persona.type === "bot" ? "bg-gray-200 dark:bg-[#1E293B] text-gray-700 dark:text-gray-300" : "bg-gray-200 dark:bg-[#1E293B] text-gray-700 dark:text-gray-300"
                          )}
                        >
                          {persona.type === "bot" ? "Training Bot" : "Customer"}
                        </Badge>
                      </div>
                    </div>
                    
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                      {persona.description}
                    </p>
                    
                    {persona.scenario && (
                      <div className="bg-gray-200 dark:bg-[#1E293B] rounded p-3 text-xs text-gray-700 dark:text-gray-300 mb-2">
                        <span className="text-gray-600 dark:text-gray-400">Scenario:</span> {persona.scenario}
                      </div>
                    )}
                  </div>

                  {hoveredPersonaId === persona.id && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 dark:bg-[#111827]/80 transition-opacity animate-fade-in">
                      <Button 
                        className="bg-green-500 hover:bg-green-600 text-white shadow-lg"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectPersona(persona);
                        }}
                      >
                        <PhoneCall className="h-5 w-5 mr-2" />
                        Start Call
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 space-y-5">
              <Button 
                variant="ghost" 
                size="sm"
                className="mb-2 text-gray-600 dark:text-gray-400"
                onClick={() => setShowDirectCall(false)}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to options
              </Button>
              
              <div className="bg-blue-50 dark:bg-[#1E293B]/50 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
                  <Info className="h-5 w-5 text-blue-500 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm">
                    Call a colleague or customer and ask them to pretend to be a user while you play the role of the agent. This will help you practice real customer interactions.
                  </p>
                </div>
              </div>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phoneNumber" className="text-gray-700 dark:text-gray-300">Phone Number</Label>
                  <Input
                    id="phoneNumber"
                    type="tel"
                    placeholder="+1234567890"
                    value={phoneNumber}
                    onChange={(e) => {
                      setPhoneNumber(e.target.value);
                      setPhoneNumberError('');
                    }}
                    className={`bg-white dark:bg-[#111827] border-gray-300 dark:border-[#1E293B] text-gray-900 dark:text-white ${phoneNumberError ? 'border-red-500' : ''}`}
                  />
                  {phoneNumberError && (
                    <p className="text-sm text-red-500">{phoneNumberError}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <Label className="text-gray-700 dark:text-gray-300">Microphone</Label>
                    <Select value={selectedMic} onValueChange={setSelectedMic}>
                      <SelectTrigger className="bg-white dark:bg-[#111827] border-gray-300 dark:border-[#1E293B] text-gray-900 dark:text-white">
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
                    <Label className="text-gray-700 dark:text-gray-300">Speaker</Label>
                    <Select value={selectedSpeaker} onValueChange={setSelectedSpeaker}>
                      <SelectTrigger className="bg-white dark:bg-[#111827] border-gray-300 dark:border-[#1E293B] text-gray-900 dark:text-white">
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

                <Button 
                  onClick={handleStartDirectCall} 
                  className="w-full mt-6 bg-green-500 hover:bg-green-600 text-white"
                  type="button"
                >
                  <PhoneCall className="mr-2 h-5 w-5" />
                  Start Call
                </Button>
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
};
