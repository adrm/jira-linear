import { assertEquals } from "jsr:@std/assert@1";
import { openStore } from "./db.ts";
import type { Comment, Issue } from "../shared/types.ts";
import { DEFAULT_RULES, type InboxEvent } from "../shared/inbox.ts";

function issue(key: string, over: Partial<Issue> = {}): Issue {
  return {
    key,
    id: key.replace("ABC-", "1"),
    project: "ABC",
    summary: `Summary ${key}`,
    descriptionAdf: null,
    status: "Backlog",
    statusCategory: "new",
    issuetype: "Task",
    priority: "Medium",
    assignee: null,
    reporter: null,
    qaAssignees: [],
    parentKey: null,
    parentSummary: null,
    labels: [],
    duedate: null,
    created: "2026-10-01T10:00:00.000+0000",
    updated: "2026-10-01T10:00:00.000+0000",
    links: [],
    quarter: null,
    initialEstimate: null,
    revisedEstimate: null,
    statusChanged: null,
    storyPoints: null,
    resolution: null,
    ...over,
  };
}

function comment(id: string, issueKey: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    issueKey,
    author: null,
    bodyAdf: null,
    created: "2026-10-01T10:00:00.000+0000",
    updated: "2026-10-01T10:00:00.000+0000",
    ...over,
  };
}

Deno.test("a new store starts at syncId 0 with an empty delta", () => {
  const s = openStore(":memory:");
  assertEquals(s.currentSyncId(), 0);
  assertEquals(s.delta(0), { syncId: 0, issues: [], comments: [] });
});

Deno.test("upserting issues assigns increasing syncIds and delta returns only newer rows", () => {
  const s = openStore(":memory:");
  s.upsertIssue(issue("ABC-1"));
  s.upsertIssue(issue("ABC-2"));
  assertEquals(s.currentSyncId(), 2);

  const all = s.delta(0);
  assertEquals(all.syncId, 2);
  assertEquals(all.issues.map((i) => i.key), ["ABC-1", "ABC-2"]);

  const since1 = s.delta(1);
  assertEquals(since1.issues.map((i) => i.key), ["ABC-2"]);
  assertEquals(s.delta(2).issues, []);
});

Deno.test("re-upserting an identical issue does not bump the syncId", () => {
  const s = openStore(":memory:");
  s.upsertIssue(issue("ABC-1"));
  const changed = s.upsertIssue(issue("ABC-1"));
  assertEquals(changed, false);
  assertEquals(s.currentSyncId(), 1);
});

Deno.test("updating an issue moves it to a new syncId and replaces its data", () => {
  const s = openStore(":memory:");
  s.upsertIssue(issue("ABC-1"));
  s.upsertIssue(issue("ABC-2"));
  const changed = s.upsertIssue(issue("ABC-1", { status: "Done", statusCategory: "done" }));
  assertEquals(changed, true);
  assertEquals(s.currentSyncId(), 3);

  const d = s.delta(2);
  assertEquals(d.issues.length, 1);
  assertEquals(d.issues[0].key, "ABC-1");
  assertEquals(d.issues[0].status, "Done");
  assertEquals(d.issues[0].deleted, false);
});

Deno.test("tombstoneMissing marks issues absent from the live key set as deleted", () => {
  const s = openStore(":memory:");
  s.upsertIssue(issue("ABC-1"));
  s.upsertIssue(issue("ABC-2"));
  s.upsertIssue(issue("ABC-3"));

  const n = s.tombstoneMissing(["ABC-1", "ABC-3"]);
  assertEquals(n, 1);

  const d = s.delta(3);
  assertEquals(d.issues.map((i) => [i.key, i.deleted]), [["ABC-2", true]]);
  // idempotent
  assertEquals(s.tombstoneMissing(["ABC-1", "ABC-3"]), 0);
});

Deno.test("an issue that reappears after being tombstoned is live again", () => {
  const s = openStore(":memory:");
  s.upsertIssue(issue("ABC-1"));
  s.tombstoneMissing([]);
  s.upsertIssue(issue("ABC-1"));
  const d = s.delta(0);
  assertEquals(d.issues[0].deleted, false);
});

Deno.test("comments are stored per issue and appear in deltas", () => {
  const s = openStore(":memory:");
  s.upsertIssue(issue("ABC-1"));
  s.upsertComment(comment("10", "ABC-1"));
  const d = s.delta(1);
  assertEquals(d.comments.map((c) => c.id), ["10"]);
  assertEquals(s.upsertComment(comment("10", "ABC-1")), false);
});

Deno.test("replaceComments tombstones comments no longer present on the issue", () => {
  const s = openStore(":memory:");
  s.upsertIssue(issue("ABC-1"));
  s.replaceComments("ABC-1", [comment("10", "ABC-1"), comment("11", "ABC-1")]);
  const before = s.currentSyncId();
  s.replaceComments("ABC-1", [comment("11", "ABC-1")]);
  const d = s.delta(before);
  assertEquals(d.comments.map((c) => [c.id, c.deleted]), [["10", true]]);
});

