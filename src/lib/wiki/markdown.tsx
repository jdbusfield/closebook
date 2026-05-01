import * as React from "react";

/**
 * Tiny dependency-free Markdown -> React renderer for the wiki.
 *
 * Intentionally narrow scope — supports the subset we use in `docs/wiki/`:
 *   - ATX headings (# .. ######)
 *   - Paragraphs
 *   - Unordered lists (-, *), ordered lists (1.)
 *   - Fenced code blocks (```lang ... ```)
 *   - Inline code (`...`), bold (**...**), italic (*...* / _..._)
 *   - Links [text](href) and bare URLs are not auto-linked
 *   - Pipe tables with a header separator row
 *   - Blockquotes (> ...)
 *   - Horizontal rules (---)
 *
 * No HTML is rendered from the source — every node is built as React
 * elements, which means the input is not interpreted as HTML.
 *
 * If we need a heavier feature later (footnotes, task lists, syntax
 * highlighting), swap this for `react-markdown` + `remark-gfm`.
 */

interface RenderContext {
  keyPrefix: string;
}

let inlineKeyCounter = 0;
function nextKey(prefix: string) {
  return `${prefix}-${inlineKeyCounter++}`;
}

function renderInline(text: string, ctx: RenderContext): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  let buf = "";

  function flush() {
    if (buf) {
      out.push(buf);
      buf = "";
    }
  }

  while (i < text.length) {
    const rest = text.slice(i);

    // Inline code: `...`
    const code = rest.match(/^`([^`]+)`/);
    if (code) {
      flush();
      out.push(
        <code
          key={nextKey(ctx.keyPrefix)}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {code[1]}
        </code>,
      );
      i += code[0].length;
      continue;
    }

    // Bold: **...**
    const bold = rest.match(/^\*\*([^*][^*]*?)\*\*/);
    if (bold) {
      flush();
      out.push(
        <strong key={nextKey(ctx.keyPrefix)} className="font-semibold">
          {renderInline(bold[1], ctx)}
        </strong>,
      );
      i += bold[0].length;
      continue;
    }

    // Italic: *...* (single asterisk, no inner asterisks). Avoid matching **.
    if (rest.startsWith("*") && !rest.startsWith("**")) {
      const italic = rest.match(/^\*([^*]+)\*/);
      if (italic) {
        flush();
        out.push(
          <em key={nextKey(ctx.keyPrefix)} className="italic">
            {renderInline(italic[1], ctx)}
          </em>,
        );
        i += italic[0].length;
        continue;
      }
    }

    // Italic via underscore: _..._
    const u = rest.match(/^_([^_]+)_/);
    if (u) {
      flush();
      out.push(
        <em key={nextKey(ctx.keyPrefix)} className="italic">
          {renderInline(u[1], ctx)}
        </em>,
      );
      i += u[0].length;
      continue;
    }

    // Link: [text](href)
    const link = rest.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (link) {
      flush();
      const href = link[2];
      const isExternal = /^https?:\/\//i.test(href);
      out.push(
        <a
          key={nextKey(ctx.keyPrefix)}
          href={href}
          className="text-primary underline-offset-4 hover:underline"
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noreferrer" : undefined}
        >
          {renderInline(link[1], ctx)}
        </a>,
      );
      i += link[0].length;
      continue;
    }

    buf += text[i];
    i += 1;
  }

  flush();
  return out;
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function plainText(text: string): string {
  // Strip inline markdown markers for heading anchor / table-cell plain use.
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

interface Block {
  key: string;
  node: React.ReactNode;
}

export function renderMarkdown(source: string): React.ReactElement {
  inlineKeyCounter = 0;
  const ctx: RenderContext = { keyPrefix: "md" };
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let blockIdx = 0;
  const newKey = () => `block-${blockIdx++}`;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip.
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Fenced code block.
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1];
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (or fall off end)
      blocks.push({
        key: newKey(),
        node: (
          <pre
            className="overflow-x-auto rounded-md border bg-muted/50 p-3 text-xs"
            data-lang={lang || undefined}
          >
            <code className="font-mono">{codeLines.join("\n")}</code>
          </pre>
        ),
      });
      continue;
    }

    // Horizontal rule.
    if (/^\s*---\s*$/.test(line)) {
      blocks.push({
        key: newKey(),
        node: <hr className="my-6 border-border" />,
      });
      i++;
      continue;
    }

    // Headings.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugifyHeading(plainText(text));
      const headingClasses: Record<number, string> = {
        1: "mt-8 mb-4 text-3xl font-semibold tracking-tight first:mt-0",
        2: "mt-8 mb-3 text-2xl font-semibold tracking-tight",
        3: "mt-6 mb-2 text-xl font-semibold",
        4: "mt-4 mb-2 text-lg font-semibold",
        5: "mt-4 mb-1 text-base font-semibold",
        6: "mt-4 mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground",
      };
      const tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      const Tag = tag as unknown as React.ElementType;
      blocks.push({
        key: newKey(),
        node: (
          <Tag id={id} className={headingClasses[level]}>
            {renderInline(text, ctx)}
          </Tag>
        ),
      });
      i++;
      continue;
    }

    // Blockquote.
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({
        key: newKey(),
        node: (
          <blockquote className="my-4 border-l-2 border-border pl-4 italic text-muted-foreground">
            {renderInline(quoteLines.join(" "), ctx)}
          </blockquote>
        ),
      });
      continue;
    }

    // Pipe table: header line | sep line | body lines
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}.*\|/.test(lines[i + 1])
    ) {
      const header = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) {
        const row = lines[i]
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
        rows.push(row);
        i++;
      }
      blocks.push({
        key: newKey(),
        node: (
          <div className="my-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  {header.map((h, hi) => (
                    <th
                      key={hi}
                      className="px-3 py-2 text-left font-semibold"
                    >
                      {renderInline(h, ctx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} className="border-b last:border-0">
                    {row.map((c, ci) => (
                      <td key={ci} className="px-3 py-2 align-top">
                        {renderInline(c, ctx)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      });
      continue;
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({
        key: newKey(),
        node: (
          <ul className="my-4 ml-6 list-disc space-y-1">
            {items.map((it, idx) => (
              <li key={idx}>{renderInline(it, ctx)}</li>
            ))}
          </ul>
        ),
      });
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({
        key: newKey(),
        node: (
          <ol className="my-4 ml-6 list-decimal space-y-1">
            {items.map((it, idx) => (
              <li key={idx}>{renderInline(it, ctx)}</li>
            ))}
          </ol>
        ),
      });
      continue;
    }

    // Paragraph — accumulate until blank line.
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*---\s*$/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({
      key: newKey(),
      node: (
        <p className="my-3 leading-7">
          {renderInline(paraLines.join(" "), ctx)}
        </p>
      ),
    });
  }

  return (
    <div className="prose-like text-sm">
      {blocks.map((b) => (
        <React.Fragment key={b.key}>{b.node}</React.Fragment>
      ))}
    </div>
  );
}
