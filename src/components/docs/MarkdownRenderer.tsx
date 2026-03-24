import { cn } from "@/lib/utils";

/**
 * Lightweight markdown-to-JSX renderer for mirrored doc content.
 * Handles: headings, blockquotes, tables, code blocks, inline code, lists, bold, italic, pipes.
 * Not a full markdown parser — tuned for the doc content style in this project.
 */

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const blocks = parseBlocks(content);

  return (
    <div className={cn("space-y-4 text-sm text-fg leading-relaxed", className)}>
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} />
      ))}
    </div>
  );
}

// --- Block-level parsing ---

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "blockquote"; text: string }
  | { type: "code"; lang?: string; lines: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "separator" }
  | { type: "paragraph"; text: string };

function parseBlocks(raw: string): Block[] {
  const lines = raw.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line — skip
    if (line.trim() === "") { i++; continue; }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2] });
      i++; continue;
    }

    // Blockquote
    if (line.trimStart().startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("> ")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join(" ") });
      continue;
    }

    // Code block
    if (line.trimStart().startsWith("```")) {
      const lang = line.replace("```", "").trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: "code", lang, lines: codeLines });
      continue;
    }

    // Separator
    if (/^[-*_]{3,}$/.test(line.trim())) {
      blocks.push({ type: "separator" });
      i++; continue;
    }

    // Table detection: line has | and next line is separator
    if (line.includes("|") && i + 1 < lines.length && /^\|?[\s-:|]+\|/.test(lines[i + 1])) {
      const headers = parseTableRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // List (unordered)
    if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    // List (ordered)
    if (/^\s*\d+[.)]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    // Paragraph (collect consecutive non-special lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,4}\s/) &&
      !lines[i].trimStart().startsWith("> ") &&
      !lines[i].trimStart().startsWith("```") &&
      !/^\s*[-*]\s/.test(lines[i]) &&
      !/^\s*\d+[.)]\s/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", text: paraLines.join(" ") });
    }
  }

  return blocks;
}

function parseTableRow(line: string): string[] {
  return line.split("|").map(c => c.trim()).filter(c => c !== "");
}

// --- Block rendering ---

function BlockRenderer({ block }: { block: Block }) {
  switch (block.type) {
    case "heading": return <HeadingBlock level={block.level} text={block.text} />;
    case "blockquote": return (
      <blockquote className="border-l-2 border-brandPurple/40 pl-4 py-1 text-fgMuted italic">
        <InlineText text={block.text} />
      </blockquote>
    );
    case "code": return (
      <div className="rounded-lg border border-border bg-bgMuted overflow-x-auto">
        {block.lang && (
          <div className="px-3 py-1 border-b border-border text-[10px] font-mono text-fgMuted uppercase tracking-wider">
            {block.lang}
          </div>
        )}
        <pre className="p-3 text-xs font-mono text-fg leading-relaxed whitespace-pre overflow-x-auto">
          {block.lines.join("\n")}
        </pre>
      </div>
    );
    case "table": return <TableBlock headers={block.headers} rows={block.rows} />;
    case "list": return (
      block.ordered ? (
        <ol className="list-decimal list-inside space-y-1 text-sm text-fg pl-1">
          {block.items.map((item, i) => <li key={i}><InlineText text={item} /></li>)}
        </ol>
      ) : (
        <ul className="list-disc list-inside space-y-1 text-sm text-fg pl-1">
          {block.items.map((item, i) => <li key={i}><InlineText text={item} /></li>)}
        </ul>
      )
    );
    case "separator": return <hr className="border-border" />;
    case "paragraph": return <p className="text-sm text-fg leading-relaxed"><InlineText text={block.text} /></p>;
  }
}

function HeadingBlock({ level, text }: { level: number; text: string }) {
  const cls = {
    1: "text-xl font-bold text-fg mt-2",
    2: "text-lg font-semibold text-fg mt-4 pb-1 border-b border-border",
    3: "text-base font-semibold text-fg mt-3",
    4: "text-sm font-semibold text-fgMuted mt-2 uppercase tracking-wider",
  }[level] || "text-sm font-semibold text-fg";

  const Tag = `h${Math.min(level + 1, 6)}` as keyof JSX.IntrinsicElements;
  return <Tag className={cls}><InlineText text={text} /></Tag>;
}

function TableBlock({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-bgMuted">
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-fg border-b border-border">
                <InlineText text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "" : "bg-bgMuted/30"}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-fg border-b border-border last:border-b-0">
                  <InlineText text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Inline rendering (bold, italic, code, links) ---

function InlineText({ text }: { text: string }) {
  // Process inline formatting: **bold**, *italic*, `code`, [text](url)
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      parts.push(<strong key={match.index} className="font-semibold text-fg">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={match.index} className="italic">{match[4]}</em>);
    } else if (match[5]) {
      parts.push(
        <code key={match.index} className="text-xs bg-bgMuted px-1.5 py-0.5 rounded border border-border font-mono">
          {match[6]}
        </code>
      );
    } else if (match[7]) {
      parts.push(
        <a key={match.index} href={match[9]} className="text-brandPurple hover:underline" target="_blank" rel="noopener noreferrer">
          {match[8]}
        </a>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}
