
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { FileText, Brain, Shield, ChevronDown, ChevronRight, Thermometer } from "lucide-react";
import { AgentDocumentation as AgentDocsType } from "@/data/agentDocs";
import { cn } from "@/lib/utils";

interface AgentDocumentationProps {
  docs: AgentDocsType;
  agentName: string;
}

function MarkdownBlock({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      elements.push(
        <h3 key={i} className="text-lg font-semibold text-fg mt-6 mb-2">
          {line.replace("## ", "")}
        </h3>
      );
    } else if (line.startsWith("### ")) {
      elements.push(
        <h4 key={i} className="text-base font-medium text-fg mt-4 mb-1.5">
          {line.replace("### ", "")}
        </h4>
      );
    } else if (line.startsWith("> ")) {
      elements.push(
        <blockquote key={i} className="border-l-2 border-brandPurple/40 pl-4 py-1 text-fgMuted italic my-2">
          {line.replace("> ", "")}
        </blockquote>
      );
    } else if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} className="bg-bgMuted rounded-md p-3 my-3 overflow-x-auto text-sm font-mono text-fg border border-border">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
    } else if (line.startsWith("| ") && lines[i + 1]?.startsWith("|")) {
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      i--;

      const headerCells = tableLines[0].split("|").filter(c => c.trim()).map(c => c.trim());
      const dataRows = tableLines.slice(2);

      elements.push(
        <div key={i} className="my-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bgMuted">
                {headerCells.map((cell, ci) => (
                  <th key={ci} className="px-3 py-2 text-left font-medium text-fg border-b border-border">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => {
                const cells = row.split("|").filter(c => c.trim()).map(c => c.trim());
                return (
                  <tr key={ri} className="border-b border-border last:border-0">
                    {cells.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-fgMuted">
                        {cell}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    } else if (line.startsWith("- **")) {
      const match = line.match(/^- \*\*(.+?)\*\*(.*)$/);
      if (match) {
        elements.push(
          <li key={i} className="flex gap-1 text-sm text-fgMuted ml-4 mb-1">
            <span className="font-semibold text-fg shrink-0">{match[1]}</span>
            <span>{match[2]}</span>
          </li>
        );
      }
    } else if (line.startsWith("- ")) {
      elements.push(
        <li key={i} className="text-sm text-fgMuted ml-4 mb-1 list-disc list-inside">
          {renderInlineFormatting(line.replace("- ", ""))}
        </li>
      );
    } else if (line.match(/^\d+\. /)) {
      elements.push(
        <li key={i} className="text-sm text-fgMuted ml-4 mb-1 list-decimal list-inside">
          {renderInlineFormatting(line.replace(/^\d+\. /, ""))}
        </li>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-1" />);
    } else {
      elements.push(
        <p key={i} className="text-sm text-fgMuted mb-1">
          {renderInlineFormatting(line)}
        </p>
      );
    }
  }

  return <div>{elements}</div>;
}

function renderInlineFormatting(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIndex = 0;

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^(.*?)`(.+?)`(.*)$/);
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)$/);

    if (codeMatch && (!boldMatch || codeMatch.index! <= boldMatch.index!)) {
      if (codeMatch[1]) parts.push(<span key={keyIndex++}>{codeMatch[1]}</span>);
      parts.push(
        <code key={keyIndex++} className="bg-bgMuted px-1.5 py-0.5 rounded text-xs font-mono text-brandPurple">
          {codeMatch[2]}
        </code>
      );
      remaining = codeMatch[3];
    } else if (boldMatch) {
      if (boldMatch[1]) parts.push(<span key={keyIndex++}>{boldMatch[1]}</span>);
      parts.push(<strong key={keyIndex++} className="font-semibold text-fg">{boldMatch[2]}</strong>);
      remaining = boldMatch[3];
    } else {
      parts.push(<span key={keyIndex++}>{remaining}</span>);
      remaining = "";
    }
  }

  return <>{parts}</>;
}

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}

function CollapsibleSection({ title, icon, children, defaultOpen = false, badge }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-bgMuted/50 transition-colors duration-150 active:scale-[0.995]"
      >
        <span className="text-brandPurple">{icon}</span>
        <span className="font-medium text-fg flex-1">{title}</span>
        {badge && (
          <Badge variant="outline" className="text-xs">
            {badge}
          </Badge>
        )}
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-fgMuted" />
        ) : (
          <ChevronRight className="h-4 w-4 text-fgMuted" />
        )}
      </button>
      {isOpen && (
        <>
          <Separator />
          <CardContent className="pt-4">
            {children}
          </CardContent>
        </>
      )}
    </Card>
  );
}

export function AgentDocumentationTab({ docs, agentName }: AgentDocumentationProps) {
  return (
    <div className="space-y-4">
      {/* Soul summary header */}
      <Card className="bg-brandPurple/5 border-brandPurple/20">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-3">
            <Brain className="h-5 w-5 text-brandPurple mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-fg mb-1">Soul Identity</p>
              <p className="text-sm text-fgMuted italic">{docs.soulSummary}</p>
              <div className="flex items-center gap-2 mt-2">
                <Thermometer className="h-3.5 w-3.5 text-fgMuted" />
                <span className="text-xs text-fgMuted">Temperature: {docs.temperature}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* RISEN Prompt */}
      <CollapsibleSection
        title={docs.risenPrompt.title}
        icon={<FileText className="h-5 w-5" />}
        defaultOpen={true}
        badge="RISEN"
      >
        <ScrollArea className="max-h-[500px]">
          <MarkdownBlock content={docs.risenPrompt.content} />
        </ScrollArea>
      </CollapsibleSection>

      {/* Shared docs */}
      {docs.sharedDocs.map((doc, index) => (
        <CollapsibleSection
          key={index}
          title={doc.title}
          icon={index === 0 ? <Brain className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
          badge={index === 0 ? "Identity" : "Safety"}
        >
          <ScrollArea className="max-h-[400px]">
            <MarkdownBlock content={doc.content} />
          </ScrollArea>
        </CollapsibleSection>
      ))}
    </div>
  );
}