Deno.test("kv values persist across reopen of the same file", () => {
  const path = Deno.makeTempFileSync({ suffix: ".db" });
  try {
    const a = openStore(path);
    a.setKv("cursor", "2026-10-01 10:00");
    a.upsertIssue(issue("ABC-1"));
    a.close();

    const b = openStore(path);
    assertEquals(b.getKv("cursor"), "2026-10-01 10:00");
    assertEquals(b.currentSyncId(), 1);
    assertEquals(b.delta(0).issues.length, 1);
    b.close();
  } finally {
    Deno.removeSync(path);
  }
});

Deno.test("mutation results are stored by id for idempotent replay", () => {
  const s = openStore(":memory:");
  assertEquals(s.getMutationResult("m1"), null);
  s.saveMutationResult("m1", '{"key":"ABC-1"}');
  assertEquals(s.getMutationResult("m1"), '{"key":"ABC-1"}');
});

Deno.test("statusCategories maps each live status name to its category", () => {
  const s = openStore(":memory:");
  s.upsertIssue(issue("ABC-1", { status: "In Development", statusCategory: "indeterminate" }));
  s.upsertIssue(issue("ABC-2", { status: "Cerrada", statusCategory: "done" }));
  s.upsertIssue(issue("ABC-3", { status: "Gone", statusCategory: "new" }));
  s.tombstoneMissing(["ABC-1", "ABC-2"]);
  assertEquals(s.statusCategories(), { "In Development": "indeterminate", Cerrada: "done" });
});

Deno.test("opening a mirror made by an older version forces a full re-sync, so new fields are filled in", () => {
  const path = Deno.makeTempFileSync({ suffix: ".db" });
  try {
    const a = openStore(path);
    a.upsertIssue(issue("ABC-1"));
    a.setKv("cursor", "2026-10-01T10:00:00.000+0000");
    a.setKv("schema", "1"); // as an older build would have left it
    a.close();
    const b = openStore(path);
    assertEquals(b.getKv("cursor"), null);
    assertEquals(b.delta(0).issues.length, 1); // the data itself is kept
    b.setKv("cursor", "keep me");
    b.close();
    const c = openStore(path); // same version: nothing is reset
    assertEquals(c.getKv("cursor"), "keep me");
    c.close();
  } finally {
    Deno.removeSync(path);
  }
});

function ev(id: string, key: string, at: string, over: Partial<InboxEvent> = {}): InboxEvent {
  return { id, key, kind: "status", at, author: { id: "ana", name: "Ana" }, from: "To Do", to: "In Review", ...over };
}

Deno.test("inbox: a first event creates one unread entry with the event", () => {
  const s = openStore(":memory:");
  assertEquals(s.addInboxEvents([ev("e1", "ABC-1", "2026-11-13T10:00:00.000Z")]), 1);
  const [entry, ...rest] = s.inbox();
  assertEquals(rest.length, 0);
  assertEquals([entry.key, entry.state, entry.readAt, entry.updatedAt], ["ABC-1", "unread", null, "2026-11-13T10:00:00.000Z"]);
  assertEquals(entry.events.map((e) => e.id), ["e1"]);
  assertEquals(typeof entry.events[0].detectedAt, "string");
});

Deno.test("inbox: more events on an unread entry join it and move it up, never a second entry", () => {
  const s = openStore(":memory:");
  s.addInboxEvents([ev("e1", "ABC-1", "2026-11-13T10:00:00.000Z"), ev("e2", "ABC-2", "2026-11-13T10:05:00.000Z")]);
  s.addInboxEvents([ev("e3", "ABC-1", "2026-11-13T10:10:00.000Z", { kind: "comment" })]);
  const entries = s.inbox();
  assertEquals(entries.map((e) => e.key), ["ABC-1", "ABC-2"]);
  assertEquals(entries[0].events.map((e) => e.id), ["e1", "e3"]);
  assertEquals(entries[0].state, "unread");
});

Deno.test("inbox: an event already stored, or stored before and since deleted, adds nothing", () => {
  const s = openStore(":memory:");
  assertEquals(s.addInboxEvents([ev("e1", "ABC-1", "2026-11-13T10:00:00.000Z")]), 1);
  assertEquals(s.addInboxEvents([ev("e1", "ABC-1", "2026-11-13T10:00:00.000Z")]), 0);
  s.applyInboxAction(["ABC-1"], "delete");
  assertEquals(s.addInboxEvents([ev("e1", "ABC-1", "2026-11-13T10:00:00.000Z")]), 0);
  assertEquals(s.inbox(), []);
});

