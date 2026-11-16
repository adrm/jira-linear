/**
 * Markdown <-> Atlassian Document Format (ADF), shared by the server and the web app.
 *
 * The editor works on Markdown, so everything Jira can hold has to have a Markdown spelling or editing is blocked.
 * Beyond the usual syntax (headings, lists with nesting, tables, code, quotes, rules, bold/italic/strike/code/links):
 *
 *   hard line break       a trailing backslash or two trailing spaces; `<br>` inside table cells
 *   underline, colour     <u>x</u>   <span color="#ff0000">x</span>
 *   mention               @[Name](mention:accountId)
 *   emoji                 :smile:
 *   smart link            <https://…>  inline, <<https://…>> as a block
 *   task list             - [ ] todo   - [x] done
 *   panel, expand         :::info … :::     :::expand Title … :::
 *   image / attachment    ![alt](media:ID?w=…&h=…)   a file in Jira;  ![alt](https://…) an external image
 *                         several `…&g=1` lines in a row are an attachment group
 *   anything else         a ```adf fence holding the node as JSON, so it survives an edit untouched
 */

// deno-lint-ignore no-explicit-any
type N = any;
interface Mark {
  type: string;
  attrs?: Record<string, unknown>;
}

const PUNCT = /[!-/:-@[-`{-~]/;
const ALNUM = /[A-Za-z0-9]/;
const EMOJI = /:([a-z][a-z0-9_+-]*):/y;
const uid = () => crypto.randomUUID();

/** What a document knows about its emoji, by short name, so that editing the text does not lose their pictures. */
export type EmojiAttrs = Record<string, { id?: string; text?: string }>;
let knownEmoji: EmojiAttrs = {};

export function collectEmoji(doc: N): EmojiAttrs {
  const out: EmojiAttrs = {};
  const walk = (n: N) => {
    if (!n || typeof n !== "object") return;
    const a = n.attrs;
    if (n.type === "emoji" && typeof a?.shortName === "string" && (typeof a.id === "string" || typeof a.text === "string")) {
      out[a.shortName] = { ...(typeof a.id === "string" ? { id: a.id } : {}), ...(typeof a.text === "string" ? { text: a.text } : {}) };
    }
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Markdown -> ADF: inline
// ---------------------------------------------------------------------------------------------------------------

function textNode(text: string, marks: Mark[]): N {
  return marks.length ? { type: "text", text, marks: marks.map((m) => ({ ...m })) } : { type: "text", text };
}

function mergeText(nodes: N[]): N[] {
  const out: N[] = [];
  for (const n of nodes) {
    const last = out.at(-1);
    if (n.type === "text" && last?.type === "text" && JSON.stringify(n.marks ?? []) === JSON.stringify(last.marks ?? [])) {
      last.text += n.text;
    } else if (!(n.type === "text" && n.text === "")) out.push(n);
  }
  return out;
}

/** Index just past the code span that opens at `i`, or -1. */
function codeSpanEnd(text: string, i: number): { end: number; content: string } | null {
  let k = i;
  while (text[k] === "`") k++;
  const run = k - i;
  for (let j = k; j < text.length;) {
    if (text[j] !== "`") { j++; continue; }
    let e = j;
    while (text[e] === "`") e++;
    if (e - j === run) {
      let content = text.slice(k, j);
      if (content.length > 1 && content.startsWith(" ") && content.endsWith(" ") && content.trim()) content = content.slice(1, -1);
      return { end: e, content };
    }
    j = e;
  }
  return null;
}

/** First index >= `from` of an unescaped closing `delim` outside code spans that passes `ok`. */
function findClose(text: string, from: number, delim: string, ok: (j: number) => boolean): number {
  for (let j = from; j < text.length;) {
    const c = text[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "`") {
      const span = codeSpanEnd(text, j);
      j = span ? span.end : j + 1;
      continue;
    }
    if (text.startsWith(delim, j)) {
      if (delim === "*" && text[j + 1] === "*") { j += 2; continue; }
      if (ok(j)) return j;
    }
    j++;
  }
  return -1;
}

/** Index of the `]` matching the `[` at `i`, or -1. */
function matchBracket(text: string, i: number): number {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === "\\") { j++; continue; }
    if (c === "`") {
      const span = codeSpanEnd(text, j);
      if (span) j = span.end - 1;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return j;
  }
  return -1;
}

