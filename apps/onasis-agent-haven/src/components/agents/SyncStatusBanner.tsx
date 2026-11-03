import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RouterCatalog } from "@/services/routerCatalog";
import type { CatalogError } from "@/hooks/useRouterCatalog";

interface Props {
  catalog: RouterCatalog | null;
  error: CatalogError | null;
  isLoading: boolean;
  lastSyncedAt: number | null;
  documentedNotServed: number;
  onRefresh: () => void;
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function SyncStatusBanner({ catalog, error, isLoading, lastSyncedAt, documentedNotServed, onRefresh }: Props) {
  const now = useNow();
  const ago = lastSyncedAt ? Math.max(0, Math.round((now - lastSyncedAt) / 1000)) : null;

  let tone = "border-border bg-bgMuted/40";
  let Icon = Loader2;
  let iconClass = "text-fgMuted animate-spin";
  let text = "Router sync: checking which personas the router is serving…";
  let hint: string | null = null;

  if (catalog) {
    const gap = documentedNotServed > 0;
    tone = gap ? "border-warning/40 bg-warning/5" : "border-success/40 bg-success/5";
    Icon = gap ? AlertTriangle : CheckCircle2;
    iconClass = gap ? "text-warning" : "text-success";
    text =
      `Router sync: ${plural(catalog.personas.length, "live persona")} · ` +
      `${plural(catalog.profiles.length, "profile")} · ` +
      `${plural(documentedNotServed, "documented agent")} not served` +
      (ago !== null ? ` · last synced ${ago}s ago` : "");
  } else if (error) {
    tone = "border-warning/40 bg-warning/5";
    Icon = CloudOff;
    iconClass = "text-warning";
    if (error.kind === "not-deployed") {
      text = "Router sync unavailable: this router version doesn't publish a persona catalog yet.";
      hint = "Documented agents are still shown below. Update the router to see live personas. Router address is set in";
    } else if (error.kind === "unreachable") {
      text = "Router sync unavailable: the router can't be reached from this browser.";
      hint = "Documented agents are still shown below. Check the router address in";
    } else {
      text = `Router sync unavailable: ${error.message}`;
      hint = "Documented agents are still shown below. Check the router connection in";
    }
  }

  return (
    <div role="status" aria-live="polite" className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${tone}`}>
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${iconClass}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-fg">{text}</p>
        {hint && (
          <p className="text-xs text-fgMuted mt-0.5">
            {hint}{" "}
            <Link to="/settings" className="underline underline-offset-2 hover:text-fg">
              Settings
            </Link>
            .
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 shrink-0"
        onClick={onRefresh}
        disabled={isLoading}
        aria-label="Refresh router sync"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
        Refresh
      </Button>
    </div>
  );
}
