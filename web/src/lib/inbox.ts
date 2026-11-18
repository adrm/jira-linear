import type { InboxEntry, InboxEvent, InboxEventKind } from "@shared/inbox";

const MOVED: Partial<Record<InboxEventKind, string>> = { status: "Status", assignee: "Assignee", priority: "Priority", duedate: "Due date", type: "Type", parent: "Parent" };
const CHANGED: Partial<Record<InboxEventKind, string>> = { summary: "Title changed", description: "Description changed", labels: "Labels changed", links: "Links changed" };

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** One line for what happened to a ticket, kinds in the order they first occurred: `Status A → B · 2 comments`. */
export function summarizeEvents(events: InboxEvent[]): string {
  const kinds = [...new Set(events.map((e) => e.kind))];
  return kinds.map((kind) => {
    const of = events.filter((e) => e.kind === kind);
    const last = of[of.length - 1];
    if (kind === "created") return "New ticket";
    if (kind === "comment") {
      const mentioned = of.some((e) => e.mentionsMe);
      if (!mentioned) return plural(of.length, "comment");
      return of.length === 1 ? "Mentioned you" : `Mentioned you · ${plural(of.length, "comment")}`;
    }
    if (CHANGED[kind]) return CHANGED[kind]!;
    const label = MOVED[kind]!;
    if (kind === "status" && of[0].from) return `${label} ${of[0].from} → ${last.to ?? "none"}`;
    return `${label} → ${last.to ?? (kind === "assignee" ? "Unassigned" : "none")}`;
  }).join(" · ");
}

export const unreadCount = (entries: InboxEntry[]): number => entries.filter((e) => e.state === "unread").length;

export type InboxTab = "unread" | "all" | "archived";

/** The events of an entry the owner has not looked at yet: those detected after the last read mark. */
export function unseenEvents(entry: InboxEntry): InboxEvent[] {
  if (!entry.readAt) return entry.events;
  const mark = Date.parse(entry.readAt);
  return entry.events.filter((e) => Date.parse(e.detectedAt ?? e.at) > mark);
}

/** One event as a sentence for the "since your last visit" list. */
export function describeEvent(e: InboxEvent): string {
  if (e.kind === "comment") return `${e.mentionsMe ? "Mentioned you" : "Commented"}${e.excerpt ? `: “${e.excerpt}”` : ""}`;
  return summarizeEvents([e]);
}

/**
 * The entries a tab lists, in the order given. On the unread tab the entry under the cursor stays even once read,
 * so a row does not vanish from under the owner as they open it.
 */
export function inboxRows(entries: InboxEntry[], tab: InboxTab, keep: string | null): InboxEntry[] {
  if (tab === "archived") return entries.filter((e) => e.state === "archived");
  if (tab === "all") return entries.filter((e) => e.state !== "archived");
  return entries.filter((e) => e.state === "unread" || (e.state === "read" && e.key === keep));
}
