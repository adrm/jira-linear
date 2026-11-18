import { describe, expect, it } from "vitest";
import type { InboxEntry, InboxEvent } from "@shared/inbox";
import { describeEvent, inboxRows, summarizeEvents, unreadCount, unseenEvents } from "./inbox";

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

  it("describes QA assignee and story point changes", () => {
    expect(summarizeEvents([ev({ kind: "qaAssignee", from: "Bo", to: "Cy" })])).toBe("QA assignee → Cy");
    expect(summarizeEvents([ev({ kind: "qaAssignee", from: "Bo", to: null })])).toBe("QA assignee → none");
    expect(summarizeEvents([ev({ kind: "points", from: "3", to: "5" }), ev({ kind: "points", from: "5", to: "8" })])).toBe("Story points 3 → 8");
    expect(summarizeEvents([ev({ kind: "points", from: null, to: "2" })])).toBe("Story points none → 2");
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
    expect(summarizeEvents([ev({ kind: "description" }), ev({ kind: "description" })])).toBe("Description changed");
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

const at = (detectedAt: string, over: Partial<InboxEvent> = {}) => ev({ detectedAt, ...over });

describe("unseenEvents", () => {
  it("is every event for an entry never read, and only those detected after the read mark otherwise", () => {
    const events = [at("2026-11-13T10:00:00.000Z", { id: "a" }), at("2026-11-13T12:00:00.000Z", { id: "b" })];
    expect(unseenEvents({ ...entry("ABC-1", "unread"), events }).map((e) => e.id)).toEqual(["a", "b"]);
    expect(unseenEvents({ ...entry("ABC-1", "unread"), readAt: "2026-11-13T11:00:00.000Z", events }).map((e) => e.id)).toEqual(["b"]);
    expect(unseenEvents({ ...entry("ABC-1", "read"), readAt: "2026-11-13T13:00:00.000Z", events })).toEqual([]);
  });
});

describe("describeEvent", () => {
  it("says what one event was, with the comment text when there is one", () => {
    expect(describeEvent(ev({ kind: "status", from: "A", to: "B" }))).toBe("Status A → B");
    expect(describeEvent(ev({ kind: "comment", excerpt: "Please look" }))).toBe("Commented: “Please look”");
    expect(describeEvent(ev({ kind: "comment", excerpt: "@Me can you check?", mentionsMe: true }))).toBe("Mentioned you: “@Me can you check?”");
    expect(describeEvent(ev({ kind: "created" }))).toBe("New ticket");
  });
});

describe("inboxRows", () => {
  const rows = [entry("ABC-1", "unread"), entry("ABC-2", "read"), entry("ABC-3", "archived"), entry("ABC-4", "unread")];
  it("lists unread, unread and read, or archived entries by tab, in the order given", () => {
    expect(inboxRows(rows, "unread", null).map((e) => e.key)).toEqual(["ABC-1", "ABC-4"]);
    expect(inboxRows(rows, "all", null).map((e) => e.key)).toEqual(["ABC-1", "ABC-2", "ABC-4"]);
    expect(inboxRows(rows, "archived", null).map((e) => e.key)).toEqual(["ABC-3"]);
  });
  it("keeps the row being looked at on the unread tab even once it is read, so it does not vanish under the cursor", () => {
    expect(inboxRows(rows, "unread", "ABC-2").map((e) => e.key)).toEqual(["ABC-1", "ABC-2", "ABC-4"]);
    expect(inboxRows(rows, "unread", "ABC-3").map((e) => e.key)).toEqual(["ABC-1", "ABC-4"]);
  });
});
