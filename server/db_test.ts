import { assertEquals } from "jsr:@std/assert@1";
import { openStore } from "./db.ts";
import type { Comment, Issue } from "../shared/types.ts";

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
