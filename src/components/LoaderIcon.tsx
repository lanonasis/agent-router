
import { Loader } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoaderIconProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
}

export function LoaderIcon({ className, size = 16, ...props }: LoaderIconProps) {
  return (
    <div className={cn("animate-spin", className)} {...props}>
      <Loader size={size} />
    </div>
  );
}
