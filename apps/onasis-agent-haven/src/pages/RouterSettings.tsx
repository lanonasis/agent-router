import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, Loader2, Eye, EyeOff, RotateCcw, Stethoscope, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  BUILD_ROUTER_URL,
  normaliseRouterUrl,
  resetRouterSettings,
  saveRouterSettings,
  useRouterSettings,
  hasRouterCredential,
} from "@/lib/routerSettings";
import { runRouterDiagnostics, type CheckState, type DiagnosticCheck } from "@/services/routerDiagnostics";

const STATE_ICON: Record<CheckState, React.ReactNode> = {
  pass: <CheckCircle2 className="h-4 w-4 text-success" />,
  warn: <AlertTriangle className="h-4 w-4 text-warning" />,
  fail: <XCircle className="h-4 w-4 text-destructive" />,
  skip: <MinusCircle className="h-4 w-4 text-fgMuted" />,
};

export default function RouterSettings() {
  const settings = useRouterSettings();
  const [url, setUrl] = useState(settings.url);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [showKey, setShowKey] = useState(false);
  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [ranAt, setRanAt] = useState<Date | null>(null);

  useEffect(() => {
    setUrl(settings.url);
    setApiKey(settings.apiKey);
  }, [settings.url, settings.apiKey]);

  const dirty = normaliseRouterUrl(url) !== settings.url || apiKey.trim() !== settings.apiKey;

  const runTests = async (target = { ...settings, url: normaliseRouterUrl(url), apiKey: apiKey.trim() }) => {
    setRunning(true);
    try {
      setChecks(await runRouterDiagnostics(target));
      setRanAt(new Date());
    } finally {
      setRunning(false);
    }
  };

  const save = () => {
    saveRouterSettings({ url, apiKey });
    toast.success("Router connection saved");
  };

  const cred = hasRouterCredential({ ...settings, apiKey: apiKey.trim() });
  const failed = checks?.some((c) => c.state === "fail");

  return (
    <div className="max-w-3xl mx-auto space-y-6 text-fg">
      <div>
        <Link to="/agents" className="text-xs text-fgMuted hover:text-fg font-mono">← agents</Link>
        <h1 className="text-3xl font-bold tracking-tight mt-1">Router Settings</h1>
        <p className="text-sm text-fgMuted mt-1">
          Where this dashboard finds the AI router. Test it here before relying on the live topology or activity feed.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-bgMuted/40 p-5 space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="router-url">Router address</Label>
            <Badge variant="outline" className="font-mono text-[10px]">
              {settings.isOverride ? "saved in this browser" : "build default"}
            </Badge>
          </div>
          <Input
            id="router-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://ai.vortexcore.app"
            className="font-mono"
            spellCheck={false}
          />
          <p className="text-xs text-fgMuted font-mono">build default: {BUILD_ROUTER_URL}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="router-key">Router API key <span className="text-fgMuted font-normal">(optional)</span></Label>
          <div className="flex gap-2">
            <Input
              id="router-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="lano_…"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="button" variant="outline" size="icon" onClick={() => setShowKey((s) => !s)} aria-label={showKey ? "Hide key" : "Show key"}>
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-fgMuted">
            Used only for the activity feed and signed-in health check. Stored in this browser only.{" "}
            {cred === "session" && !apiKey.trim() && "Without a key, your signed-in session is used."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={!dirty} className="gap-1.5"><Save className="h-4 w-4" /> Save</Button>
          <Button variant="outline" onClick={() => runTests()} disabled={running} className="gap-1.5">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
            Test connection
          </Button>
          <Button
            variant="ghost"
            onClick={() => { resetRouterSettings(); setChecks(null); toast("Reset to build default"); }}
            disabled={!settings.isOverride && !settings.apiKey}
            className="gap-1.5 text-fgMuted"
          >
            <RotateCcw className="h-4 w-4" /> Reset
          </Button>
        </div>
      </section>

      {checks && (
        <section className="rounded-xl border border-border bg-bg p-5 space-y-3" aria-live="polite">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Connection test</h2>
            <span className="text-xs font-mono text-fgMuted">
              {ranAt?.toLocaleTimeString()} · from {window.location.origin}
            </span>
          </div>
          <ol className="space-y-2">
            {checks.map((c) => (
              <li key={c.id} className="flex gap-3 rounded-lg border border-border px-3 py-2.5">
                <span className="mt-0.5">{STATE_ICON[c.state]}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{c.label}</div>
                  <div className="text-xs text-fgMuted font-mono break-words">{c.detail}</div>
                  {c.fix && <div className="text-xs mt-1 text-fg">→ {c.fix}</div>}
                </div>
              </li>
            ))}
          </ol>
          {!failed && dirty && (
            <p className="text-xs text-success">Looks good — press Save to use this connection.</p>
          )}
        </section>
      )}
    </div>
  );
}
