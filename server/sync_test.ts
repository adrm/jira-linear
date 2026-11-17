import { assertEquals } from "jsr:@std/assert@1";
import { openStore } from "./db.ts";
import { createJiraClient } from "./jira.ts";
import { reconcile, syncOnce, toJqlMinute } from "./sync.ts";
import { FAKE_FIELDS, FakeJira } from "./testing/fake_jira.ts";
import { DEFAULT_RULES } from "../shared/inbox.ts";

async function setup(fn: (ctx: { fake: FakeJira; store: ReturnType<typeof openStore>; deps: Parameters<typeof syncOnce>[0] }) => Promise<void>) {
  const fake = new FakeJira().start();
  const store = openStore(":memory:");
  const client = createJiraClient({ baseUrl: fake.baseUrl, email: "test@example.com", apiToken: "test-token", sleep: () => Promise.resolve() });
  try {
    await fn({ fake, store, deps: { client, store, project: "ABC", fields: FAKE_FIELDS, pageSize: 2 } });
  } finally {
    store.close();
    await fake.stop();
  }
}

Deno.test("toJqlMinute keeps local clock time and subtracts the overlap", () => {
  assertEquals(toJqlMinute("2026-10-14T10:30:45.000-0400", 2), "2026-10-14 10:28");
  assertEquals(toJqlMinute("2026-10-14T00:01:00.000+0000", 2), "2026-10-13 23:59");
});

Deno.test("first sync is a full load of the project, across pages", () =>
  setup(async ({ fake, store, deps }) => {
    for (let i = 1; i <= 5; i++) fake.seed({ key: `ABC-${i}` });
    const r = await syncOnce(deps);
    assertEquals(r.mode, "full");
    assertEquals(r.changed, 5);
    assertEquals(store.delta(0).issues.length, 5);
  }));

Deno.test("full sync stores embedded comments", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1" });
    fake.addCommentDirect("ABC-1", "first");
    await syncOnce(deps);
    const d = store.delta(0);
    assertEquals(d.comments.length, 1);
    assertEquals(d.comments[0].issueKey, "ABC-1");
  }));

Deno.test("second sync is incremental and only changes updated issues", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1", summary: "one" });
    fake.seed({ key: "ABC-2", summary: "two" });
    await syncOnce(deps);
    const before = store.currentSyncId();

    fake.now = "2026-10-15T09:10:00.000+0000";
    fake.issues.get("ABC-2").fields.summary = "two edited";
    fake.touch("ABC-2");

    const r = await syncOnce(deps);
    assertEquals(r.mode, "incremental");
    assertEquals(r.changed, 1);
    const d = store.delta(before);
    assertEquals(d.issues.map((i) => [i.key, i.summary]), [["ABC-2", "two edited"]]);
  }));

Deno.test("incremental sync with nothing new does not bump syncId", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1" });
    await syncOnce(deps);
    const before = store.currentSyncId();
    const r = await syncOnce(deps);
    assertEquals(r.changed, 0);
    assertEquals(store.currentSyncId(), before);
  }));

Deno.test("overlap window catches a change in the same minute as the cursor", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1", summary: "a" });
    fake.now = "2026-10-15T09:00:00.000+0000";
    await syncOnce(deps);
    // second edit lands in the same minute, after the first sync
    fake.issues.get("ABC-1").fields.summary = "b";
    fake.touch("ABC-1", "2026-10-15T09:00:30.000+0000");
    await syncOnce(deps);
    assertEquals(store.delta(0).issues[0].summary, "b");
  }));

Deno.test("a new comment on an issue is picked up incrementally", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1" });
    await syncOnce(deps);
    fake.now = "2026-10-15T09:05:00.000+0000";
    fake.addCommentDirect("ABC-1", "later");
    fake.touch("ABC-1");
    await syncOnce(deps);
    assertEquals(store.delta(0).comments.length, 1);
  }));

