import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, RotateCcw, FolderOpen } from 'lucide-react';
import { AgentDraft, AgentDraftInput, DEFAULT_DRAFT, agentDraftSchema, loadDrafts, SavedDraft } from '@/lib/agentDraftUtils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AgentFormFields from '@/components/agent-create/AgentFormFields';
import AgentPreviewPanel from '@/components/agent-create/AgentPreviewPanel';
import MarkdownImport from '@/components/agent-create/MarkdownImport';
import DraftActions from '@/components/agent-create/DraftActions';
import TemplatePicker from '@/components/agent-create/TemplatePicker';

const AgentCreate = () => {
  const [pastedMarkdown, setPastedMarkdown] = useState('');
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState('blank');

  const form = useForm<AgentDraftInput, unknown, AgentDraft>({
    resolver: zodResolver(agentDraftSchema),
    defaultValues: DEFAULT_DRAFT,
    mode: 'onChange',
  });

  const draft = form.watch();
  const isValid = form.formState.isValid;

  useEffect(() => {
    setSavedDrafts(loadDrafts());
  }, []);

  const handleLoadDraft = (id: string) => {
    const found = savedDrafts.find(d => d.id === id);
    if (found) {
      form.reset(found.draft);
      setActiveTemplateId('blank'); // loaded draft is not a template
    }
  };

  const handleClearForm = () => {
    form.reset(DEFAULT_DRAFT);
    setPastedMarkdown('');
    setActiveTemplateId('blank');
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link to="/agents" className="inline-flex items-center text-fgMuted hover:text-fg transition-colors text-sm">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Agent System
        </Link>
      </div>

      <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-fg mb-1">Define New Agent</h1>
          <p className="text-sm text-fgMuted">
            Draft a doc-driven agent definition. Export the markdown file and register it in the source map to make it live.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {savedDrafts.length > 0 && (
            <Select onValueChange={handleLoadDraft}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                <SelectValue placeholder="Load draft…" />
              </SelectTrigger>
              <SelectContent>
                {savedDrafts.map(d => (
                  <SelectItem key={d.id} value={d.id} className="text-xs">
                    {d.draft.name || d.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={handleClearForm} className="gap-1.5 text-xs">
            <RotateCcw className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {/* Template Picker */}
      <div className="mb-8 rounded-xl border border-border bg-card p-5">
        <TemplatePicker
          form={form}
          activeTemplateId={activeTemplateId}
          onTemplateApplied={setActiveTemplateId}
        />
      </div>

      {/* Two-column layout: form left, preview right */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Form column */}
        <div className="lg:col-span-3 space-y-6">
          <MarkdownImport
            form={form}
            pastedMarkdown={pastedMarkdown}
            onPastedMarkdownChange={setPastedMarkdown}
          />

          <AgentFormFields form={form} />

          <DraftActions
            draft={draft}
            isValid={isValid}
            onDraftSaved={() => setSavedDrafts(loadDrafts())}
          />
        </div>

        {/* Preview column */}
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-4">
            <AgentPreviewPanel draft={draft} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentCreate;
