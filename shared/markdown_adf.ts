/**
 * Minimal Markdown -> Atlassian Document Format (ADF) converter.
 * Supports: headings (#..######), bold (**x**), links ([x](url)), inline code (`x`),
 * bullet lists (-, *), ordered lists (1.), pipe tables, and paragraphs.
 * Falls back gracefully — anything unrecognized is emitted as plain paragraph text.
 */

// deno-lint-ignore no-explicit-any
type AdfNode = any;

function parseInline(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  const push = (str: string, marks?: AdfNode[]) => {
    if (!str) return;
    nodes.push(marks ? { type: "text", text: str, marks } : { type: "text", text: str });
  };

  const regex = /\\([*`\\])|\*\*(.+?)\*\*|\*([^*]+?)\*|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) push(text.slice(lastIndex, m.index));
    if (m[1] !== undefined) {
      push(m[1]);
    } else if (m[2] !== undefined) {
      push(m[2], [{ type: "strong" }]);
    } else if (m[3] !== undefined) {
      push(m[3], [{ type: "em" }]);
    } else if (m[4] !== undefined) {
      push(m[4], [{ type: "link", attrs: { href: m[5] } }]);
    } else if (m[6] !== undefined) {
      push(m[6], [{ type: "code" }]);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) push(text.slice(lastIndex));
  if (nodes.length === 0) push(text || " ");
  return nodes;
}

export function markdownToAdf(markdown: string): AdfNode {
  const lines = markdown.split("\n");
  const content: AdfNode[] = [];

  let paraBuf: string[] = [];
  let listBuf: { type: "bulletList" | "orderedList"; content: AdfNode[] } | null = null;
  let tableBuf: { content: AdfNode[]; headerDone: boolean } | null = null;

  const flushPara = () => {
    if (paraBuf.length) {
      content.push({ type: "paragraph", content: parseInline(paraBuf.join(" ")) });
      paraBuf = [];
    }
  };
  const flushList = () => {
    if (listBuf) {
      content.push({ type: listBuf.type, content: listBuf.content });
      listBuf = null;
    }
  };
  const flushTable = () => {
    if (tableBuf) {
      content.push({ type: "table", content: tableBuf.content });
      tableBuf = null;
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushTable();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      content.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: parseInline(heading[2]),
      });
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushPara();
      flushTable();
      if (!listBuf || listBuf.type !== "bulletList") {
        flushList();
        listBuf = { type: "bulletList", content: [] };
      }
      listBuf.content.push({
        type: "listItem",
        content: [{ type: "paragraph", content: parseInline(bullet[1]) }],
      });
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushPara();
      flushTable();
      if (!listBuf || listBuf.type !== "orderedList") {
        flushList();
        listBuf = { type: "orderedList", content: [] };
      }
      listBuf.content.push({
        type: "listItem",
        content: [{ type: "paragraph", content: parseInline(ordered[1]) }],
      });
      continue;
    }

    const tableRow = line.match(/^\|(.+)\|$/);
    if (tableRow) {
      flushPara();
      flushList();
      const cells = tableRow[1].split("|").map((c) => c.trim());
      const isSeparator = cells.every((c) => /^:?-{2,}:?$/.test(c));
      if (isSeparator) {
        if (tableBuf) tableBuf.headerDone = true;
        continue;
      }
      if (!tableBuf) tableBuf = { content: [], headerDone: false };
      const cellType = tableBuf.headerDone ? "tableCell" : "tableHeader";
      tableBuf.content.push({
        type: "tableRow",
        content: cells.map((c) => ({
          type: cellType,
          content: [{ type: "paragraph", content: parseInline(c) }],
        })),
      });
      continue;
    }

    flushList();
    flushTable();
    paraBuf.push(line.trim());
  }
  flushAll();

  return { type: "doc", version: 1, content };
}