Deno.test("a reply keeps its parent even when the search result embeds every comment", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1" });
    const first = fake.addCommentDirect("ABC-1", "question");
    const reply = fake.addCommentDirect("ABC-1", "answer");
    reply.parentId = first.id;
    await syncOnce(deps);
    const byId = new Map(store.delta(0).comments.map((c) => [c.id, c]));
    assertEquals(byId.get(String(reply.id))?.parentId, String(first.id));
    assertEquals(byId.get(String(first.id))?.parentId, undefined);
  }));

Deno.test("comments are fetched separately when the embedded list is truncated", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1" });
    fake.addCommentDirect("ABC-1", "c1");
    fake.addCommentDirect("ABC-1", "c2");
    fake.truncateEmbeddedComments = 1;
    await syncOnce(deps);
    assertEquals(store.delta(0).comments.length, 2);
    assertEquals(fake.requests.some((r) => r.path === "/issue/ABC-1/comment"), true);
  }));

Deno.test("reconcile tombstones issues deleted in Jira", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1" });
    fake.seed({ key: "ABC-2" });
    await syncOnce(deps);
    const before = store.currentSyncId();
    fake.delete("ABC-2");
    const n = await reconcile(deps);
    assertEquals(n, 1);
    assertEquals(store.delta(before).issues.map((i) => [i.key, i.deleted]), [["ABC-2", true]]);
  }));

Deno.test("reconcile refuses to tombstone everything when Jira returns nothing", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1" });
    await syncOnce(deps);
    fake.delete("ABC-1");
    const n = await reconcile(deps);
    // an empty live set is more likely an outage/permission issue than a mass delete
    assertEquals(n, 0);
    assertEquals(store.delta(0).issues[0].deleted, false);
  }));

Deno.test("syncOnce only ever queries the configured project", () =>
  setup(async ({ fake, deps }) => {
    fake.seed({ key: "ABC-1" });
    await syncOnce(deps);
    const searches = fake.requests.filter((r) => r.path === "/search/jql");
    for (const s of searches) assertEquals(/project\s*=\s*"?ABC"?/.test((s.body as { jql: string }).jql), true);
  }));

const ME = { accountId: "me", displayName: "Me" };
const ANA = { accountId: "ana", displayName: "Ana" };
const inboxDeps = (deps: Parameters<typeof syncOnce>[0]) => ({ ...deps, meId: "me" });

Deno.test("inbox: a full first sync stores no entries, even for tickets with fresh history and comments", () =>
  setup(async ({ fake, store, deps }) => {
    store.setKv("inbox_installed_at", "2026-10-15T08:00:00.000Z");
    fake.seed({ key: "ABC-1", assignee: ME });
    fake.setHistory("ABC-1", [{ at: "2026-10-15T08:30:00.000+0000", from: "Backlog", to: "In Development", author: ANA }]);
    fake.addCommentDirect("ABC-1", "hello", ANA);
    const r = await syncOnce(inboxDeps(deps));
    assertEquals(r.mode, "full");
    assertEquals(store.inbox(), []);
  }));

Deno.test("inbox: after the first sync, a colleague's status change and new comment make one entry with both events", () =>
  setup(async ({ fake, store, deps }) => {
    store.setKv("inbox_installed_at", "2026-10-15T08:00:00.000Z");
    fake.seed({ key: "ABC-1", assignee: ME });
    await syncOnce(inboxDeps(deps));
    fake.now = "2026-10-15T09:10:00.000+0000";
    fake.setHistory("ABC-1", [{ at: "2026-10-15T09:05:00.000+0000", from: "Backlog", to: "In Review", author: ANA }]);
    fake.addCommentDirect("ABC-1", "please look", ANA);
    fake.touch("ABC-1");
    await syncOnce(inboxDeps(deps));
    const [entry, ...rest] = store.inbox();
    assertEquals(rest.length, 0);
    assertEquals([entry.key, entry.state], ["ABC-1", "unread"]);
    assertEquals(entry.events.map((e) => e.kind), ["status", "comment"]);
  }));

