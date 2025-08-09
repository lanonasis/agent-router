
import React, { useState, useEffect } from "react";
import { Mic, MessageSquare, Smartphone, Mail, MessageCircle, Search, DollarSign, Phone, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface AgentChannelConfig {
  enabled: boolean;
  details?: string;
  config?: Record<string, any>;
}

interface AgentChannelsProps {
  channels?: Record<string, AgentChannelConfig>;
  onUpdateChannel?: (channel: string, config: AgentChannelConfig) => void;
  readonly?: boolean;
  compact?: boolean;
  showDetails?: boolean;
  className?: string;
  hideContactInfo?: boolean;
}

interface ChannelInfo {
  name: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  placeholder: string;
}

interface PhoneNumberOption {
  number: string;
  areaCode: string;
  isTollFree: boolean;
  price: number;
  type: string;
  available: boolean;
}

const CHANNEL_INFO: Record<string, ChannelInfo> = {
  "voice": {
    name: "Voice",
    icon: <Mic className="h-3.5 w-3.5" />,
    color: "text-blue-500",
    bgColor: "bg-blue-500",
    placeholder: "+1 (800) 123-4567"
  },
  "chat": {
    name: "Chat",
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    color: "text-purple-500",
    bgColor: "bg-purple-500",
    placeholder: "https://yourwebsite.com/chat"
  },
  "sms": {
    name: "Sms",
    icon: <Smartphone className="h-3.5 w-3.5" />,
    color: "text-orange-500",
    bgColor: "bg-orange-500",
    placeholder: "+1 (800) 123-4567"
  },
  "email": {
    name: "Email",
    icon: <Mail className="h-3.5 w-3.5" />,
    color: "text-red-500",
    bgColor: "bg-red-500",
    placeholder: "support@yourcompany.com"
  },
  "whatsapp": {
    name: "Whatsapp",
    icon: <MessageCircle className="h-3.5 w-3.5" />,
    color: "text-green-500",
    bgColor: "bg-green-500",
    placeholder: "+1 (555) 987-6543"
  }
};

const SAMPLE_PHONE_NUMBERS: PhoneNumberOption[] = [
  { number: "+1 (800) 555-0123", areaCode: "800", isTollFree: true, price: 5, type: "Toll-Free", available: true },
  { number: "+1 (844) 555-0124", areaCode: "844", isTollFree: true, price: 5, type: "Toll-Free", available: true },
  { number: "+1 (855) 555-0125", areaCode: "855", isTollFree: true, price: 5, type: "Toll-Free", available: true },
  { number: "+1 (866) 555-0126", areaCode: "866", isTollFree: true, price: 5, type: "Toll-Free", available: true },
  { number: "+1 (877) 555-0127", areaCode: "877", isTollFree: true, price: 5, type: "Toll-Free", available: true },
  { number: "+1 (888) 555-0128", areaCode: "888", isTollFree: true, price: 5, type: "Toll-Free", available: true },
  { number: "+1 (212) 555-0129", areaCode: "212", isTollFree: false, price: 3, type: "New York", available: true },
  { number: "+1 (213) 555-0130", areaCode: "213", isTollFree: false, price: 3, type: "Los Angeles", available: true },
  { number: "+1 (312) 555-0131", areaCode: "312", isTollFree: false, price: 3, type: "Chicago", available: true },
  { number: "+1 (415) 555-0132", areaCode: "415", isTollFree: false, price: 3, type: "San Francisco", available: true },
  { number: "+1 (305) 555-0133", areaCode: "305", isTollFree: false, price: 3, type: "Miami", available: true },
  { number: "+1 (404) 555-0134", areaCode: "404", isTollFree: false, price: 3, type: "Atlanta", available: true },
  { number: "+1 (512) 555-0135", areaCode: "512", isTollFree: false, price: 3, type: "Austin", available: true },
  { number: "+1 (702) 555-0136", areaCode: "702", isTollFree: false, price: 3, type: "Las Vegas", available: true },
  { number: "+1 (206) 555-0137", areaCode: "206", isTollFree: false, price: 3, type: "Seattle", available: true },
  { number: "+1 (303) 555-0138", areaCode: "303", isTollFree: false, price: 3, type: "Denver", available: true },
];

const ALL_CHANNELS = Object.keys(CHANNEL_INFO);

export const AgentChannels: React.FC<AgentChannelsProps> = ({ 
  channels = {}, 
  onUpdateChannel,
  readonly = false,
  compact = false,
  showDetails = false,
  className = "",
  hideContactInfo = false
}) => {
  const [activeDialogChannel, setActiveDialogChannel] = useState<string | null>(null);
  const [channelDetails, setChannelDetails] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedPhoneNumber, setSelectedPhoneNumber] = useState<string>("");
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumberOption[]>(SAMPLE_PHONE_NUMBERS);
  const [filterTollFree, setFilterTollFree] = useState<boolean | null>(null);
  const { toast } = useToast();

  const normalizedChannels = ALL_CHANNELS.reduce((acc, channel) => {
    acc[channel] = channels[channel] || { enabled: false };
    return acc;
  }, {} as Record<string, AgentChannelConfig>);
  
  const enabledChannels = Object.entries(normalizedChannels)
    .filter(([_, config]) => config.enabled)
    .map(([channel]) => channel);
  
  if (readonly || compact) {
    if (!enabledChannels.length) return null;
    
    return (
      <div className={`flex flex-wrap gap-2 ${compact ? "mt-0" : "mt-1"} ${className}`}>
        {enabledChannels.map((channel) => {
          const info = CHANNEL_INFO[channel];
          const details = normalizedChannels[channel]?.details;
          
          return (
            <Badge 
              key={channel}
              variant="channel"
              className="px-2 py-0.5 flex items-center gap-1"
            >
              {info.icon}
              <span className="text-[0.6rem] capitalize">{channel}</span>
              {showDetails && details && !hideContactInfo && (
                <span className="text-[0.6rem] ml-1 opacity-80">{details}</span>
              )}
            </Badge>
          );
        })}
      </div>
    );
  }

  const filteredPhoneNumbers = phoneNumbers.filter((phone) => {
    const matchesQuery = searchQuery === "" || 
      phone.number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      phone.areaCode.includes(searchQuery) || 
      phone.type.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesTollFree = filterTollFree === null || phone.isTollFree === filterTollFree;
    
    return matchesQuery && matchesTollFree;
  });

  const handleToggleChannel = (channel: string, enabled: boolean) => {
    if (onUpdateChannel) {
      const currentConfig = normalizedChannels[channel] || { enabled: false };
      onUpdateChannel(channel, { ...currentConfig, enabled });
    }
  };

  const handleOpenConfigDialog = (channel: string) => {
    setActiveDialogChannel(channel);
    setChannelDetails(normalizedChannels[channel]?.details || "");
    
    if (channel === 'voice') {
      setSearchQuery("");
      setFilterTollFree(null);
      setSelectedPhoneNumber(normalizedChannels[channel]?.details || "");
    }
  };

  const handleSaveConfig = () => {
    if (activeDialogChannel && onUpdateChannel) {
      const currentConfig = normalizedChannels[activeDialogChannel] || { enabled: false };
      const details = activeDialogChannel === 'voice' && selectedPhoneNumber 
        ? selectedPhoneNumber 
        : channelDetails;
        
      onUpdateChannel(activeDialogChannel, {
        ...currentConfig,
        details: details
      });
      setActiveDialogChannel(null);
    }
  };

  const handlePurchasePhoneNumber = (phoneNumber: string) => {
    setSelectedPhoneNumber(phoneNumber);
    toast({
      title: "Phone Number Selected",
      description: `${phoneNumber} has been selected. You will be charged $5/month when you save.`,
    });
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleToggleTollFree = (value: boolean | null) => {
    setFilterTollFree(value);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
      {ALL_CHANNELS.map((channel) => {
        const channelConfig = normalizedChannels[channel];
        const info = CHANNEL_INFO[channel];
        
        return (
          <div 
            key={channel}
            className="bg-white/90 dark:bg-black/40 rounded-lg border border-gray-200 dark:border-gray-800 p-4 flex flex-col shadow-sm"
          >
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <span className={info.color}>{info.icon}</span>
                <span className="font-medium text-gray-800 dark:text-white">{info.name}</span>
              </div>
              <Switch
                checked={channelConfig.enabled}
                onCheckedChange={(checked) => handleToggleChannel(channel, checked)}
              />
            </div>
            
            {channelConfig.details ? (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 truncate">{channelConfig.details}</p>
            ) : (
              <p className="text-sm text-gray-500 mb-4 italic">No configuration</p>
            )}
            
            <Dialog>
              <DialogTrigger asChild>
                <Button 
                  variant="outline" 
                  className="mt-auto border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-white"
                  onClick={() => handleOpenConfigDialog(channel)}
                >
                  Configure
                </Button>
              </DialogTrigger>
              
              {activeDialogChannel === channel && (
                <DialogContent className="sm:max-w-md bg-white dark:bg-black text-gray-800 dark:text-white border-gray-200 dark:border-gray-700">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <span className={info.color}>{info.icon}</span>
                      Configure {info.name}
                    </DialogTitle>
                  </DialogHeader>
                  
                  <div className="space-y-4 py-4">
                    {channel === 'voice' ? (
                      <div className="space-y-4">
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                            <Input
                              placeholder="Search by area code, location..."
                              className="pl-9 bg-white/90 dark:bg-black/30 border-gray-300 dark:border-gray-700 text-gray-800 dark:text-white"
                              value={searchQuery}
                              onChange={handleSearchChange}
                            />
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant={filterTollFree === null ? "secondary" : "outline"}
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => handleToggleTollFree(null)}
                          >
                            All
                          </Button>
                          <Button
                            variant={filterTollFree === true ? "secondary" : "outline"}
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => handleToggleTollFree(true)}
                          >
                            Toll-Free
                          </Button>
                          <Button
                            variant={filterTollFree === false ? "secondary" : "outline"}
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => handleToggleTollFree(false)}
                          >
                            Local
                          </Button>
                        </div>
                        
                        {selectedPhoneNumber && (
                          <div className="flex items-center justify-between p-2 bg-agent-primary/10 rounded border border-agent-primary/20">
                            <div className="flex items-center gap-2">
                              <Phone className="h-4 w-4 text-agent-primary" />
                              <span className="text-sm">{selectedPhoneNumber}</span>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                              <DollarSign className="h-3 w-3" />
                              <span>$5/month</span>
                            </div>
                          </div>
                        )}
                        
                        <ScrollArea className="h-[300px] pr-4 -mr-4">
                          <div className="space-y-2">
                            {filteredPhoneNumbers.length > 0 ? (
                              filteredPhoneNumbers.map((phone) => (
                                <div 
                                  key={phone.number}
                                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-900/80 transition-colors"
                                >
                                  <div className="flex flex-col">
                                    <span className="font-medium">{phone.number}</span>
                                    <div className="flex items-center gap-1.5 mt-1">
                                      <Badge variant="outline" className="text-[0.65rem] h-4 px-1.5 bg-gray-100 dark:bg-gray-800">
                                        {phone.type}
                                      </Badge>
                                      {phone.isTollFree && (
                                        <Badge className="text-[0.65rem] h-4 px-1.5 bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-200">
                                          Toll-Free
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button size="sm" className="bg-agent-primary hover:bg-agent-primary/90 text-white">
                                        <DollarSign className="h-3 w-3 mr-1" />
                                        ${phone.price}/mo
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent className="bg-white dark:bg-black border-gray-200 dark:border-gray-700 text-gray-800 dark:text-white">
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Confirm Phone Number Purchase</AlertDialogTitle>
                                        <AlertDialogDescription className="text-gray-600 dark:text-gray-400">
                                          You are about to select {phone.number} for your voice channel. 
                                          This will cost ${phone.price}/month. You will not be charged 
                                          until you save your changes.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel className="bg-white dark:bg-transparent border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-white">
                                          Cancel
                                        </AlertDialogCancel>
                                        <AlertDialogAction 
                                          className="bg-agent-primary hover:bg-agent-primary/90"
                                          onClick={() => handlePurchasePhoneNumber(phone.number)}
                                        >
                                          Select Number
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                              ))
                            ) : (
                              <div className="flex flex-col items-center justify-center py-8 text-center text-gray-500">
                                <Search className="h-8 w-8 mb-2 opacity-50" />
                                <p>No phone numbers found matching your search criteria.</p>
                                <p className="text-sm mt-1">Try a different search term or filter.</p>
                              </div>
                            )}
                          </div>
                        </ScrollArea>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor={`${channel}-details`}>
                          {channel === 'sms' || channel === 'whatsapp' 
                            ? 'Phone Number' 
                            : channel === 'chat' 
                              ? 'URL' 
                              : 'Email Address'}
                        </Label>
                        <Input
                          id={`${channel}-details`}
                          placeholder={info.placeholder}
                          value={channelDetails}
                          onChange={(e) => setChannelDetails(e.target.value)}
                          className="bg-white/90 dark:bg-black/30 border-gray-300 dark:border-gray-700 text-gray-800 dark:text-white"
                        />
                      </div>
                    )}
                  </div>
                  
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setActiveDialogChannel(null)}
                      className="bg-white dark:bg-transparent border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-white"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSaveConfig}
                      className="bg-agent-primary hover:bg-agent-primary/90"
                    >
                      Save Changes
                    </Button>
                  </div>
                </DialogContent>
              )}
            </Dialog>
          </div>
        );
      })}
    </div>
  );
};
