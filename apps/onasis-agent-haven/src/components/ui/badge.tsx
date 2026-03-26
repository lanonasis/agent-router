
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-focusRing focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-brandPurple text-white hover:bg-brandPurple/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-white hover:bg-destructive/80",
        outline: "border border-border text-fg dark:text-white hover:bg-bgMuted dark:hover:bg-bgMuted/50",
        agent: 
          "border-transparent bg-agent-primary text-white hover:bg-agent-primary/80 flex items-center",
        muted:
          "border-transparent bg-bgMuted text-fgMuted hover:bg-bgMuted/80 flex items-center",
        channel:
          "bg-transparent border border-border text-fgMuted hover:bg-bgMuted/50 flex items-center",
        new:
          "border-transparent bg-brandPurple text-white hover:bg-brandPurple/80 flex items-center",
        // Add a brand gradient badge
        gradient: 
          "border-transparent bg-gradient-to-r from-brandBlue to-brandPink text-white hover:opacity-90 flex items-center",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
