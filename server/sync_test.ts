import { assertEquals } from "jsr:@std/assert@1";
import { openStore } from "./db.ts";
import { createJiraClient } from "./jira.ts";
import { reconcile, syncOnce, toJqlMinute } from "./sync.ts";
import { FAKE_FIELDS, FakeJira } from "./testing/fake_jira.ts";

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
