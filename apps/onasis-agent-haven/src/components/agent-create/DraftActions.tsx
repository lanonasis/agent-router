import { Button } from '@/components/ui/button';
import { AgentDraft, generateMarkdown, generateSourceMapEntry, saveDraft } from '@/lib/agentDraftUtils';
import { Save, Download, Copy, Info } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface Props {
  draft: AgentDraft;
  isValid: boolean;
  onDraftSaved?: () => void;
}

export default function DraftActions({ draft, isValid, onDraftSaved }: Props) {
  const handleSaveDraft = () => {
    if (!draft.slug) {
      toast({ title: 'Missing agent ID', description: 'Enter an agent ID before saving.', variant: 'destructive' });
      return;
    }
    saveDraft(draft);
    onDraftSaved?.();
    toast({ title: 'Draft saved', description: `Saved draft for "${draft.name || draft.slug}" to local storage.` });
  };

  const handleExportMarkdown = () => {
    try {
      const md = generateMarkdown(draft);
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${draft.slug || 'agent'}.md`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Exported', description: `Downloaded ${draft.slug || 'agent'}.md` });
    } catch (e) {
      toast({ title: 'Export failed', description: 'Could not generate the markdown file.', variant: 'destructive' });
    }
  };

  const handleCopySourceMap = () => {
    const entry = generateSourceMapEntry(draft);
    navigator.clipboard.writeText(entry).then(
      () => toast({ title: 'Copied', description: 'Source map entry copied to clipboard.' }),
      () => toast({ title: 'Copy failed', description: 'Could not access clipboard. Copy the entry manually from the preview.', variant: 'destructive' }),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleSaveDraft} className="gap-1.5">
          <Save className="h-3.5 w-3.5" />
          Save Draft
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExportMarkdown}
          disabled={!isValid}
          className="gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          Export .md
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCopySourceMap}
          disabled={!draft.slug}
          className="gap-1.5"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy Source Map
        </Button>
      </div>

      {/* Registration path info */}
      <div className="rounded-lg border border-brandPurple/20 bg-brandPurple/5 p-3 flex gap-2.5">
        <Info className="h-4 w-4 text-brandPurple shrink-0 mt-0.5" />
        <div className="text-xs text-fgMuted space-y-1.5">
          <p className="font-medium text-fg">Registration Workflow</p>
          <p>
            This codebase uses build-time imports from <code className="text-brandPurple bg-bgMuted px-1 py-0.5 rounded text-[10px]">docs/agent_model_files/</code>.
            To make a new agent live:
          </p>
          <ol className="list-decimal list-inside space-y-0.5 text-fgMuted">
            <li>Export the markdown file using the button above</li>
            <li>Place it in <code className="text-[10px] bg-bgMuted px-1 py-0.5 rounded">docs/agent_model_files/</code></li>
            <li>Add the source map entry to <code className="text-[10px] bg-bgMuted px-1 py-0.5 rounded">src/lib/agentSourceMap.ts</code></li>
            <li>Add the build import to <code className="text-[10px] bg-bgMuted px-1 py-0.5 rounded">src/data/docManifest.ts</code></li>
            <li>Add agent metadata to <code className="text-[10px] bg-bgMuted px-1 py-0.5 rounded">src/data/agentDocs.ts</code></li>
            <li>Rebuild the application</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
