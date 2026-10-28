import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AgentDraftInput, generateMarkdown, generateSourceMapEntry, parseTraits } from '@/lib/agentDraftUtils';
import { Bot, FileText, Map } from 'lucide-react';

interface Props {
  draft: AgentDraftInput;
}

export default function AgentPreviewPanel({ draft }: Props) {
  const markdown = generateMarkdown(draft);
  const sourceEntry = generateSourceMapEntry(draft);
  const traits = parseTraits(draft.traits || '');
  const hasContent = draft.name || draft.slug;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-fg uppercase tracking-wider">Live Preview</h3>

      <Tabs defaultValue="card" className="w-full">
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="card" className="text-xs gap-1"><Bot className="h-3 w-3" />Card</TabsTrigger>
          <TabsTrigger value="markdown" className="text-xs gap-1"><FileText className="h-3 w-3" />Markdown</TabsTrigger>
          <TabsTrigger value="source" className="text-xs gap-1"><Map className="h-3 w-3" />Source Map</TabsTrigger>
        </TabsList>

        {/* Agent Card Preview */}
        <TabsContent value="card">
          <Card className={`border ${hasContent ? 'border-brandPurple/30' : 'border-border'} transition-colors`}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-brandPurple/10 flex items-center justify-center">
                    <Bot className="h-5 w-5 text-brandPurple" />
                  </div>
                  <div>
                    <CardTitle className="text-base text-fg">
                      {draft.name || 'Agent Name'}
                    </CardTitle>
                    <p className="text-xs text-fgMuted">{draft.agentRole || 'Role'}</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {draft.role}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-fgMuted italic">
                {draft.soulSummary || 'Soul summary will appear here…'}
              </p>
              <p className="text-xs text-fgMuted">
                {draft.purpose || 'Purpose description…'}
              </p>
              {traits.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {traits.map((t, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px]">{t}</Badge>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-4 text-xs text-fgMuted pt-1 border-t border-border">
                <span>Temperature: <span className="font-mono text-fg">{draft.temperature.toFixed(1)}</span></span>
                <span>Docs: <span className="font-mono text-fg">{draft.sharedDocs.length}</span></span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Markdown Preview */}
        <TabsContent value="markdown">
          <div className="rounded-lg border border-border bg-bgMuted p-4 max-h-[500px] overflow-auto">
            <pre className="text-xs font-mono text-fg whitespace-pre-wrap">{markdown}</pre>
          </div>
        </TabsContent>

        {/* Source Map Preview */}
        <TabsContent value="source">
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-bgMuted p-4">
              <p className="text-xs text-fgMuted mb-2">Source map entry for <code className="text-brandPurple">agentSourceMap.ts</code>:</p>
              <pre className="text-xs font-mono text-fg whitespace-pre-wrap">{sourceEntry}</pre>
            </div>
            <div className="rounded-lg border border-border bg-bgMuted p-4">
              <p className="text-xs text-fgMuted mb-2">File mapping:</p>
              <div className="text-xs font-mono text-fg space-y-1">
                <p><span className="text-fgMuted">Source:</span> docs/agent_model_files/{draft.slug || '(slug)'}.md</p>
                <p><span className="text-fgMuted">Agent ID:</span> {draft.slug || '(slug)'}</p>
                <p><span className="text-fgMuted">Display:</span> {draft.name || '(name)'}</p>
                <p><span className="text-fgMuted">Category:</span> {draft.role}</p>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
