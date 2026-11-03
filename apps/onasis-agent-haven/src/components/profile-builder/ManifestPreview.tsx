import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Copy, Download, Info, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/components/ui/use-toast";
import { validateManifestLocally, type CatalogLike, type LocalValidation, type ProfileManifest } from "@/lib/profileManifest";
import type { RouterSettings } from "@/lib/routerSettings";
import { RouterCatalogError, validateProfileManifest, type ProfileValidationResult } from "@/services/routerCatalog";

type ServerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: ProfileValidationResult }
  | { status: "not-deployed" }
  | { status: "failed"; message: string };

interface ManifestPreviewProps {
  manifest: ProfileManifest;
  onManifestChange: (next: ProfileManifest) => void;
  catalog?: CatalogLike;
  settings: RouterSettings;
}

function IssueList({ title, items, tone }: { title: string; items: string[]; tone: "error" | "warning" }) {
  if (!items.length) return null;
  const Icon = tone === "error" ? AlertCircle : AlertTriangle;
  return (
    <div className="space-y-1">
      <p className={`text-xs font-medium flex items-center gap-1.5 ${tone === "error" ? "text-destructive" : "text-warning"}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {title} ({items.length})
      </p>
      <ul className="text-xs text-fgMuted list-disc pl-5 space-y-0.5">
        {items.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

function ValidationBlock({ label, errors, warnings, valid }: { label: string; errors: string[]; warnings: string[]; valid: boolean }) {
  return (
    <div className="rounded-md border border-border p-3 space-y-2" role="group" aria-label={label}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-fg">{label}</span>
        {valid ? (
          <Badge variant="outline" className="text-[10px] border-success/40 text-success gap-1">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> valid
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive gap-1">
            <AlertCircle className="h-3 w-3" aria-hidden="true" /> {errors.length} error{errors.length === 1 ? "" : "s"}
          </Badge>
        )}
        {warnings.length > 0 && (
          <Badge variant="outline" className="text-[10px] text-warning border-warning/40">
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </Badge>
        )}
      </div>
      <IssueList title="Errors" items={errors} tone="error" />
      <IssueList title="Warnings" items={warnings} tone="warning" />
    </div>
  );
}

export function ManifestPreview({ manifest, onManifestChange, catalog, settings }: ManifestPreviewProps) {
  const { toast } = useToast();
  const pretty = useMemo(() => JSON.stringify(manifest, null, 2), [manifest]);
  const [text, setText] = useState(pretty);
  const [parseError, setParseError] = useState<string | null>(null);
  const [server, setServer] = useState<ServerState>({ status: "idle" });
  const lastEmitted = useRef(pretty);

  // Adopt changes that came from outside (regenerate, AI refinement) but not our own edits.
  useEffect(() => {
    if (pretty !== lastEmitted.current) {
      lastEmitted.current = pretty;
      setText(pretty);
      setParseError(null);
    }
  }, [pretty]);

  const parsed = useMemo<{ value: unknown; error: string | null }>(() => {
    try {
      return { value: JSON.parse(text), error: null };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  }, [text]);

  const local: LocalValidation = useMemo(
    () => (parsed.error ? { valid: false, errors: [`Not valid JSON: ${parsed.error}`], warnings: [] } : validateManifestLocally(parsed.value, catalog)),
    [parsed, catalog],
  );

  const handleChange = (next: string) => {
    setText(next);
    try {
      const value = JSON.parse(next);
      setParseError(null);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        lastEmitted.current = JSON.stringify(value, null, 2);
        onManifestChange(value as ProfileManifest);
      }
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  // Server-side validation, debounced; the local result is already on screen.
  const routerUrl = settings.url;
  useEffect(() => {
    if (parsed.error) {
      setServer({ status: "idle" });
      return;
    }
    let cancelled = false;
    setServer({ status: "loading" });
    const timer = setTimeout(() => {
      validateProfileManifest({ url: routerUrl, apiKey: "", isOverride: false }, parsed.value)
        .then((result) => {
          if (!cancelled) setServer({ status: "done", result });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (err instanceof RouterCatalogError && err.kind === "not-deployed") setServer({ status: "not-deployed" });
          else setServer({ status: "failed", message: err instanceof Error ? err.message : "Server validation failed." });
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [parsed, routerUrl]);

  const fileId = (parsed.value as { profileId?: unknown } | null)?.profileId;
  const fileName = `${typeof fileId === "string" && fileId ? fileId : "profile"}.json`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Manifest copied" });
    } catch {
      toast({ title: "Copy failed", description: "Select the text and copy it manually.", variant: "destructive" });
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text.endsWith("\n") ? text : `${text}\n`], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Manifest</CardTitle>
        <CardDescription>Edit the JSON directly; validation re-runs as you type.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="manifest-json" className="text-xs">
            Profile manifest (JSON)
          </Label>
          <Textarea
            id="manifest-json"
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            spellCheck={false}
            className="font-mono text-xs min-h-[320px]"
            aria-invalid={!!parseError}
            aria-describedby={parseError ? "manifest-json-error" : undefined}
          />
          {parseError && (
            <p id="manifest-json-error" role="alert" className="text-xs text-destructive">
              Not valid JSON yet: {parseError}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copy} className="gap-1.5">
            <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={download} disabled={!!parseError} className="gap-1.5">
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download {fileName}
          </Button>
        </div>

        <div className="space-y-3" aria-live="polite">
          <ValidationBlock label="Local check" valid={local.valid} errors={local.errors} warnings={local.warnings} />

          {server.status === "loading" && (
            <p className="text-xs text-fgMuted flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Asking the router to validate…
            </p>
          )}
          {server.status === "done" && (
            <ValidationBlock label="Router check" valid={server.result.valid} errors={server.result.errors ?? []} warnings={server.result.warnings ?? []} />
          )}
          {server.status === "not-deployed" && (
            <p className="text-xs text-fgMuted flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" aria-hidden="true" /> This router has no validate endpoint yet; only the local check ran.
            </p>
          )}
          {server.status === "failed" && (
            <p className="text-xs text-fgMuted flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" aria-hidden="true" /> Router check unavailable: {server.message} The local check still applies.
            </p>
          )}
        </div>

        <Alert>
          <Info className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>This does not activate anything</AlertTitle>
          <AlertDescription>
            To activate, add this file to <code className="font-mono text-xs">services/onasis-ai-router/profiles/</code> and grant the profile
            entitlement in the auth gateway. Profiles are entitlement-gated: the router ignores or refuses a profile the credential is not entitled to.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

export default ManifestPreview;
