// deno-lint-ignore-file no-explicit-any
import type { InboxEvent, InboxEventKind } from "../shared/inbox.ts";
import type { UserRef } from "../shared/types.ts";
import { FIELDS } from "./activity.ts";
import type { FieldIds } from "./fields.ts";

const KINDS: Record<string, InboxEventKind> = { ...(FIELDS as Record<string, InboxEventKind>), link: "links", description: "description" };
const EXCERPT_CHARS = 160;

const QA_NAMES = ["qa assignee"];
const POINTS_NAMES = ["story points", "story point estimate"];

/** Which inbox kind a changelog item is, or undefined when the inbox does not follow that field. */
function kindOf(item: any, fields: FieldIds): InboxEventKind | undefined {
  if (item.fieldId) {
    if (item.fieldId === fields.qaAssignee) return "qaAssignee";
    if (item.fieldId === fields.storyPoints) return "points";
  }
  const name = String(item.field).toLowerCase();
  if (!fields.qaAssignee && QA_NAMES.includes(name)) return "qaAssignee";
  if (!fields.storyPoints && POINTS_NAMES.includes(name)) return "points";
  return KINDS[name];
}

/** Jira writes number fields as `3.0`; show `3`. Empty means none. */
function value(kind: InboxEventKind, s: unknown): string | null {
  if (!s) return null;
  const str = String(s);
  if (kind === "points" && Number.isFinite(Number(str))) return String(Number(str));
  return str;
}

const user = (u: any): UserRef | null => (u?.accountId ? { id: u.accountId, name: u.displayName ?? u.accountId } : null);

/** Jira writes offsets as `+0000`; compare instants, not strings. An unreadable time never counts as new. */
const after = (at: string, installedAt: string) => Date.parse(at) > Date.parse(installedAt);

/** Whether an Atlassian document mentions the given account anywhere, however deeply nested. */
export function mentionsUser(adf: any, accountId: string): boolean {
  if (!adf || typeof adf !== "object") return false;
  if (adf.type === "mention" && adf.attrs?.id === accountId) return true;
  return Array.isArray(adf.content) && adf.content.some((n: any) => mentionsUser(n, accountId));
}

function plainText(adf: any): string {
  if (!adf || typeof adf !== "object") return "";
  if (adf.type === "text") return adf.text ?? "";
  if (adf.type === "mention") return adf.attrs?.text ?? "";
  const parts = Array.isArray(adf.content) ? adf.content.map(plainText) : [];
  return parts.join(adf.type === "doc" || adf.type === "bulletList" || adf.type === "orderedList" ? " " : "");
}

/**
 * What happened to one ticket that the inbox might care about, oldest first. `raw` is a Jira issue fetched with
 * `expand=changelog` and its comments. Only things dated after `installedAt` count, the owner's own changes are
 * left out, and comments already in the mirror are known. Rules are applied later, not here. QA assignee and story
 * points are custom fields, so they are recognised by Jira field id (`fields`), falling back to the usual names.
 */
export function detectEvents(raw: any, known: { commentIds: ReadonlySet<string> }, meId: string, installedAt: string, fields: FieldIds = {}): InboxEvent[] {
  const key: string = raw.key;
  const out: InboxEvent[] = [];

  const creator = user(raw.fields?.creator ?? raw.fields?.reporter);
  if (raw.fields?.created && after(raw.fields.created, installedAt) && creator?.id !== meId) {
    out.push({ id: `new:${key}`, key, kind: "created", at: raw.fields.created, author: creator, from: null, to: null });
  }

  for (const h of raw.changelog?.histories ?? []) {
    if (!after(h.created, installedAt) || h.author?.accountId === meId) continue;
    (h.items ?? []).forEach((item: any, i: number) => {
      const kind = kindOf(item, fields);
      if (!kind) return;
      const ev: InboxEvent = {
        id: `h:${h.id}:${i}`, key, kind, at: h.created, author: user(h.author), from: value(kind, item.fromString), to: value(kind, item.toString),
      };
      if (kind === "assignee") {
        if (item.to === meId) ev.assignment = "to-me";
        else if (item.from === meId) ev.assignment = "from-me";
      }
      out.push(ev);
    });
  }

  for (const c of raw.fields?.comment?.comments ?? []) {
    if (known.commentIds.has(c.id) || !after(c.created, installedAt) || c.author?.accountId === meId) continue;
    out.push({
      id: `c:${c.id}`, key, kind: "comment", at: c.created, author: user(c.author), from: null, to: null,
      excerpt: plainText(c.body).slice(0, EXCERPT_CHARS), mentionsMe: mentionsUser(c.body, meId),
    });
  }

  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
