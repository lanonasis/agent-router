
import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface CustomTooltipProps {
  trigger: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
}

export const CustomTooltip = ({
  trigger,
  content,
  side = "bottom",
  align = "center",
  className
}: CustomTooltipProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Position the tooltip based on side and alignment
  const getPosition = () => {
    switch (side) {
      case "top":
        return "bottom-full mb-2";
      case "right":
        return "left-full ml-2";
      case "bottom":
        return "top-full mt-2";
      case "left":
        return "right-full mr-2";
      default:
        return "top-full mt-2";
    }
  };

  const getAlignment = () => {
    switch (align) {
      case "start":
        return side === "top" || side === "bottom" ? "left-0" : "top-0";
      case "end":
        return side === "top" || side === "bottom" ? "right-0" : "bottom-0";
      case "center":
        return side === "top" || side === "bottom" ? "left-1/2 -translate-x-1/2" : "top-1/2 -translate-y-1/2";
      default:
        return "left-1/2 -translate-x-1/2";
    }
  };

  // Close tooltip when clicking outside of it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-block" ref={tooltipRef}>
      <div onClick={() => setIsOpen(!isOpen)} className="cursor-pointer">
        {trigger}
      </div>
      
      {isOpen && (
        <div
          className={cn(
            "absolute z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95",
            getPosition(),
            getAlignment(),
            className
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
};
