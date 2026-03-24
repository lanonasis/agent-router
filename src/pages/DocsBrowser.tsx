import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, PanelLeftClose, PanelLeft } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DocSidebar } from "@/components/docs/DocSidebar";
import { DocContentPanel } from "@/components/docs/DocContentPanel";
import { cn } from "@/lib/utils";

const DocsBrowser = () => {
  const [activeId, setActiveId] = useState<string | null>("shared:Source of Truth");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleSelect = (id: string) => {
    setActiveId(id);
    // Auto-close sidebar on mobile after selection
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <Link to="/agents" className="inline-flex items-center text-fgMuted hover:text-fg transition-colors text-sm mb-3">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Agent System
          </Link>
          <h1 className="text-3xl font-bold text-fg tracking-tight">Documentation</h1>
          <p className="text-fgMuted mt-1 text-sm max-w-xl">
            Canonical source files that define the agent architecture. Content is mirrored from <code className="text-xs bg-bgMuted px-1.5 py-0.5 rounded border border-border">docs/agent_model_files/</code> into the app's data layer.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <Separator />

      {/* Two-panel layout */}
      <div className="flex gap-0 border border-border rounded-lg overflow-hidden bg-bg min-h-[70vh] relative">
        {/* Sidebar toggle for mobile */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="md:hidden absolute top-2 left-2 z-10 p-1.5 rounded-md bg-bgMuted border border-border text-fgMuted hover:text-fg transition-colors"
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
        </button>

        {/* Sidebar */}
        <div
          className={cn(
            "shrink-0 border-r border-border bg-bgMuted/30 transition-all duration-200",
            sidebarOpen
              ? "w-56 md:w-56"
              : "w-0 overflow-hidden border-r-0",
            // On mobile when open, overlay
            sidebarOpen && "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-[5] max-md:w-56 max-md:bg-bg max-md:shadow-lg"
          )}
        >
          <DocSidebar activeId={activeId} onSelect={handleSelect} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <ScrollArea className="h-[70vh]">
            <div className="p-6 md:pl-8">
              <DocContentPanel activeId={activeId} />
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
};

export default DocsBrowser;
