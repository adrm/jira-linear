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
  | { kind: "comment"; id: string; at: string; comment: Comment };

/** Creation, changes and comments of a ticket in the order they happened. */
export function timeline(issue: Issue, comments: Comment[], activity: ActivityEntry[]): TimelineItem[] {
  const items: TimelineItem[] = [
    { kind: "created", id: "created", at: issue.created, who: issue.reporter?.name ?? "Someone" },
    ...activity.map((a): TimelineItem => ({ kind: "event", id: a.id, at: a.at, who: a.author?.name ?? "Someone", text: describeActivity(a) })),
    ...comments.map((c): TimelineItem => ({ kind: "comment", id: `c${c.id}`, at: c.created, comment: c })),
  ];
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.kind === "created" ? -1 : 0));
}
