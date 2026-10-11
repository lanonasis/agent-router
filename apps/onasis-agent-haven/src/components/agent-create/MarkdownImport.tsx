import { useCallback, useRef } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Upload, ClipboardPaste } from 'lucide-react';
import { AgentDraft } from '@/lib/agentDraftUtils';
import { toast } from '@/hooks/use-toast';

interface Props {
  form: UseFormReturn<AgentDraft>;
  pastedMarkdown: string;
  onPastedMarkdownChange: (md: string) => void;
}

/**
 * Allows importing a markdown file or pasting raw markdown,
 * then extracts what it can into the form fields.
 */
export default function MarkdownImport({ form, pastedMarkdown, onPastedMarkdownChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const parseMarkdownIntoForm = useCallback((md: string) => {
    const trimmed = md.trim();
    if (!trimmed) {
      toast({ title: 'Nothing to parse', description: 'Paste or upload markdown content first.', variant: 'destructive' });
      return;
    }

    // Warn if content looks non-markdown (no headings at all)
    if (!trimmed.includes('#')) {
      toast({ title: 'No headings detected', description: 'Content was imported as-is but may not be standard agent markdown. Review fields manually.' });
    }

    const { setValue, getValues } = form;

    // Extract title from # heading
    const titleMatch = md.match(/^#\s+(.+?)(?:\s+Agent)?\s*$/m);
    if (titleMatch && !getValues('name')) {
      setValue('name', titleMatch[1].replace(/\s+Agent$/, '').trim());
      const slug = titleMatch[1].replace(/\s+Agent$/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (!getValues('slug')) setValue('slug', slug);
    }

    // Use entire content as RISEN prompt
    setValue('risenPrompt', md);

    // Try to extract sections
    const sectionMatch = (header: string) => {
      const re = new RegExp(`^##\\s+${header}\\s*\\n([\\s\\S]*?)(?=^##\\s|$)`, 'mi');
      return re.exec(md)?.[1]?.trim() || '';
    };

    const purpose = sectionMatch('Purpose');
    if (purpose && !getValues('purpose')) setValue('purpose', purpose);

    const soul = sectionMatch('Soul Summary');
    if (soul && !getValues('soulSummary')) setValue('soulSummary', soul.slice(0, 300));

    const role = sectionMatch('Role');
    if (role && !getValues('agentRole')) setValue('agentRole', role.slice(0, 40));

    const fieldsExtracted = [
      titleMatch ? 'name' : null,
      purpose ? 'purpose' : null,
      soul ? 'soul summary' : null,
      role ? 'role' : null,
    ].filter(Boolean);

    toast({
      title: 'Markdown imported',
      description: fieldsExtracted.length
        ? `Extracted: ${fieldsExtracted.join(', ')}. Fields with existing values were kept.`
        : 'Content imported as RISEN prompt. No structured sections were detected — fill remaining fields manually.',
    });
  }, [form]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.md') && !file.name.endsWith('.txt')) {
      toast({ title: 'Invalid file', description: 'Please upload a .md or .txt file.', variant: 'destructive' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      onPastedMarkdownChange(content);
      parseMarkdownIntoForm(content);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [onPastedMarkdownChange, parseMarkdownIntoForm]);

  const handlePaste = useCallback(() => {
    if (pastedMarkdown.trim()) {
      parseMarkdownIntoForm(pastedMarkdown);
    }
  }, [pastedMarkdown, parseMarkdownIntoForm]);

  return (
    <section className="space-y-4 rounded-lg border border-border p-4 bg-bgMuted/50">
      <h3 className="text-sm font-semibold text-fg uppercase tracking-wider">Import Markdown</h3>
      <p className="text-xs text-fgMuted">
        Upload a .md file or paste markdown to auto-populate form fields.
      </p>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          className="gap-1.5"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload .md
        </Button>
        <input ref={fileRef} type="file" accept=".md,.txt" className="hidden" onChange={handleFile} />

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handlePaste}
          disabled={!pastedMarkdown.trim()}
          className="gap-1.5"
        >
          <ClipboardPaste className="h-3.5 w-3.5" />
          Parse Pasted
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="paste-md" className="text-xs">Paste Markdown</Label>
        <Textarea
          id="paste-md"
          value={pastedMarkdown}
          onChange={(e) => onPastedMarkdownChange(e.target.value)}
          placeholder="Paste agent markdown content here…"
          className="min-h-[120px] font-mono text-xs"
        />
      </div>
    </section>
  );
}
