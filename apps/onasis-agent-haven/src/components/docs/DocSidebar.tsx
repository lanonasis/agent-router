import { Brain, Shield, Layers, Wrench, BookOpen, Network, FileText } from "lucide-react";
import { AGENT_SOURCE_MAP, SHARED_DOC_FILES } from "@/lib/agentSourceMap";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const SHARED_DOC_ICONS: Record<string, React.ReactNode> = {
  "Soul Identity": <Brain className="h-3.5 w-3.5" />,
  "Identity Layer": <Layers className="h-3.5 w-3.5" />,
  "Policies & Safety": <Shield className="h-3.5 w-3.5" />,
  "Tool Registry": <Wrench className="h-3.5 w-3.5" />,
  "Source of Truth": <BookOpen className="h-3.5 w-3.5" />,
};

interface DocSidebarProps {
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function DocSidebar({ activeId, onSelect }: DocSidebarProps) {
  return (
    <ScrollArea className="h-full">
      <div className="py-4 pr-2">
        {/* Shared docs */}
        <p className="text-[10px] font-semibold uppercase tracking-widest text-fgMuted mb-2 px-3">
          Shared Documents
        </p>
        <nav className="space-y-0.5">
          {SHARED_DOC_FILES.map((doc) => {
            const id = `shared:${doc.label}`;
            const icon = SHARED_DOC_ICONS[doc.label] || <FileText className="h-3.5 w-3.5" />;
            return (
              <button
                key={id}
                onClick={() => onSelect(id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-left",
                  activeId === id
                    ? "bg-brandPurple/10 text-brandPurple font-medium"
                    : "text-fgMuted hover:text-fg hover:bg-bgMuted"
                )}
              >
                {icon}
                <span className="truncate">{doc.label}</span>
              </button>
            );
          })}
        </nav>

        <Separator className="my-4" />

        {/* Agent docs */}
        <p className="text-[10px] font-semibold uppercase tracking-widest text-fgMuted mb-2 px-3">
          Agent Sources
        </p>
        <nav className="space-y-0.5">
          {AGENT_SOURCE_MAP.map((entry) => {
            const id = `agent:${entry.agentId}`;
            const isOrch = entry.role === "Orchestrator";
            return (
              <button
                key={id}
                onClick={() => onSelect(id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-left",
                  activeId === id
                    ? "bg-brandPurple/10 text-brandPurple font-medium"
                    : "text-fgMuted hover:text-fg hover:bg-bgMuted"
                )}
              >
                <Network className={cn("h-3.5 w-3.5", isOrch && "text-brandPurple")} />
                <span className="truncate">{entry.displayName}</span>
                {isOrch && (
                  <span className="ml-auto text-[9px] text-brandPurple bg-brandPurple/10 px-1.5 rounded">core</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </ScrollArea>
  );
}
