import { describe, expect, it } from "vitest";
import type { InboxEntry, InboxEvent } from "@shared/inbox";
import { summarizeEvents, unreadCount } from "./inbox";

const ev = (over: Partial<InboxEvent>): InboxEvent => ({
  id: Math.random().toString(36), key: "ABC-1", kind: "status", at: "2026-11-13T10:00:00.000Z", author: { id: "a", name: "Ana" }, from: null, to: null, ...over,
});
const entry = (key: string, state: InboxEntry["state"]): InboxEntry => ({ key, state, updatedAt: "2026-11-13T10:00:00.000Z", readAt: null, events: [] });

describe("summarizeEvents", () => {
  it("joins a status move, comments and an assignment in the order they first happened", () => {
    expect(summarizeEvents([
      ev({ kind: "status", from: "In Progress", to: "In Review" }),
      ev({ kind: "comment" }),
      ev({ kind: "comment" }),
      ev({ kind: "assignee", from: null, to: "Ana" }),
    ])).toBe("Status In Progress → In Review · 2 comments · Assignee → Ana");
  });

  it("says a lone comment that mentions the owner is a mention, and keeps the count when there are more", () => {
    expect(summarizeEvents([ev({ kind: "comment", mentionsMe: true })])).toBe("Mentioned you");
    expect(summarizeEvents([ev({ kind: "comment", mentionsMe: true }), ev({ kind: "comment" })])).toBe("Mentioned you · 2 comments");
    expect(summarizeEvents([ev({ kind: "comment" })])).toBe("1 comment");
  });

  it("collapses several moves of one field into first-from to last-to, and names unassigning", () => {
    expect(summarizeEvents([ev({ kind: "status", from: "A", to: "B" }), ev({ kind: "status", from: "B", to: "C" })])).toBe("Status A → C");
    expect(summarizeEvents([ev({ kind: "assignee", from: "Ana", to: null })])).toBe("Assignee → Unassigned");
  });

  it("has a short line for each other kind, and nothing for no events", () => {
    expect(summarizeEvents([ev({ kind: "created" })])).toBe("New ticket");
    expect(summarizeEvents([ev({ kind: "priority", to: "High" }), ev({ kind: "duedate", to: "2026-11-20" })])).toBe("Priority → High · Due date → 2026-11-20");
    expect(summarizeEvents([ev({ kind: "summary" }), ev({ kind: "labels" }), ev({ kind: "links" })])).toBe("Title changed · Labels changed · Links changed");
    expect(summarizeEvents([ev({ kind: "type", to: "Bug" }), ev({ kind: "parent", to: "ABC-9" })])).toBe("Type → Bug · Parent → ABC-9");
    expect(summarizeEvents([])).toBe("");
  });
});

describe("unreadCount", () => {
  it("counts only unread entries", () => {
    expect(unreadCount([entry("ABC-1", "unread"), entry("ABC-2", "read"), entry("ABC-3", "archived"), entry("ABC-4", "unread")])).toBe(2);
    expect(unreadCount([])).toBe(0);
  });
});
