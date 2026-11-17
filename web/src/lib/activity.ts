import type { ActivityEntry, Comment, Issue } from "@shared/types";
import { stripPermanent } from "./projects";
import { typeClass } from "./vocab";

const words = (s: string | null) => (s ? s.split(/\s+/).filter(Boolean) : []);
const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** One change, as a sentence without the person: "changed status from A to B". */
export function describeActivity(a: ActivityEntry): string {
  const { from, to } = a;
  switch (a.field) {
    case "status": return from ? `changed status from ${from} to ${to}` : `set status to ${to}`;
    case "assignee":
      return !from ? `assigned this to ${to}` : !to ? `unassigned ${from}` : `changed assignee from ${from} to ${to}`;
    case "priority": return from ? `changed priority from ${from} to ${to}` : `set priority to ${to}`;
    case "summary": return `renamed this from “${from}” to “${to}”`;
    case "labels": {
      const before = words(from);
      const after = words(to);
      const added = after.filter((l) => !before.includes(l));
      const removed = before.filter((l) => !after.includes(l));
      const parts = [];
      if (added.length) parts.push(`added label${added.length > 1 ? "s" : ""} ${list(added)}`);
      if (removed.length) parts.push(`removed label${removed.length > 1 ? "s" : ""} ${list(removed)}`);
      return parts.join(" and ") || "changed labels";
    }
    case "type": return `changed type from ${typeClass(from ?? "")} to ${typeClass(to ?? "")}`;
    case "duedate":
      return !to ? "cleared the due date" : !from ? `set the due date to ${to}` : `changed the due date from ${from} to ${to}`;
    case "parent": {
      const f = from ? stripPermanent(from) : null;
      const t = to ? stripPermanent(to) : null;
      return !f ? `added this to project ${t}` : !t ? `removed this from project ${f}` : `moved this from project ${f} to ${t}`;
    }
    default: return `changed ${a.field}`;
  }
}

export type TimelineItem =
  | { kind: "created"; id: string; at: string; who: string }
  | { kind: "event"; id: string; at: string; who: string; text: string }
  | { kind: "comment"; id: string; at: string; comment: Comment; replies: Comment[] };

/**
 * Comments grouped into threads. A reply (also a reply to a reply) goes under the comment that started the thread,
 * oldest first; a reply whose parent is gone stands on its own.
 */
export function threads(comments: Comment[]): Array<{ comment: Comment; replies: Comment[] }> {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const root = (c: Comment): Comment => {
    let cur = c;
    for (let hops = 0; cur.parentId && byId.has(cur.parentId) && hops < comments.length; hops++) cur = byId.get(cur.parentId)!;
    return cur;
  };
  const out = new Map<string, { comment: Comment; replies: Comment[] }>();
  for (const c of comments) if (root(c) === c) out.set(c.id, { comment: c, replies: [] });
  for (const c of comments) {
    const r = root(c);
    if (r !== c) out.get(r.id)!.replies.push(c);
  }
  for (const t of out.values()) t.replies.sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
  return [...out.values()];
}

/** Creation, changes and comments of a ticket in the order they happened. */
export function timeline(issue: Issue, comments: Comment[], activity: ActivityEntry[]): TimelineItem[] {
  const items: TimelineItem[] = [
    { kind: "created", id: "created", at: issue.created, who: issue.reporter?.name ?? "Someone" },
    ...activity.map((a): TimelineItem => ({ kind: "event", id: a.id, at: a.at, who: a.author?.name ?? "Someone", text: describeActivity(a) })),
    ...threads(comments).map((t): TimelineItem => ({ kind: "comment", id: `c${t.comment.id}`, at: t.comment.created, comment: t.comment, replies: t.replies })),
  ];
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.kind === "created" ? -1 : 0));
}