Deno.test("inbox: syncing again, including a run that re-reads the same issue through the overlap window, adds nothing", () =>
  setup(async ({ fake, store, deps }) => {
    store.setKv("inbox_installed_at", "2026-10-15T08:00:00.000Z");
    fake.seed({ key: "ABC-1", assignee: ME });
    await syncOnce(inboxDeps(deps));
    fake.now = "2026-10-15T09:10:00.000+0000";
    fake.setHistory("ABC-1", [{ at: "2026-10-15T09:05:00.000+0000", from: "Backlog", to: "In Review", author: ANA }]);
    fake.touch("ABC-1");
    await syncOnce(inboxDeps(deps));
    const first = store.inbox();
    await syncOnce(inboxDeps(deps));
    fake.touch("ABC-1", "2026-10-15T09:10:30.000+0000"); // the same minute as the cursor: read again
    await syncOnce(inboxDeps(deps));
    assertEquals(store.inbox().map((e) => e.events.length), [1]);
    assertEquals(store.inbox()[0].events[0].id, first[0].events[0].id);
  }));

Deno.test("inbox: history and comments dated before the install time give nothing, later ones do, on a store that already has a cursor", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1", assignee: ME });
    await syncOnce(deps); // an install from before the inbox existed: cursor set, no inbox bookkeeping
    store.setKv("inbox_installed_at", "2026-10-15T09:30:00.000Z");
    fake.now = "2026-10-15T09:10:00.000+0000";
    fake.setHistory("ABC-1", [{ at: "2026-10-15T09:05:00.000+0000", from: "Backlog", to: "In Review", author: ANA }]);
    fake.addCommentDirect("ABC-1", "old news", ANA);
    fake.touch("ABC-1");
    await syncOnce(inboxDeps(deps));
    assertEquals(store.inbox(), []);
    fake.now = "2026-10-15T09:40:00.000+0000";
    fake.setHistory("ABC-1", [
      { at: "2026-10-15T09:05:00.000+0000", from: "Backlog", to: "In Review", author: ANA },
      { at: "2026-10-15T09:40:00.000+0000", from: "In Review", to: "Done", author: ANA },
    ]);
    fake.touch("ABC-1");
    await syncOnce(inboxDeps(deps));
    assertEquals(store.inbox().map((e) => e.events.map((v) => v.to)), [["Done"]]);
  }));

Deno.test("inbox: a watched ticket counts as involved under scope involved, an unwatched stranger's does not", () =>
  setup(async ({ fake, store, deps }) => {
    store.setKv("inbox_installed_at", "2026-10-15T08:00:00.000Z");
    fake.seed({ key: "ABC-1", watching: true });
    fake.seed({ key: "ABC-2" });
    await syncOnce(inboxDeps(deps));
    assertEquals(fake.requests.some((r) => /watcher/.test((r.body as { jql?: string } | undefined)?.jql ?? "")), false);
    fake.now = "2026-10-15T09:10:00.000+0000";
    for (const key of ["ABC-1", "ABC-2"]) {
      fake.setHistory(key, [{ at: "2026-10-15T09:05:00.000+0000", from: "Backlog", to: "In Review", author: ANA }]);
      fake.touch(key);
    }
    await syncOnce(inboxDeps(deps));
    assertEquals(store.inbox().map((e) => e.key), ["ABC-1"]);
    store.setInboxRules({ ...DEFAULT_RULES, scope: "project" });
    fake.now = "2026-10-15T09:20:00.000+0000";
    fake.setHistory("ABC-2", [
      { at: "2026-10-15T09:05:00.000+0000", from: "Backlog", to: "In Review", author: ANA },
      { at: "2026-10-15T09:15:00.000+0000", from: "In Review", to: "Done", author: ANA },
    ]);
    fake.touch("ABC-2");
    await syncOnce(inboxDeps(deps));
    assertEquals(store.inbox().map((e) => [e.key, e.events.map((v) => v.to)]).sort(), [["ABC-1", ["In Review"]], ["ABC-2", ["Done"]]]);
  }));

