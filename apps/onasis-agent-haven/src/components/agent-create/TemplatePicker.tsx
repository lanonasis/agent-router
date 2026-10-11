/**
 * Template picker for the agent creation workflow.
 * Lets users start from a strong doc-driven template instead of a blank form.
 * Shows a confirmation dialog if applying a template over existing content.
 */

import { useState } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { AgentDraft, DEFAULT_DRAFT } from '@/lib/agentDraftUtils';
import { AGENT_TEMPLATES, AgentTemplate } from '@/data/agentTemplates';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Sparkles } from 'lucide-react';

interface Props {
  form: UseFormReturn<AgentDraft>;
  activeTemplateId: string;
  onTemplateApplied: (id: string) => void;
}

/** Check if the form has meaningful user content beyond defaults */
function formHasContent(draft: AgentDraft): boolean {
  return !!(
    draft.name ||
    draft.slug ||
    draft.soulSummary ||
    draft.purpose ||
    (draft.risenPrompt && draft.risenPrompt !== DEFAULT_DRAFT.risenPrompt)
  );
}

export default function TemplatePicker({ form, activeTemplateId, onTemplateApplied }: Props) {
  const [pendingTemplate, setPendingTemplate] = useState<AgentTemplate | null>(null);

  const applyTemplate = (template: AgentTemplate) => {
    form.reset(template.draft);
    onTemplateApplied(template.id);
  };

  const handleSelect = (template: AgentTemplate) => {
    if (template.id === activeTemplateId) return;

    const current = form.getValues();
    if (formHasContent(current) && activeTemplateId !== 'blank') {
      // Form has content and user is switching — confirm
      setPendingTemplate(template);
    } else if (formHasContent(current) && template.id !== 'blank') {
      // Switching from blank-with-content to a template — confirm
      setPendingTemplate(template);
    } else {
      applyTemplate(template);
    }
  };

  const confirmApply = () => {
    if (pendingTemplate) {
      applyTemplate(pendingTemplate);
      setPendingTemplate(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-brandPurple" />
        <h3 className="text-sm font-semibold text-fg uppercase tracking-wider">Start from Template</h3>
      </div>
      <p className="text-xs text-fgMuted">
        Choose a template based on real agent system roles, or start blank.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {AGENT_TEMPLATES.map((t) => {
          const isActive = t.id === activeTemplateId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => handleSelect(t)}
              className={`
                relative flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center
                transition-all duration-150 cursor-pointer
                ${isActive
                  ? 'border-brandPurple bg-brandPurple/10 ring-1 ring-brandPurple/30'
                  : 'border-border bg-card hover:border-brandPurple/40 hover:bg-brandPurple/5'
                }
              `}
            >
              <span className="text-xl leading-none">{t.icon}</span>
              <span className="text-xs font-medium text-fg">{t.label}</span>
              {isActive && (
                <Badge className="absolute -top-1.5 -right-1.5 text-[9px] px-1.5 py-0 bg-brandPurple text-white border-0">
                  Active
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {activeTemplateId !== 'blank' && (
        <p className="text-xs text-fgMuted italic">
          Template applied: <span className="text-fg font-medium">{AGENT_TEMPLATES.find(t => t.id === activeTemplateId)?.label}</span>. All fields remain editable.
        </p>
      )}

      {/* Confirmation dialog for overwriting existing content */}
      <AlertDialog open={!!pendingTemplate} onOpenChange={(open) => !open && setPendingTemplate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply template?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace your current form content with the <strong>{pendingTemplate?.label}</strong> template.
              Any unsaved changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmApply}>Apply Template</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
