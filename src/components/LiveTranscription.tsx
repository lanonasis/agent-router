
import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Bot, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  role: "system" | "user";
  text: string;
}

interface LiveTranscriptionProps {
  messages: Message[];
  isCallActive: boolean;
  className?: string;
}

export const LiveTranscription: React.FC<LiveTranscriptionProps> = ({ 
  messages,
  isCallActive,
  className
}) => {
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Scroll to bottom whenever messages change
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <div className={cn("border border-border rounded-md p-4 overflow-y-auto bg-bgMuted/10 flex-1 h-full flex flex-col", className)}>
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-center text-fgMuted my-auto">
          <Bot className="h-12 w-12 mb-4 text-fgMuted/50" />
          <p className="text-lg">Your conversation will appear here</p>
          <p className="text-sm">The AI will guide you through creating your agent</p>
        </div>
      ) : (
        <div className="space-y-4 w-full flex-1">
          {messages.map((message, index) => (
            <div 
              key={index} 
              className={cn(
                "flex gap-3", 
                message.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {message.role === "system" && (
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarImage src={`https://api.dicebear.com/7.x/bottts/svg?seed=agent`} />
                  <AvatarFallback>
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              )}
              
              <div 
                className={cn(
                  "rounded-lg py-2 px-3 max-w-[80%]",
                  message.role === "system" 
                    ? "bg-bgMuted text-fgMuted" 
                    : "bg-brandPurple text-white"
                )}
              >
                <p>{message.text}</p>
              </div>
              
              {message.role === "user" && (
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarFallback className="bg-brandBlue text-white">
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}
          
          {isCallActive && messages.length > 0 && (
            <div className="flex justify-start gap-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={`https://api.dicebear.com/7.x/bottts/svg?seed=agent`} />
                <AvatarFallback>
                  <Bot className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              <div className="bg-bgMuted rounded-lg py-2 px-3 flex items-center gap-2">
                <span className="inline-block h-2 w-2 bg-brandPurple rounded-full animate-pulse"></span>
                <span className="inline-block h-2 w-2 bg-brandPurple rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></span>
                <span className="inline-block h-2 w-2 bg-brandPurple rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></span>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  );
};