Deno.test("inbox: with status changes off no status event is stored, and the owner's own changes add nothing", () =>
  setup(async ({ fake, store, deps }) => {
    store.setKv("inbox_installed_at", "2026-10-15T08:00:00.000Z");
    fake.seed({ key: "ABC-1", assignee: ME });
    await syncOnce(inboxDeps(deps));
    store.setInboxRules({ ...DEFAULT_RULES, status: { mode: "off" } });
    fake.now = "2026-10-15T09:10:00.000+0000";
    fake.setHistory("ABC-1", [{ at: "2026-10-15T09:05:00.000+0000", from: "Backlog", to: "In Review", author: ANA }]);
    fake.touch("ABC-1");
    await syncOnce(inboxDeps(deps));
    assertEquals(store.inbox(), []);
    store.setInboxRules(DEFAULT_RULES);
    fake.now = "2026-10-15T09:20:00.000+0000";
    fake.setHistory("ABC-1", [{ at: "2026-10-15T09:15:00.000+0000", from: "In Review", to: "Done", author: ME }]);
    fake.addCommentDirect("ABC-1", "mine", ME);
    fake.touch("ABC-1");
    await syncOnce(inboxDeps(deps));
    assertEquals(store.inbox(), []);
  }));

Deno.test("inbox: a mention of the owner in a comment is delivered on a ticket that is otherwise not theirs", () =>
  setup(async ({ fake, store, deps }) => {
    store.setKv("inbox_installed_at", "2026-10-15T08:00:00.000Z");
    fake.seed({ key: "ABC-1" });
    await syncOnce(inboxDeps(deps));
    fake.now = "2026-10-15T09:10:00.000+0000";
    const c = fake.addCommentDirect("ABC-1", "x", ANA);
    c.body = { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: "me", text: "@Me" } }, { type: "text", text: " can you check?" }] }] };
    fake.touch("ABC-1");
    await syncOnce(inboxDeps(deps));
    const [entry] = store.inbox();
    assertEquals(entry.events.map((e) => [e.kind, e.mentionsMe]), [["comment", true]]);
  }));

Deno.test("inbox: without an owner id the sync touches no inbox state", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1", assignee: ME });
    await syncOnce(deps);
    fake.now = "2026-10-15T09:10:00.000+0000";
    fake.setHistory("ABC-1", [{ at: "2026-10-15T09:05:00.000+0000", from: "Backlog", to: "In Review", author: ANA }]);
    fake.touch("ABC-1");
    await syncOnce(deps);
    assertEquals(store.inbox(), []);
    assertEquals(store.getKv("inbox_installed_at"), null);
  }));

Deno.test("inbox: a ticket whose embedded history is at Jira's cap gets its full changelog fetched", () =>
  setup(async ({ fake, store, deps }) => {
    store.setKv("inbox_installed_at", "2026-10-15T08:00:00.000Z");
    fake.seed({ key: "ABC-1", assignee: ME });
    await syncOnce(inboxDeps(deps));
    fake.now = "2026-10-15T09:10:00.000+0000";
    fake.setHistory("ABC-1", Array.from({ length: 100 }, (_, i) => ({ at: "2026-10-15T09:05:00.000+0000", from: `S${i}`, to: `S${i + 1}`, author: ANA })));
    fake.touch("ABC-1");
    await syncOnce(inboxDeps(deps));
    assertEquals(fake.requests.some((r) => r.path.startsWith("/issue/ABC-1/changelog")), true);
    assertEquals(store.inbox()[0].events.length, 100);
  }));

