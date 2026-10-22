import { markdownToAdf } from "@shared/adf";

// deno-lint-ignore no-explicit-any
type Node = any;

function inline(nodes: Node[] | undefined): string {
  return (nodes ?? []).map((n) => {
    if (n.type !== "text") return "";
    const m = n.marks?.[0];
    if (!m) return n.text;
    switch (m.type) {
      case "strong": return `**${n.text}**`;
      case "em": return `*${n.text}*`;
      case "code": return `\`${n.text}\``;
      case "link": return `[${n.text}](${m.attrs?.href ?? ""})`;
      default: return n.text;
    }
  }).join("");
}

/** Markdown for the part of ADF that the editor can write back faithfully. Anything else is left out. */
export function adfToMarkdown(doc: Node | null | undefined): string {
  if (!doc?.content) return "";
  const blocks: string[] = [];
  for (const n of doc.content as Node[]) {
    switch (n.type) {
      case "paragraph": blocks.push(inline(n.content)); break;
      case "heading": blocks.push(`${"#".repeat(n.attrs?.level ?? 3)} ${inline(n.content)}`); break;
      case "bulletList": blocks.push((n.content ?? []).map((i: Node) => `- ${inline(i.content?.[0]?.content)}`).join("\n")); break;
      case "orderedList": blocks.push((n.content ?? []).map((i: Node, k: number) => `${k + 1}. ${inline(i.content?.[0]?.content)}`).join("\n")); break;
      case "table": {
        const rows: Node[] = n.content ?? [];
        const lines = rows.map((r) => `| ${(r.content ?? []).map((c: Node) => inline(c.content?.[0]?.content)).join(" | ")} |`);
        const cols = rows[0]?.content?.length ?? 1;
        lines.splice(1, 0, `| ${Array(cols).fill("---").join(" | ")} |`);
        blocks.push(lines.join("\n"));
        break;
      }
      default: break;
    }
  }
  return blocks.join("\n\n");
}

/** Canonical form so equivalent documents compare equal: adjacent text with the same marks is merged. */
function canon(n: Node): Node {
  if (Array.isArray(n)) {
    const out: Node[] = [];
    for (const c of n.map(canon)) {
      const last = out.at(-1);
      if (c.type === "text" && last?.type === "text" && JSON.stringify(c.marks ?? []) === JSON.stringify(last.marks ?? [])) last.text += c.text;
      else if (!(c.type === "text" && c.text === "")) out.push(c);
    }
    return out;
  }
  if (!n || typeof n !== "object") return n;
  const o: Node = { type: n.type };
  if (n.text !== undefined) o.text = n.text;
  if (n.marks?.length) o.marks = n.marks.map((m: Node) => (m.type === "link" ? { type: "link", attrs: { href: m.attrs?.href } } : { type: m.type }));
  if (n.attrs?.level !== undefined) o.attrs = { level: n.attrs.level };
  if (n.content) o.content = canon(n.content);
  return o;
}

/**
 * A description can be edited here only when writing it as Markdown and reading it back gives exactly the
 * same document. Otherwise saving would silently drop formatting, so editing is left to Jira.
 */
export function isEditable(doc: Node | null | undefined): boolean {
  if (!doc?.content?.length) return true;
  try {
    const back = markdownToAdf(adfToMarkdown(doc));
    return JSON.stringify(canon(back.content)) === JSON.stringify(canon(doc.content));
  } catch {
    return false;
  }
}
