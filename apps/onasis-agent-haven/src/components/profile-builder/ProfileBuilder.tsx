import { useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  buildRefinePrompt,
  extractJsonObject,
  generateManifest,
  mergeRefinement,
  validateManifestLocally,
  type CatalogLike,
  type ProfileManifest,
} from "@/lib/profileManifest";
import { hasRouterCredential, type RouterSettings } from "@/lib/routerSettings";
import { sendRouterChat } from "@/services/profileTestService";
import { ManifestPreview } from "@/components/profile-builder/ManifestPreview";

interface ProfileBuilderProps {
  manifest: ProfileManifest | null;
  onManifestChange: (next: ProfileManifest | null) => void;
  catalog?: CatalogLike;
  /** Shown when the live catalog could not be used (fallback to the static list). */
  catalogNote?: string | null;
  settings: RouterSettings;
  initialTask?: string;
}

export function ProfileBuilder({ manifest, onManifestChange, catalog, catalogNote, settings, initialTask = "" }: ProfileBuilderProps) {
  const [task, setTask] = useState(initialTask);
  const [rationale, setRationale] = useState<string[]>([]);
  const [refining, setRefining] = useState(false);
  const [refineNote, setRefineNote] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const canGenerate = task.trim().length > 0;

  const handleGenerate = () => {
    const result = generateManifest(task, catalog);
    onManifestChange(result.manifest);
    setRationale(result.rationale);
    setRefineNote(null);
  };

  const handleRefine = async () => {
    if (!manifest) return;
    if (!hasRouterCredential(settings)) {
      setRefineNote({ tone: "error", text: "Refine with AI needs a router credential. Add an API key in Settings. The deterministic draft is unchanged." });
      return;
    }
    setRefining(true);
    setRefineNote(null);
    try {
      const run = await sendRouterChat(settings, { useCase: "content-generation", prompt: buildRefinePrompt(task, manifest, catalog) });
      if (!run.ok) {
        setRefineNote({ tone: "error", text: `${run.error} Kept the deterministic draft.` });
        return;
      }
      const draft = extractJsonObject(run.answer);
      if (!draft) {
        setRefineNote({ tone: "error", text: "Could not parse JSON from the AI answer, so the deterministic draft was kept." });
        return;
      }
      const { manifest: merged, applied, ignored } = mergeRefinement(manifest, draft);
      const check = validateManifestLocally(merged, catalog);
      if (!check.valid) {
        setRefineNote({
          tone: "error",
          text: `The AI draft failed validation (${check.errors.join(" ")}), so the deterministic draft was kept.`,
        });
        return;
      }
      onManifestChange(merged);
      setRefineNote({
        tone: "info",
        text:
          (applied.length ? `Applied AI changes to: ${applied.join(", ")}.` : "The AI suggested no changes to the draft.") +
          (ignored.length ? ` Ignored: ${ignored.join(", ")}.` : "") +
          " Review the validation results below before using it.",
      });
    } catch {
      setRefineNote({ tone: "error", text: "Refinement was interrupted. The deterministic draft was kept." });
    } finally {
      setRefining(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-brandPurple" aria-hidden="true" /> Generate a router profile from a task
          </CardTitle>
          <CardDescription>
            Describe what the agent should do. The draft is built by explainable rules, no model required, and checked against the router's manifest rules.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="profile-task" className="text-xs">
              Task description
            </Label>
            <Textarea
              id="profile-task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. Answer customer questions about billing and point them to the right docs"
              className="min-h-[88px] text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={handleGenerate} disabled={!canGenerate} className="gap-1.5">
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" /> {manifest ? "Regenerate draft" : "Generate draft"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleRefine} disabled={!manifest || refining || !canGenerate} className="gap-1.5">
              {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
              Refine with AI
            </Button>
          </div>
          {catalogNote && <p className="text-xs text-fgMuted">{catalogNote}</p>}
          {refineNote && (
            <Alert variant={refineNote.tone === "error" ? "destructive" : "default"} role="status">
              <AlertDescription>{refineNote.text}</AlertDescription>
            </Alert>
          )}
          {rationale.length > 0 && (
            <div className="rounded-md bg-bgMuted/60 border border-border/50 p-3">
              <p className="text-xs font-medium text-fg mb-1.5">Why these choices</p>
              <ul className="text-xs text-fgMuted list-disc pl-5 space-y-1">
                {rationale.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {manifest && <ManifestPreview manifest={manifest} onManifestChange={onManifestChange} catalog={catalog} settings={settings} />}
    </div>
  );
}

export default ProfileBuilder;
