import { UseFormReturn } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AgentDraft, AgentDraftInput } from '@/lib/agentDraftUtils';

const AVAILABLE_SHARED_DOCS = [
  'SOUL.md',
  'policies.md',
  'IDENTITY-LAYER.md',
  'tools.md',
  'SOURCE-OF-TRUTH.md',
];

interface Props {
  form: UseFormReturn<AgentDraftInput, unknown, AgentDraft>;
}

export default function AgentFormFields({ form }: Props) {
  const { register, formState: { errors }, setValue, watch } = form;
  const temperature = watch('temperature');
  const sharedDocs = watch('sharedDocs');
  const role = watch('role');

  const autoSlug = (name: string) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!form.getValues('slug')) {
      setValue('slug', slug);
    }
  };

  return (
    <div className="space-y-6">
      {/* Identity */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-fg uppercase tracking-wider">Identity</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Agent Name *</Label>
            <Input
              id="name"
              placeholder="e.g. Planner"
              {...register('name', {
                onChange: (e) => autoSlug(e.target.value),
              })}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="slug">Agent ID *</Label>
            <Input id="slug" placeholder="e.g. planner" {...register('slug')} />
            {errors.slug && <p className="text-xs text-destructive">{errors.slug.message}</p>}
            <p className="text-xs text-fgMuted">Lowercase, letters/numbers/hyphens only</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Category *</Label>
            <Select value={role} onValueChange={(v) => setValue('role', v as 'Orchestrator' | 'Sub-Agent')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Sub-Agent">Sub-Agent</SelectItem>
                <SelectItem value="Orchestrator">Orchestrator</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agentRole">Role Label *</Label>
            <Input id="agentRole" placeholder="e.g. Planner, Deployer" {...register('agentRole')} />
            {errors.agentRole && <p className="text-xs text-destructive">{errors.agentRole.message}</p>}
          </div>
        </div>
      </section>

      {/* Soul & Purpose */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-fg uppercase tracking-wider">Soul & Purpose</h3>

        <div className="space-y-1.5">
          <Label htmlFor="soulSummary">Soul Summary *</Label>
          <Textarea
            id="soulSummary"
            placeholder="One-liner personality summary — who is this agent?"
            className="min-h-[60px]"
            {...register('soulSummary')}
          />
          {errors.soulSummary && <p className="text-xs text-destructive">{errors.soulSummary.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="purpose">Purpose *</Label>
          <Textarea
            id="purpose"
            placeholder="What does this agent do? What is it responsible for?"
            className="min-h-[80px]"
            {...register('purpose')}
          />
          {errors.purpose && <p className="text-xs text-destructive">{errors.purpose.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="traits">Traits</Label>
          <Input id="traits" placeholder="Comma-separated: Precise, Calm under pressure, Detail-oriented" {...register('traits')} />
          <p className="text-xs text-fgMuted">Comma or newline separated</p>
        </div>
      </section>

      {/* Parameters */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-fg uppercase tracking-wider">Parameters</h3>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Temperature</Label>
            <Badge variant="outline" className="font-mono text-xs">{temperature.toFixed(1)}</Badge>
          </div>
          <Slider
            value={[temperature]}
            onValueChange={([v]) => setValue('temperature', v)}
            min={0}
            max={1}
            step={0.1}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-fgMuted">
            <span>Precise (0.0)</span>
            <span>Creative (1.0)</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="parameterProfile">Parameter Profile</Label>
          <Textarea
            id="parameterProfile"
            placeholder={`temperature: 0.3\ntop_k: 30\ntop_p: 0.85\nnum_ctx: 8192`}
            className="min-h-[100px] font-mono text-xs"
            {...register('parameterProfile')}
          />
        </div>
      </section>

      {/* RISEN Prompt */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-fg uppercase tracking-wider">RISEN Prompt *</h3>

        <Textarea
          id="risenPrompt"
          placeholder="The full RISEN prompt for this agent. This will become the content of the agent's source markdown file."
          className="min-h-[200px] font-mono text-sm"
          {...register('risenPrompt')}
        />
        {errors.risenPrompt && <p className="text-xs text-destructive">{errors.risenPrompt.message}</p>}
      </section>

      {/* Shared Docs */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-fg uppercase tracking-wider">Shared Documentation</h3>
        <p className="text-xs text-fgMuted">Select which shared docs this agent should reference.</p>

        <div className="space-y-2">
          {AVAILABLE_SHARED_DOCS.map((doc) => (
            <label key={doc} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={sharedDocs.includes(doc)}
                onCheckedChange={(checked) => {
                  const next = checked
                    ? [...sharedDocs, doc]
                    : sharedDocs.filter(d => d !== doc);
                  setValue('sharedDocs', next);
                }}
              />
              <span className="text-sm text-fg font-mono">{doc}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