Deno.test("inbox: a read entry becomes unread on a new event and keeps the earlier read mark", () => {
  const s = openStore(":memory:");
  s.addInboxEvents([ev("e1", "ABC-1", "2026-11-13T10:00:00.000Z")]);
  s.applyInboxAction(["ABC-1"], "read");
  const readAt = s.inbox()[0].readAt;
  assertEquals(s.inbox()[0].state, "read");
  assertEquals(typeof readAt, "string");
  s.addInboxEvents([ev("e2", "ABC-1", "2026-11-13T11:00:00.000Z")]);
  const [entry] = s.inbox();
  assertEquals([entry.state, entry.readAt], ["unread", readAt]);
  assertEquals(entry.events.map((e) => e.id), ["e1", "e2"]);
});

Deno.test("inbox: reading an entry that is already read or archived changes nothing", () => {
  const s = openStore(":memory:");
  s.addInboxEvents([ev("e1", "ABC-1", "2026-11-13T10:00:00.000Z"), ev("e2", "ABC-2", "2026-11-13T10:00:00.000Z")]);
  s.applyInboxAction(["ABC-1"], "read");
  const before = s.inbox().find((e) => e.key === "ABC-1")!;
  s.applyInboxAction(["ABC-1"], "read");
  assertEquals(s.inbox().find((e) => e.key === "ABC-1"), before);
  s.applyInboxAction(["ABC-2"], "archive");
  s.applyInboxAction(["ABC-2"], "read");
  assertEquals(s.inbox().find((e) => e.key === "ABC-2")!.state, "archived");
});

Deno.test("inbox: an archived entry comes back unread on a new event", () => {
  const s = openStore(":memory:");
  s.addInboxEvents([ev("e1", "ABC-1", "2026-11-13T10:00:00.000Z")]);
  s.applyInboxAction(["ABC-1"], "archive");
  assertEquals(s.inbox()[0].state, "archived");
  s.addInboxEvents([ev("e2", "ABC-1", "2026-11-13T11:00:00.000Z")]);
  assertEquals(s.inbox()[0].state, "unread");
  s.applyInboxAction(["ABC-1"], "archive");
  s.applyInboxAction(["ABC-1"], "unarchive");
  assertEquals(s.inbox()[0].state, "read");
});

Deno.test("inbox: deleting an entry removes it, and the ticket's next new event starts a fresh entry with only that event", () => {
  const s = openStore(":memory:");
  s.addInboxEvents([ev("e1", "ABC-1", "2026-11-13T10:00:00.000Z")]);
  s.applyInboxAction(["ABC-1"], "delete");
  assertEquals(s.inbox(), []);
  s.addInboxEvents([ev("e2", "ABC-1", "2026-11-13T12:00:00.000Z")]);
  const [entry] = s.inbox();
  assertEquals([entry.state, entry.readAt, entry.events.map((e) => e.id)], ["unread", null, ["e2"]]);
});

Deno.test("inbox: marking a read entry unread puts the read mark back so the last batch shows again", () => {
  const s = openStore(":memory:");
  s.addInboxEvents([ev("e1", "ABC-1", "2026-11-13T10:00:00.000Z")]);
  s.applyInboxAction(["ABC-1"], "read");
  s.applyInboxAction(["ABC-1"], "unread");
  const [first] = s.inbox();
  assertEquals([first.state, first.readAt], ["unread", null]);
  s.applyInboxAction(["ABC-1"], "read");
  const firstRead = s.inbox()[0].readAt;
  s.addInboxEvents([ev("e2", "ABC-1", "2026-11-13T11:00:00.000Z")]);
  s.applyInboxAction(["ABC-1"], "read");
  s.applyInboxAction(["ABC-1"], "unread");
  const [again] = s.inbox();
  assertEquals([again.state, again.readAt], ["unread", firstRead]);
});

Deno.test("inbox: tombstoning a ticket removes its entry", () => {
  const s = openStore(":memory:");
  s.upsertIssue(issue("ABC-1"));
  s.upsertIssue(issue("ABC-2"));
  s.addInboxEvents([ev("e1", "ABC-1", "2026-11-13T10:00:00.000Z"), ev("e2", "ABC-2", "2026-11-13T10:00:00.000Z")]);
  s.tombstoneMissing(["ABC-2"]);
  assertEquals(s.inbox().map((e) => e.key), ["ABC-2"]);
});

Deno.test("inbox: the install time is recorded once, rules round-trip and default, the watched set is replaced", () => {
  const s = openStore(":memory:");
  const installed = s.inboxInstalledAt();
  assertEquals(s.inboxInstalledAt(), installed);
  assertEquals(s.inboxRules(), DEFAULT_RULES);
  const rules = { ...DEFAULT_RULES, scope: "project" as const };
  s.setInboxRules(rules);
  assertEquals(s.inboxRules(), rules);
  s.setWatched(["ABC-1", "ABC-2"]);
  assertEquals([...s.watched()].sort(), ["ABC-1", "ABC-2"]);
  s.setWatched(["ABC-3"]);
  assertEquals([...s.watched()], ["ABC-3"]);
});