/** `(dest)` or `(<dest>)` starting at `i` (just after the `(`). */
function scanDest(text: string, i: number): { dest: string; end: number } | null {
  let j = i;
  while (text[j] === " ") j++;
  let dest = "";
  if (text[j] === "<") {
    const close = text.indexOf(">", j);
    if (close < 0) return null;
    dest = text.slice(j + 1, close);
    j = close + 1;
  } else {
    let depth = 0;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === "\\" && PUNCT.test(text[j + 1] ?? "")) { dest += text[++j]; continue; }
      if (/\s/.test(c)) break;
      if (c === "(") depth++;
      else if (c === ")") { if (depth === 0) break; depth--; }
      dest += c;
    }
  }
  while (text[j] === " ") j++;
  if (text[j] === '"') {
    const close = text.indexOf('"', j + 1);
    if (close < 0) return null;
    j = close + 1;
    while (text[j] === " ") j++;
  }
  return text[j] === ")" && dest ? { dest, end: j + 1 } : null;
}

function mediaParams(dest: string): { id: string; q: URLSearchParams } | null {
  const m = /^media:([^?\s]+)(?:\?(.*))?$/.exec(dest);
  if (!m) return null;
  let id = m[1];
  try {
    id = decodeURIComponent(id);
  } catch { /* keep it as written */ }
  return { id, q: new URLSearchParams(m[2] ?? "") };
}

function mediaNode(id: string, q: URLSearchParams, alt?: string): N {
  const attrs: N = { type: "file", id, collection: q.get("c") ?? "" };
  if (alt) attrs.alt = alt;
  const w = Number(q.get("w")), h = Number(q.get("h"));
  if (w > 0) attrs.width = w;
  if (h > 0) attrs.height = h;
  return { type: "media", attrs };
}

