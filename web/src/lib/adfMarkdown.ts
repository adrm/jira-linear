import { adfToMarkdown, markdownToAdf } from "@shared/adf";

export { adfToMarkdown };

// deno-lint-ignore no-explicit-any
type Node = any;

const BLOCKS_WITH_INLINE = new Set(["paragraph", "heading", "taskItem"]);
const LISTS = new Set(["bulletList", "orderedList", "taskList"]);

/** Attributes that matter when comparing two documents; layout, sizes and local ids are cosmetic. */
const ATTRS: Record<string, (a: Node) => Node> = {
  heading: (a) => ({ level: a?.level ?? 3 }),
  codeBlock: (a) => ({ language: a?.language ?? "" }),
  mention: (a) => ({ id: a?.id, text: String(a?.text ?? "").replace(/^@/, "") }),
  emoji: (a) => ({ shortName: a?.shortName ?? a?.text }),
  inlineCard: (a) => ({ url: a?.url }),
  blockCard: (a) => ({ url: a?.url }),
  media: (a) => ({ type: a?.type, id: a?.id, url: a?.url, alt: a?.alt ?? "" }),
  mediaInline: (a) => ({ type: a?.type, id: a?.id }),
  taskItem: (a) => ({ state: a?.state ?? "TODO" }),
  panel: (a) => ({ panelType: a?.panelType }),
  expand: (a) => ({ title: a?.title ?? "" }),
};

type Mark = { type: string; attrs?: Node };

const canonMarks = (marks: Mark[] | undefined): Mark[] =>
  (marks ?? [])
    .map((m): Mark => (m.type === "link" ? { type: "link", attrs: { href: m.attrs?.href } } : m.type === "textColor" ? { type: "textColor", attrs: { color: String(m.attrs?.color).toLowerCase() } } : { type: m.type }))
    .sort((a, b) => a.type.localeCompare(b.type));

/** Inline content in a canonical shape: marks sorted, edge whitespace moved out of marked runs, runs merged and trimmed. */
function canonInline(nodes: Node[]): Node[] {
  const out: Node[] = [];
  const push = (n: Node) => {
    const last = out.at(-1);
    if (n.type === "text" && last?.type === "text" && JSON.stringify(n.marks ?? []) === JSON.stringify(last.marks ?? [])) last.text += n.text;
    else out.push(n);
  };
  const expanded = nodes.flatMap((n) =>
    n.type === "text" && String(n.text).includes("\n")
      ? String(n.text).split("\n").flatMap((part, k) => [...(k ? [{ type: "hardBreak" }] : []), { ...n, text: part }])
      : [n]
  );
  for (const n of expanded) {
    if (n.type !== "text") { push(canon(n)); continue; }
    const marks = canonMarks(n.marks);
    const text: string = n.text ?? "";
    const core = text.trim();
    if (!core || !marks.length) { push({ type: "text", text, ...(marks.length && core ? { marks } : {}) }); continue; }
    const lead = text.slice(0, text.length - text.trimStart().length);
    const trail = text.slice(text.trimEnd().length);
    if (lead) push({ type: "text", text: lead });
    push({ type: "text", text: core, marks });
    if (trail) push({ type: "text", text: trail });
  }
  // Whitespace at the ends of the block and around line breaks is not significant.
  out.forEach((n, i) => {
    if (n.type !== "text" || n.marks) return;
    if (i === 0 || out[i - 1].type === "hardBreak") n.text = n.text.trimStart();
    if (i === out.length - 1 || out[i + 1].type === "hardBreak") n.text = n.text.trimEnd();
  });
  const kept = out.filter((n) => !(n.type === "text" && n.text === ""));
  while (kept.at(-1)?.type === "hardBreak") kept.pop();
  while (kept[0]?.type === "hardBreak") kept.shift();
  return kept.filter((n, i) => !(n.type === "hardBreak" && kept[i - 1]?.type === "hardBreak"));
}

export function canonList(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    const c = canon(n);
    if (c === null) continue;
    // Items and lists with nothing in them cannot be written in Markdown.
    if ((c.type === "listItem" || LISTS.has(c.type)) && !c.content?.length) continue;
    const last = out.at(-1);
    if (LISTS.has(c.type) && last?.type === c.type) last.content.push(...c.content);
    else out.push(c);
  }
  return out;
}

/** Canonical form so equivalent documents compare equal. Returns null for nodes that carry nothing (empty paragraphs). */
function canon(n: Node): Node {
  if (!n || typeof n !== "object") return n;
  const o: Node = { type: n.type };
  if (n.type === "text") return { type: "text", text: n.text, marks: canonMarks(n.marks) };
  const pick = ATTRS[n.type];
  if (pick) o.attrs = pick(n.attrs);
  if (BLOCKS_WITH_INLINE.has(n.type) || (n.type === "paragraph")) {
    o.content = canonInline(n.content ?? []);
    if ((n.type === "paragraph" || n.type === "heading") && !o.content.length) return null;
    return o;
  }
  if (n.type === "codeBlock") {
    o.content = [{ type: "text", text: (n.content ?? []).map((t: Node) => t.text ?? "").join("") }].filter((t) => t.text);
    return o;
  }
  if (n.content) o.content = canonList(n.content);
  return o;
}

/**
 * A document can be edited here only when writing it as Markdown and reading it back gives the same document.
 * Otherwise saving would silently drop formatting, so editing is left to Jira.
 */
export function isEditable(doc: Node | null | undefined): boolean {
  if (!doc?.content?.length) return true;
  try {
    const back = markdownToAdf(adfToMarkdown(doc));
    return JSON.stringify(canonList(back.content)) === JSON.stringify(canonList(doc.content));
  } catch {
    return false;
  }
}
