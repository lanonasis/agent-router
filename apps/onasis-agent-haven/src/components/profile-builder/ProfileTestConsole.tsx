import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2, Send } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listUseCases, type CatalogLike } from "@/lib/profileManifest";
import { hasRouterCredential, type RouterSettings } from "@/lib/routerSettings";
import { sendRouterChat, type ChatRun } from "@/services/profileTestService";

const MAX_HISTORY = 5;

interface ProfileTestConsoleProps {
  settings: RouterSettings;
  catalog?: CatalogLike;
  /** Use case to preselect: the manifest's boundUseCase, else the agent's mapped lane. */
  defaultUseCase?: string;
  /** Profile id offered for the optional X-Onasis-Profile header. */
  profileId?: string | null;
}

let runCounter = 0;

export function ProfileTestConsole({ settings, catalog, defaultUseCase, profileId }: ProfileTestConsoleProps) {
  const useCases = listUseCases(catalog);
  const [useCase, setUseCase] = useState(defaultUseCase || "ask-ai");
  const [prompt, setPrompt] = useState("");
  const [sendHeader, setSendHeader] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ChatRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Follow the manifest's bound use case when it changes.
  useEffect(() => {
    if (defaultUseCase) setUseCase(defaultUseCase);
  }, [defaultUseCase]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const credential = hasRouterCredential(settings);
  const shown = history.find((r) => r.id === selectedId) ?? history[0] ?? null;
  const options = useCases.some((u) => u.useCase === useCase) ? useCases : [{ useCase, description: "" }, ...useCases];

  const handleSend = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    const headerValue = sendHeader && profileId ? profileId : null;
    try {
      const result = await sendRouterChat(settings, { useCase, prompt: text, profileId: headerValue }, controller.signal);
      const run: ChatRun = {
        ...result,
        id: `run-${++runCounter}`,
        at: Date.now(),
        requestedUseCase: useCase,
        prompt: text,
        profileHeaderSent: headerValue,
      };
      setHistory((h) => [run, ...h].slice(0, MAX_HISTORY));
      setSelectedId(run.id);
    } catch {
      /* aborted on unmount */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Test console</CardTitle>
        <CardDescription>
          Send one prompt to a router lane and see exactly what came back. Single user message, no system prompt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!credential && (
          <Alert>
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              No router credential is set, so the router will likely answer 401. Add an API key in{" "}
              <Link to="/settings" className="underline underline-offset-2">Settings</Link>.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="test-use-case" className="text-xs">
              Use case (lane)
            </Label>
            <Select value={useCase} onValueChange={setUseCase}>
              <SelectTrigger id="test-use-case" className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((u) => (
                  <SelectItem key={u.useCase} value={u.useCase} className="text-xs">
                    {u.useCase}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="test-prompt" className="text-xs">
              Prompt
            </Label>
            <Textarea
              id="test-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Ask something this profile should handle…"
              className="min-h-[88px] text-sm"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-start gap-2">
            <Checkbox
              id="send-profile-header"
              checked={sendHeader}
              onCheckedChange={(v) => setSendHeader(v === true)}
              disabled={!profileId}
              className="mt-0.5"
            />
            <Label htmlFor="send-profile-header" className="text-xs leading-snug font-normal">
              Send profile header{profileId ? <> (<code className="font-mono">X-Onasis-Profile: {profileId}</code>)</> : " (generate a manifest first)"}
            </Label>
          </div>
          <p className="text-xs text-fgMuted pl-6">
            Profile activation requires an entitlement on your credential. Without one the router ignores or refuses the header (HTTP 403 profile_not_entitled), and
            a profile that is not yet in the router's profiles/ folder cannot be activated at all.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={handleSend} disabled={busy || !prompt.trim()} className="gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
            Send
          </Button>
          <span className="text-xs text-fgMuted">Ctrl/Cmd+Enter</span>
        </div>

        <div aria-live="polite" className="space-y-3">
          {shown && (
            <div className="rounded-md border border-border p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {shown.ok ? (
                  <Badge variant="outline" className="text-[10px] border-success/40 text-success gap-1">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> HTTP {shown.status}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive gap-1">
                    <AlertCircle className="h-3 w-3" aria-hidden="true" /> {shown.status === null ? "No response" : `HTTP ${shown.status}`}
                  </Badge>
                )}
                <Badge variant="outline" className="text-[10px]">Client {shown.clientMs} ms</Badge>
                <Badge variant="outline" className="text-[10px]">Router {shown.serverTime ?? "n/a"}</Badge>
                <Badge variant="outline" className="text-[10px]">
                  Served: {shown.servedUseCase ?? "unknown"}
                  {shown.servedUseCase && shown.servedUseCase !== shown.requestedUseCase ? ` (asked ${shown.requestedUseCase})` : ""}
                </Badge>
                {shown.profileHeaderSent && <Badge variant="outline" className="text-[10px]">Profile header sent</Badge>}
              </div>
              {shown.ok ? (
                <p className="text-sm text-fg whitespace-pre-wrap break-words">{shown.answer}</p>
              ) : (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  <AlertDescription>{shown.error}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {history.length > 0 && (
            <div>
              <p className="text-xs font-medium text-fg mb-1.5">Last {history.length} run{history.length === 1 ? "" : "s"} (this session only)</p>
              <ul className="space-y-1">
                {history.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      aria-pressed={shown?.id === r.id}
                      className={`w-full text-left rounded-md border px-2.5 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-bgMuted/60 ${
                        shown?.id === r.id ? "border-brandPurple/40 bg-bgMuted/40" : "border-border"
                      }`}
                    >
                      <span className={r.ok ? "text-success" : "text-destructive"}>{r.ok ? "OK" : r.status ?? "ERR"}</span>
                      <span className="font-mono text-fgMuted shrink-0">{r.requestedUseCase}</span>
                      <span className="truncate text-fg">{r.prompt}</span>
                      <span className="ml-auto shrink-0 text-fgMuted">{r.clientMs} ms</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default ProfileTestConsole;