function parseInline(text: string, marks: Mark[] = []): N[] {
  const out: N[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push(textNode(buf, marks));
    buf = "";
  };
  const put = (n: N) => {
    flush();
    out.push(n);
  };
  const withMark = (inner: string, m: Mark) => out.push(...parseInline(inner, [...marks, m]));
  const n = text.length;
  for (let i = 0; i < n;) {
    const c = text[i];
    const prev = text[i - 1] ?? "";

    if (c === "\\" && PUNCT.test(text[i + 1] ?? "")) { buf += text[i + 1]; i += 2; continue; }

    if (c === "`") {
      const span = codeSpanEnd(text, i);
      if (span) {
        flush();
        // The code mark cannot be combined with anything but a link.
        out.push(textNode(span.content, [...marks.filter((m) => m.type === "link"), { type: "code" }]));
        i = span.end;
        continue;
      }
      while (text[i] === "`") buf += text[i++];
      continue;
    }

    if (c === "!" && text[i + 1] === "[") {
      const close = matchBracket(text, i + 1);
      const d = close > 0 && text[close + 1] === "(" ? scanDest(text, close + 2) : null;
      const media = d && mediaParams(d.dest);
      if (d && media) {
        put({ type: "mediaInline", attrs: { type: "file", id: media.id, collection: media.q.get("c") ?? "" } });
        i = d.end;
        continue;
      }
    }

    if (c === "@" && text[i + 1] === "[") {
      const close = matchBracket(text, i + 1);
      const d = close > 0 && text[close + 1] === "(" ? scanDest(text, close + 2) : null;
      const id = d && /^mention:(.+)$/.exec(d.dest)?.[1];
      if (d && id) {
        put({ type: "mention", attrs: { id, text: "@" + text.slice(i + 2, close).replace(/\\(.)/g, "$1"), accessLevel: "" } });
        i = d.end;
        continue;
      }
    }

    if (c === "[") {
      const close = matchBracket(text, i);
      const d = close > 0 && text[close + 1] === "(" ? scanDest(text, close + 2) : null;
      if (d && close > i + 1) {
        flush();
        withMark(text.slice(i + 1, close), { type: "link", attrs: { href: d.dest } });
        i = d.end;
        continue;
      }
    }

    if (c === "<") {
      const rest = text.slice(i);
      let m: RegExpExecArray | null;
      if (rest.startsWith("<u>")) {
        const close = text.indexOf("</u>", i + 3);
        if (close > i + 3) { flush(); withMark(text.slice(i + 3, close), { type: "underline" }); i = close + 4; continue; }
      } else if ((m = /^<span color="(#[0-9a-fA-F]{3,8})">/.exec(rest))) {
        const close = text.indexOf("</span>", i + m[0].length);
        if (close > i + m[0].length) { flush(); withMark(text.slice(i + m[0].length, close), { type: "textColor", attrs: { color: m[1] } }); i = close + 7; continue; }
      } else if ((m = /^<br\s*\/?>/i.exec(rest))) {
        put({ type: "hardBreak" });
        i += m[0].length;
        continue;
      } else if ((m = /^<(https?:\/\/[^\s>]+)>/.exec(rest))) {
        put({ type: "inlineCard", attrs: { url: m[1] } });
        i += m[0].length;
        continue;
      }
    }

    if (c === "*" || c === "_" || c === "~") {
      const double = text[i + 1] === c && c !== "_";
      const delim = c === "~" ? "~~" : double ? "**" : c;
      const startOk = delim === "~~" ? text[i + 1] === "~" : true;
      const after = text[i + delim.length];
      const opens = startOk && after !== undefined && !/\s/.test(after) && (c !== "_" || !ALNUM.test(prev));
      if (opens) {
        const close = findClose(text, i + delim.length, delim, (j) =>
          j > i + delim.length && !/\s/.test(text[j - 1]) && (c !== "_" || !ALNUM.test(text[j + 1] ?? "")));
        if (close > 0) {
          flush();
          const type = delim === "**" ? "strong" : delim === "~~" ? "strike" : "em";
          withMark(text.slice(i + delim.length, close), { type });
          i = close + delim.length;
          continue;
        }
      }
    }

    if (c === ":" && !/\w/.test(prev)) {
      EMOJI.lastIndex = i;
      const m = EMOJI.exec(text);
      if (m && !/\w/.test(text[i + m[0].length] ?? "")) {
        const known = knownEmoji[m[0]];
        put({ type: "emoji", attrs: { shortName: m[0], ...(known?.id ? { id: known.id } : {}), ...(known?.text ? { text: known.text } : {}) } });
        i += m[0].length;
        continue;
      }
    }

    buf += c;
    i++;
  }
  flush();
  return mergeText(out);
}

/** The lines of one paragraph: soft line breaks become spaces, a trailing backslash or two spaces a hard break. */
function paragraphInline(lines: string[]): N[] {
  const out: N[] = [];
  lines.forEach((raw, idx) => {
    let line = raw;
    let hard = false;
    const last = idx === lines.length - 1;
    const slashes = /\\+$/.exec(line.trimEnd())?.[0].length ?? 0;
    if (!last && slashes % 2 === 1) {
      hard = true;
      line = line.trimEnd().slice(0, -1);
    } else if (!last && / {2,}$/.test(line)) hard = true;
    out.push(...parseInline(line.trim()));
    if (!last) out.push(hard ? { type: "hardBreak" } : { type: "text", text: " " });
  });
  return mergeText(out);
}