Deno.test("inbox: a change the rules turned down stays turned down when the rules change and the ticket is read again", () =>
  setup(async ({ fake, store, deps }) => {
    store.setKv("inbox_installed_at", "2026-10-15T08:00:00.000Z");
    fake.seed({ key: "ABC-1", assignee: ME });
    await syncOnce(inboxDeps(deps));
    store.setInboxRules({ ...DEFAULT_RULES, status: { mode: "off" } });
    fake.now = "2026-10-15T09:10:00.000+0000";
    fake.setHistory("ABC-1", [{ at: "2026-10-15T09:05:00.000+0000", from: "Backlog", to: "In Review", author: ANA }]);
    fake.touch("ABC-1");
    await syncOnce(inboxDeps(deps));
    store.setInboxRules(DEFAULT_RULES);
    await syncOnce(inboxDeps(deps)); // nothing new in Jira; the same ticket comes back through the overlap window
    assertEquals(store.inbox(), []);
  }));

Deno.test("inbox: a dropped change on a ticket does not arrive later because the owner became involved in it", () =>
  setup(async ({ fake, store, deps }) => {
    store.setKv("inbox_installed_at", "2026-10-15T08:00:00.000Z");
    fake.seed({ key: "ABC-2" });
    await syncOnce(inboxDeps(deps));
    fake.now = "2026-10-15T09:10:00.000+0000";
    fake.setHistory("ABC-2", [{ at: "2026-10-15T09:05:00.000+0000", from: "Backlog", to: "In Review", author: ANA }]);
    fake.touch("ABC-2");
    await syncOnce(inboxDeps(deps));
    assertEquals(store.inbox(), []); // not their ticket yet
    fake.now = "2026-10-15T09:20:00.000+0000";
    fake.addCommentDirect("ABC-2", "mine", ME); // commenting makes it theirs
    fake.touch("ABC-2");
    await syncOnce(inboxDeps(deps));
    assertEquals(store.inbox(), []);
  }));

Deno.test("inbox: a new ticket gives its created event even when the sync that first saw it failed afterwards", () =>
  setup(async ({ fake, store, deps }) => {
    store.setKv("inbox_installed_at", "2026-10-15T08:00:00.000Z");
    fake.seed({ key: "ABC-9" });
    await syncOnce(inboxDeps(deps));
    fake.now = "2026-10-15T09:10:00.000+0000";
    fake.seed({ key: "ABC-1", assignee: ME });
    fake.seed({ key: "ABC-2" });
    fake.addCommentDirect("ABC-2", "c", ANA);
    fake.truncateEmbeddedComments = 0; // ABC-2's comments need a second request
    const failing = { ...inboxDeps(deps), client: { ...deps.client, listComments: () => Promise.reject(new Error("Jira went away")) } };
    let failed = false;
    await syncOnce(failing).catch(() => (failed = true));
    assertEquals(failed, true);
    await syncOnce(inboxDeps(deps));
    assertEquals(store.inbox().map((e) => [e.key, e.events.map((v) => v.kind)]), [["ABC-1", ["created"]]]);
  }));

Deno.test("inbox: a ticket created after the install but first seen by a full load does not announce its creation on a later edit", () =>
  setup(async ({ fake, store, deps }) => {
    store.setKv("inbox_installed_at", "2026-10-15T08:00:00.000Z");
    fake.seed({ key: "ABC-1", assignee: ME, created: "2026-10-15T09:00:00.000+0000" });
    await syncOnce(inboxDeps(deps)); // full
    fake.now = "2026-10-15T09:10:00.000+0000";
    fake.setHistory("ABC-1", [{ at: "2026-10-15T09:05:00.000+0000", from: "Backlog", to: "In Review", author: ANA }]);
    fake.touch("ABC-1");
    await syncOnce(inboxDeps(deps));
    assertEquals(store.inbox().map((e) => e.events.map((v) => v.kind)), [["status"]]);
  }));
