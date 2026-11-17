/**
 * Mentions in the editors. The box shows `@Ana López`; Jira gets `@[Ana López](mention:accountId)`, which the
 * shared Markdown converter writes as a native mention node. `people` remembers who each shown name stands for.
 */
export type People = Record<string, string>;

const TOKEN = /@\[((?:\\[\s\S]|[^\]\\])*)\]\(mention:([^)\s]+)\)/g;
const WORD = "\\p{L}\\p{N}_";
const MAX_QUERY = 30;

const escapeName = (name: string) => name.replace(/[\\[\]]/g, "\\$&");
const regexEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Markdown with mention links -> the text to show, plus the people in it. */
export function toDisplay(markdown: string): { text: string; people: People } {
  const people: People = {};
  const text = markdown.replace(TOKEN, (whole, raw: string, id: string) => {
    const name = raw.replace(/\\([\s\S])/g, "$1");
    if (people[name] !== undefined && people[name] !== id) return whole; // same name, another person: keep it written out
    people[name] = id;
    return "@" + name;
  });
  return { text, people };
}

/** The shown text -> Markdown, writing each remembered `@Name` as a mention. Longest names win. */
export function fromDisplay(text: string, people: People): string {
  const names = Object.keys(people).sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const re = new RegExp(`(^|[^${WORD}@\\\\])@(${names.map(regexEscape).join("|")})(?![${WORD}])`, "gu");
  return text.replace(re, (_w, before: string, name: string) => `${before}@[${escapeName(name)}](mention:${people[name]})`);
}

/** The `@query` being typed just before the caret, if any. `start` is the index of the `@`. */
export function activeMention(text: string, caret: number, people: People): { start: number; query: string } | null {
  const m = new RegExp(`(^|[\\s(])@([^@\\n\\[\\]]{0,${MAX_QUERY}})$`, "u").exec(text.slice(0, caret));
  if (!m) return null;
  const query = m[2];
  if (Object.keys(people).some((n) => query === n + " ")) return null; // just inserted
  return { start: m.index + m[1].length, query };
}

/** The name to show for a person: the plain name, unless a different person already uses it in this text. */
export function uniqueLabel(name: string, id: string, people: People): string {
  return people[name] === undefined || people[name] === id ? name : `${name} (${id.slice(-4)})`;
}
