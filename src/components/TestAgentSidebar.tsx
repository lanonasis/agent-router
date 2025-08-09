import React, { useState, useRef } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { AgentType } from "@/types/agent";
import { Mic, PhoneOutgoing, PhoneIncoming, MessageSquare, Bot, Rocket, ArrowUp } from "lucide-react";
import { LiveTranscription } from "@/components/LiveTranscription";

interface TestAgentSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AgentType | null;
  onStartDirectCall: (phoneNumber: string, deviceSettings: { mic: string; speaker: string }) => void;
  onStartChat: () => void;
}

export const TestAgentSidebar: React.FC<TestAgentSidebarProps> = ({
  open,
  onOpenChange,
  agent,
  onStartDirectCall,
  onStartChat
}) => {
  const [activeTab, setActiveTab] = useState<string>("chat");
  const [callType, setCallType] = useState<"inbound" | "outbound">("inbound");
  const [phoneNumber, setPhoneNumber] = useState<string>("");
  const [selectedMic, setSelectedMic] = useState<string>("");
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>("");
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [availableSpeakers, setAvailableSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [chatMessage, setChatMessage] = useState<string>("");
  const [chatMessages, setChatMessages] = useState<{role: "system" | "user"; text: string}[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasStartedChat, setHasStartedChat] = useState(false);

  React.useEffect(() => {
    if (open) {
      const getDevices = async () => {
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true })
            .then((stream) => {
              stream.getTracks().forEach((track) => track.stop());
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
        }
      };
      
      getDevices();

      const deviceChangeHandler = () => getDevices();
      navigator.mediaDevices.addEventListener('devicechange', deviceChangeHandler);
      
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', deviceChangeHandler);
      };
    }
  }, [open]);

  const handleStartInboundCall = () => {
    onStartDirectCall(agent?.channelConfigs?.voice?.details || "+1 (800) 555-1234", {
      mic: selectedMic,
      speaker: selectedSpeaker
    });
    onOpenChange(false);
  };

  const handleStartOutboundCall = () => {
    if (phoneNumber) {
      onStartDirectCall(phoneNumber, {
        mic: selectedMic,
        speaker: selectedSpeaker
      });
      onOpenChange(false);
    }
  };

  const handleSendMessage = () => {
    if (chatMessage.trim()) {
      const newMessages = [...chatMessages, { role: "user" as const, text: chatMessage }];
      setChatMessages(newMessages);
      
      setChatMessage("");
      
      setIsProcessing(true);
      setTimeout(() => {
        const agentResponse = { 
          role: "system" as const, 
          text: `I'm ${agent?.name || 'the AI assistant'}, and I'm here to help. ${chatMessage.length > 30 ? 'That\'s an interesting point you raised.' : 'How can I assist you today?'}` 
        };
        setChatMessages([...newMessages, agentResponse]);
        setIsProcessing(false);
      }, 1000);
      
      if (!hasStartedChat) {
        setHasStartedChat(true);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0 pt-0">
        <div className="flex flex-col h-full overflow-hidden">
          <SheetHeader className="space-y-2 p-6 pb-2">
            <SheetTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-primary" />
              Test Agent
            </SheetTitle>
            <SheetDescription>
              Choose how you want to test and interact with your agent.
            </SheetDescription>
          </SheetHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col h-full overflow-hidden">
            <TabsList className="grid grid-cols-2 mx-6 mb-4">
              <TabsTrigger value="voice" className="flex items-center gap-2">
                <Mic className="h-4 w-4" />
                Voice
              </TabsTrigger>
              <TabsTrigger value="chat" className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Chat
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="voice" className="space-y-4 flex-1 overflow-y-auto px-6 pb-6">
              <div className="grid gap-4 mb-4 flex-1">
                {callType === "inbound" ? (
                  <Card className="p-4">
                    <div className="font-medium mb-2 flex items-center gap-2">
                      <PhoneIncoming className="h-4 w-4 text-green-500" />
                      Call Your Agent
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      Try your agent by calling them directly. Your agent will answer your call.
                    </p>
                    
                    <div className="space-y-3 mb-4">
                      <div className="grid gap-2">
                        <Label htmlFor="mic-input">Microphone</Label>
                        <Select value={selectedMic} onValueChange={setSelectedMic}>
                          <SelectTrigger id="mic-input">
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
                      
                      <div className="grid gap-2">
                        <Label htmlFor="speaker-output">Speaker</Label>
                        <Select value={selectedSpeaker} onValueChange={setSelectedSpeaker}>
                          <SelectTrigger id="speaker-output">
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
                    
                    <Button onClick={handleStartInboundCall} className="w-full">
                      Start Inbound Call
                    </Button>
                  </Card>
                ) : (
                  <Card className="p-4">
                    <div className="font-medium mb-2 flex items-center gap-2">
                      <PhoneOutgoing className="h-4 w-4 text-blue-500" />
                      Get a Call from Your Agent
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      Try your agent by having them call you at your preferred number.
                    </p>
                    
                    <div className="space-y-3 mb-4">
                      <div className="grid gap-2">
                        <Label htmlFor="phone-number">Phone Number</Label>
                        <Input
                          id="phone-number"
                          placeholder="+1 (555) 123-4567"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                        />
                      </div>
                      
                      <div className="grid gap-2">
                        <Label htmlFor="mic-input">Microphone</Label>
                        <Select value={selectedMic} onValueChange={setSelectedMic}>
                          <SelectTrigger id="mic-input">
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
                      
                      <div className="grid gap-2">
                        <Label htmlFor="speaker-output">Speaker</Label>
                        <Select value={selectedSpeaker} onValueChange={setSelectedSpeaker}>
                          <SelectTrigger id="speaker-output">
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
                    
                    <Button 
                      onClick={handleStartOutboundCall} 
                      className="w-full"
                      disabled={!phoneNumber}
                    >
                      Start Outbound Call
                    </Button>
                  </Card>
                )}
                
                <div className="flex items-center gap-2 mt-2">
                  <RadioGroup value={callType} onValueChange={(value: "inbound" | "outbound") => setCallType(value)} className="flex space-x-4">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="inbound" id="inbound" />
                      <Label htmlFor="inbound" className="cursor-pointer">Inbound Call</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="outbound" id="outbound" />
                      <Label htmlFor="outbound" className="cursor-pointer">Outbound Call</Label>
                    </div>
                  </RadioGroup>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="chat" className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="flex flex-col h-full px-6 pb-6">
                <LiveTranscription 
                  messages={chatMessages}
                  isCallActive={isProcessing}
                  className="flex-1 mb-4 overflow-y-auto"
                />
                
                <div className="relative mt-auto">
                  <Textarea
                    placeholder="Type your message..."
                    className="min-h-[60px] max-h-[120px] resize-none pr-12 py-3 rounded-lg bg-background"
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                  <Button 
                    size="icon" 
                    className="absolute bottom-3 right-3 h-8 w-8 rounded-full"
                    onClick={handleSendMessage}
                    disabled={!chatMessage.trim() || isProcessing}
                    variant="ghost"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
};