// ---------------------------------------------------------------------------------------------------------------
// Markdown -> ADF: blocks
// ---------------------------------------------------------------------------------------------------------------

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^( *)(`{3,})\s*([\w+#.-]*)\s*$/;
const CONTAINER = /^:::([a-z]+)(?:\s+(.*))?$/;
const LIST = /^( *)([-*+]|\d+[.)])( +)(.*)$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const IMAGE_LINE = /^!\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)\)$/;
const CARD_LINE = /^<<(https?:\/\/[^\s>]+)>>$/;
const TABLE_ROW = /^\|.*\|$/;
const TASK = /^\[( |x|X)\] ?(.*)$/;

const indentOf = (l: string) => l.length - l.trimStart().length;

function imageBlock(s: string): N | null {
  const m = IMAGE_LINE.exec(s);
  if (!m) return null;
  const alt = m[1].replace(/\\(.)/g, "$1");
  const media = mediaParams(m[2]);
  if (media) {
    const node = mediaNode(media.id, media.q, alt);
    if (media.q.get("g") === "1") return { type: "mediaGroup", content: [node] };
    const attrs: N = { layout: media.q.get("layout") ?? "center" };
    const sw = Number(media.q.get("sw"));
    if (sw > 0) {
      attrs.width = sw;
      if (media.q.get("swt")) attrs.widthType = media.q.get("swt");
    }
    return { type: "mediaSingle", attrs, content: [node] };
  }
  if (/^https?:\/\//i.test(m[2])) {
    const attrs: N = { type: "external", url: m[2] };
    if (alt) attrs.alt = alt;
    return { type: "mediaSingle", attrs: { layout: "center" }, content: [{ type: "media", attrs }] };
  }
  return null;
}

function startsBlock(line: string): boolean {
  const t = line.trimEnd(), s = t.trimStart();
  return HEADING.test(s) || FENCE.test(t) || CONTAINER.test(s) || s.startsWith(">") || LIST.test(t) || TABLE_ROW.test(s) ||
    RULE.test(s) || imageBlock(s) !== null || CARD_LINE.test(s);
}

function splitCells(row: string): string[] {
  const inner = row.trim().slice(1, -1);
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function parseTable(rows: string[]): N {
  const content: N[] = [];
  let header = false;
  const cells = rows.map(splitCells);
  const sepAt = cells.findIndex((r) => r.every((c) => /^:?-{2,}:?$/.test(c)));
  cells.forEach((r, k) => {
    if (k === sepAt) return;
    const type = sepAt > 0 && k < sepAt ? "tableHeader" : "tableCell";
    header ||= type === "tableHeader";
    content.push({
      type: "tableRow",
      content: r.map((c) => ({ type, content: [{ type: "paragraph", content: parseInline(c) }] })),
    });
  });
  return { type: "table", attrs: { isNumberColumnEnabled: false, layout: "default" }, content };
}

function parseList(lines: string[], start: number): { node: N; next: number } {
  const first = LIST.exec(lines[start].trimEnd())!;
  const base = first[1].length;
  const ordered = /\d/.test(first[2][0]);
  const task = TASK.test(first[4]);
  const items: N[] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST.exec(lines[i].trimEnd());
    if (!m || m[1].length > base || /\d/.test(m[2][0]) !== ordered || TASK.test(m[4]) !== task) break;
    const contentIndent = m[1].length + m[2].length + Math.min(m[3].length, 4);
    const body = [m[4]];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j];
      if (!l.trim()) {
        let k = j + 1;
        while (k < lines.length && !lines[k].trim()) k++;
        if (k < lines.length && indentOf(lines[k]) > base) { body.push(""); j++; continue; }
        break;
      }
      if (indentOf(l) <= base) break;
      body.push(l.slice(Math.min(indentOf(l), contentIndent)));
      j++;
    }
    if (task) {
      const t = TASK.exec(m[4]);
      const text = t ? t[2] : m[4];
      items.push({
        type: "taskItem",
        attrs: { localId: uid(), state: t && t[1] !== " " ? "DONE" : "TODO" },
        content: paragraphInline([text, ...body.slice(1).filter((x) => x.trim())]),
      });
    } else {
      const blocks = parseBlocks(body);
      items.push({ type: "listItem", content: blocks.length ? blocks : [{ type: "paragraph" }] });
    }
    i = j;
    while (i < lines.length && !lines[i].trim()) {
      const k = i + 1;
      if (k < lines.length && LIST.test(lines[k].trimEnd()) && indentOf(lines[k]) <= base) i = k;
      else break;
    }
  }
  const node = task
    ? { type: "taskList", attrs: { localId: uid() }, content: items }
    : { type: ordered ? "orderedList" : "bulletList", content: items };
  return { node, next: i };
}

function parseBlocks(lines: string[]): N[] {
  const content: N[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trimEnd();
    const s = t.trimStart();
    if (!s) { i++; continue; }
    let m: RegExpExecArray | null;

    if ((m = FENCE.exec(t))) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !new RegExp(`^ *\`{${m[2].length},}\\s*$`).test(lines[j])) body.push(lines[j++]);
      const code = body.map((l) => l.slice(Math.min(indentOf(l), m![1].length))).join("\n");
      if (m[3] === "adf") {
        try {
          const raw = JSON.parse(code);
          content.push(...(Array.isArray(raw) ? raw : [raw]));
          i = j + 1;
          continue;
        } catch { /* not valid JSON: keep it as the code it looks like */ }
      }
      const node: N = { type: "codeBlock" };
      if (m[3]) node.attrs = { language: m[3] };
      if (code) node.content = [{ type: "text", text: code }];
      content.push(node);
      i = j + 1;
      continue;
    }

    if ((m = CONTAINER.exec(s))) {
      const body: string[] = [];
      let depth = 1, j = i + 1;
      for (; j < lines.length; j++) {
        const x = lines[j].trim();
        if (CONTAINER.test(x)) depth++;
        else if (x === ":::" && --depth === 0) break;
        body.push(lines[j]);
      }
      const inner = parseBlocks(body);
      content.push(
        m[1] === "expand"
          ? { type: "expand", attrs: { title: m[2] ?? "" }, content: inner.length ? inner : [{ type: "paragraph" }] }
          : { type: "panel", attrs: { panelType: m[1] }, content: inner.length ? inner : [{ type: "paragraph" }] },
      );
      i = j + 1;
      continue;
    }

    if ((m = HEADING.exec(s))) {
      content.push({ type: "heading", attrs: { level: m[1].length }, content: parseInline(m[2].trim()) });
      i++;
      continue;
    }

    if (RULE.test(s)) { content.push({ type: "rule" }); i++; continue; }

    if (s.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      const inner = parseBlocks(body);
      content.push({ type: "blockquote", content: inner.length ? inner : [{ type: "paragraph" }] });
      continue;
    }

    if (LIST.test(t)) {
      const r = parseList(lines, i);
      content.push(r.node);
      i = r.next;
      continue;
    }

    if (TABLE_ROW.test(s)) {
      const rows: string[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i].trim())) rows.push(lines[i++]);
      content.push(parseTable(rows));
      continue;
    }

    const image = imageBlock(s);
    if (image) {
      i++;
      if (image.type === "mediaGroup") {
        while (i < lines.length) {
          const next = imageBlock(lines[i].trim());
          if (next?.type !== "mediaGroup") break;
          image.content.push(next.content[0]);
          i++;
        }
      }
      content.push(image);
      continue;
    }

    if ((m = CARD_LINE.exec(s))) {
      content.push({ type: "blockCard", attrs: { url: m[1] } });
      i++;
      continue;
    }

    const para: string[] = [raw];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++]);
    const inline = paragraphInline(para);
    content.push(inline.length ? { type: "paragraph", content: inline } : { type: "paragraph" });
  }
  return content;
}

