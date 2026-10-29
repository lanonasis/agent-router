/**
 * Tool registry, parsed at build time from packages/agent-model-files/tools.md.
 *
 * tools.md is the canonical list: every `### tool_name` heading followed by a
 * ```json block with `name`, `approval` and `schema` becomes one entry. The
 * `## … Operations` heading above it is the category. Nothing is hand-copied,
 * so adding a tool to tools.md adds it to the playground on the next build.
 */
import toolsRaw from '@agent-model-files/tools.md?raw';

export type ApprovalLevel = 'auto' | 'notify' | 'approve' | 'critical';

export interface RegistryTool {
  name: string;
  description: string;
  category: string;
  approval: ApprovalLevel;
  boundary: string | null;
  parameters: Record<string, unknown>;
}

const APPROVALS: ApprovalLevel[] = ['auto', 'notify', 'approve', 'critical'];

export function parseToolRegistry(markdown: string): RegistryTool[] {
  const lines = markdown.split('\n');
  const tools: RegistryTool[] = [];
  let category = 'Other';
  let heading: string | null = null;
  let description = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2 && !line.startsWith('###')) {
      category = h2[1].replace(/\s+Operations$/i, '');
      heading = null;
      continue;
    }
    const h3 = line.match(/^###\s+([a-zA-Z0-9_-]+)\s*$/);
    if (h3) {
      heading = h3[1];
      description = '';
      continue;
    }
    if (heading && !description && line.trim() && !line.startsWith('```')) {
      description = line.trim();
      continue;
    }
    if (heading && line.trim() === '```json') {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== '```') body.push(lines[i++]);
      try {
        const def = JSON.parse(body.join('\n'));
        if (def && def.name === heading && def.schema && typeof def.schema === 'object') {
          tools.push({
            name: def.name,
            description: description || def.name,
            category,
            approval: APPROVALS.includes(def.approval) ? def.approval : 'approve',
            boundary: typeof def.boundary === 'string' ? def.boundary : null,
            parameters: def.schema,
          });
        }
      } catch {
        /* a non-JSON example block — not a tool definition */
      }
      heading = null;
    }
  }
  return tools;
}

/** Plain text of one `## Heading` section of a markdown document. */
export function markdownSection(markdown: string, title: string): string | null {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.replace(/^##\s+/, '').trim() === title && /^##\s/.test(l));
  if (start < 0) return null;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i]) || lines[i].trim() === '---') break;
    out.push(lines[i]);
  }
  return out.join('\n').trim() || null;
}

export const TOOL_REGISTRY: RegistryTool[] = parseToolRegistry(toolsRaw);
export const TOOL_EXECUTION_RULES: string | null = markdownSection(toolsRaw, 'Tool Execution Rules');
export const APPROVAL_LEVELS_DOC: string | null = markdownSection(toolsRaw, 'Approval Levels');
export const TOOL_REGISTRY_SOURCE = 'packages/agent-model-files/tools.md';