export function markdownToAdf(markdown: string, opts: { emoji?: EmojiAttrs } = {}): N {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  knownEmoji = opts.emoji ?? {};
  try {
    return { type: "doc", version: 1, content: parseBlocks(lines) };
  } finally {
    knownEmoji = {};
  }
}

// ---------------------------------------------------------------------------------------------------------------
// ADF -> Markdown
// ---------------------------------------------------------------------------------------------------------------

/** Escapes text so it reads back as itself. */
function esc(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const prev = s[i - 1] ?? "", next = s[i + 1] ?? "";
    if (c === "\\" || c === "*" || c === "`" || c === "[" || c === "]" || c === "<") out += "\\" + c;
    else if (c === "_" && (!ALNUM.test(prev) || !ALNUM.test(next))) out += "\\_";
    else if (c === "~" && (prev === "~" || next === "~")) out += "\\~";
    else if (c === ":" && !/\w/.test(prev) && /^:[a-z][a-z0-9_+-]*:(?!\w)/.test(s.slice(i))) out += "\\:";
    else out += c;
  }
  return out;
}

const linkDest = (href: string) => (/[\s()<>]/.test(href) ? `<${href}>` : href);

function wrapText(text: string, marks: Mark[]): string {
  const lead = /^\s*/.exec(text)![0];
  const core = text.slice(lead.length).trimEnd();
  const trail = text.slice(lead.length + core.length);
  if (!core) return text;
  const has = (t: string) => marks.find((m) => m.type === t);
  let s: string;
  if (has("code")) {
    let run = 0;
    for (const m of core.matchAll(/`+/g)) run = Math.max(run, m[0].length);
    const ticks = "`".repeat(run + 1);
    const pad = core.startsWith("`") || core.endsWith("`") ? " " : "";
    s = `${ticks}${pad}${core}${pad}${ticks}`;
  } else s = esc(core);
  const color = has("textColor");
  if (color) s = `<span color="${color.attrs?.color}">${s}</span>`;
  if (has("underline")) s = `<u>${s}</u>`;
  if (has("strike")) s = `~~${s}~~`;
  if (has("em")) s = has("strong") ? `_${s}_` : `*${s}*`;
  if (has("strong")) s = `**${s}**`;
  const link = has("link");
  if (link) s = `[${s}](${linkDest(String(link.attrs?.href ?? ""))})`;
  return lead + s + trail;
}

function inlineMd(nodes: N[] | undefined, cell = false): string {
  // A newline inside text is a line break. Line breaks at the ends, and repeated ones, cannot be written in
  // Markdown (a paragraph ends where its lines do), so runs of them, with the blanks between, count as one.
  const items = mergeText(
    (JSON.parse(JSON.stringify(nodes ?? [])) as N[]).flatMap((n) =>
      n.type === "text" && n.text.includes("\n")
        ? n.text.split("\n").flatMap((part: string, k: number) => [...(k ? [{ type: "hardBreak" }] : []), { ...n, text: part }])
        : [n]
    ),
  );
  const kept: N[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].type !== "hardBreak") { kept.push(items[i]); continue; }
    let j = i + 1;
    while (j < items.length && (items[j].type === "hardBreak" || (items[j].type === "text" && !items[j].text.trim()))) j++;
    if (j < items.length && kept.length) kept.push(items[i]);
    i = j - 1;
  }
  return kept.map((n) => {
    switch (n.type) {
      case "text": return wrapText(n.text, n.marks ?? []);
      case "hardBreak": return cell ? "<br>" : "\\\n";
      case "mention": return `@[${String(n.attrs?.text ?? "@someone").replace(/^@/, "").replace(/[\\[\]]/g, "\\$&")}](mention:${n.attrs?.id ?? ""})`;
      case "emoji": {
        const short = n.attrs?.shortName;
        return typeof short === "string" && /^:[a-z][a-z0-9_+-]*:$/.test(short) ? short : esc(String(n.attrs?.text ?? ""));
      }
      case "inlineCard": return n.attrs?.url ? `<${n.attrs.url}>` : "";
      case "mediaInline": return n.attrs?.id ? `![](${mediaDest(n, {})})` : "";
      default: return "";
    }
  }).join("");
}

const LINE_START = /^( *)(#{1,6}(?= )|[-+](?= |$)|\d+(?=[.)](?: |$))|>|\||:::|`{3}|-{3,}$)/;
function escapeLineStarts(md: string): string {
  return md.split("\n").map((l) => l.replace(LINE_START, (_m, sp: string, tok: string) => (/^\d/.test(tok) ? sp + tok + "\\" : sp + "\\" + tok))).join("\n");
}

const indent = (s: string, n: number) => s.split("\n").map((l, k) => (k === 0 || !l ? l : " ".repeat(n) + l)).join("\n");
const isList = (n: N) => n?.type === "bulletList" || n?.type === "orderedList" || n?.type === "taskList";
const raw = (n: N) => "```adf\n" + JSON.stringify(n) + "\n```";

function mediaDest(media: N, extra: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") q.set(k, String(v));
  const a = media.attrs ?? {};
  if (a.width) q.set("w", String(a.width));
  if (a.height) q.set("h", String(a.height));
  if (a.collection) q.set("c", String(a.collection));
  const qs = q.toString();
  return `media:${encodeURIComponent(String(a.id)).replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"))}${qs ? "?" + qs : ""}`;
}

const altText = (s: unknown) => String(s ?? "").replace(/[\\[\]]/g, "\\$&");

function tableMd(n: N): string {
  const rows: N[] = n.content ?? [];
  const lines: string[] = [];
  for (const [k, r] of rows.entries()) {
    const cells = (r.content ?? []).map((c: N) => {
      const kids: N[] = c.content ?? [];
      if (kids.length > 1 || kids.some((x) => x.type !== "paragraph")) return null;
      return inlineMd(kids[0]?.content, true).replace(/\n/g, " ").replace(/\|/g, "\\|");
    });
    if (cells.includes(null) || !cells.length) return raw(n);
    // A header cell is only understood in the first row, and a header row only when every cell in it is one.
    const kinds = new Set((r.content ?? []).map((c: N) => c.type));
    if (kinds.size > 1 || (k > 0 && kinds.has("tableHeader"))) return raw(n);
    lines.push(`| ${cells.join(" | ")} |`);
    if (k === 0 && kinds.has("tableHeader")) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
  }
  return lines.join("\n");
}

function listMd(n: N): string {
  const items: N[] = n.content ?? [];
  return items.map((it, k) => {
    if (n.type === "taskList") {
      if (it.type !== "taskItem") return "";
      const text = inlineMd(it.content);
      return text ? `- [${it.attrs?.state === "DONE" ? "x" : " "}] ${text}` : "";
    }
    const marker = n.type === "orderedList" ? `${k + 1}. ` : "- ";
    let body = "";
    for (const c of (it.content ?? []) as N[]) {
      const s = blockMd(c);
      if (s) body += body ? (isList(c) ? "\n" : "\n\n") + s : s;
    }
    return body ? marker + indent(body, marker.length) : "";
  }).filter(Boolean).join("\n");
}

function blockMd(n: N): string {
  switch (n.type) {
    case "paragraph": return escapeLineStarts(inlineMd(n.content));
    case "heading":
      if ((n.content ?? []).some((c: N) => c.type === "hardBreak")) return raw(n);
      if (!inlineMd(n.content)) return "";
      return `${"#".repeat(Math.min(6, Math.max(1, n.attrs?.level ?? 3)))} ${inlineMd(n.content)}`;
    case "bulletList":
    case "orderedList":
    case "taskList": return listMd(n);
    case "codeBlock": {
      const code = (n.content ?? []).map((t: N) => t.text ?? "").join("");
      let run = 2;
      for (const m of code.matchAll(/`+/g)) run = Math.max(run, m[0].length);
      const fence = "`".repeat(run + 1);
      return `${fence}${n.attrs?.language ?? ""}\n${code}\n${fence}`;
    }
    case "blockquote": return blocksMd(n.content ?? []).split("\n").map((l) => (l ? "> " + l : ">")).join("\n");
    case "rule": return "---";
    case "table": return tableMd(n);
    case "panel": return `:::${n.attrs?.panelType ?? "info"}\n${blocksMd(n.content ?? [])}\n:::`;
    case "expand": return `:::expand ${String(n.attrs?.title ?? "").replace(/\n/g, " ")}\n${blocksMd(n.content ?? [])}\n:::`;
    case "blockCard": return n.attrs?.url ? `<<${n.attrs.url}>>` : raw(n);
    case "mediaSingle": {
      const media: N[] = n.content ?? [];
      const m = media[0];
      if (media.length !== 1 || m?.type !== "media") return raw(n);
      if (m.attrs?.type === "external" && m.attrs.url) return `![${altText(m.attrs.alt)}](${m.attrs.url})`;
      if (m.attrs?.type !== "file" || !m.attrs.id) return raw(n);
      return `![${altText(m.attrs.alt)}](${mediaDest(m, { layout: n.attrs?.layout === "center" ? undefined : n.attrs?.layout, sw: n.attrs?.width, swt: n.attrs?.widthType })})`;
    }
    case "mediaGroup": {
      const media: N[] = n.content ?? [];
      if (!media.length || media.some((m) => m.type !== "media" || m.attrs?.type !== "file" || !m.attrs.id)) return raw(n);
      return media.map((m) => `![${altText(m.attrs.alt)}](${mediaDest(m, { g: 1 })})`).join("\n");
    }
    default: return raw(n);
  }
}

function blocksMd(nodes: N[]): string {
  return nodes.map(blockMd).filter((s) => s !== "").join("\n\n");
}

/** Markdown for a document; `markdownToAdf` of the result is the same document up to cosmetic details. */
export function adfToMarkdown(doc: N | null | undefined): string {
  if (!doc?.content) return "";
  return blocksMd(doc.content as N[]);
}
