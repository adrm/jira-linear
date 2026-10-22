import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createApp } from "./app.ts";
import { openStore } from "./db.ts";
import { createJiraClient } from "./jira.ts";
import { FAKE_FIELDS, FakeJira } from "./testing/fake_jira.ts";

const TOKEN = "super-secret-token-value";

async function setup(fn: (c: { fake: FakeJira; app: ReturnType<typeof createApp>; store: ReturnType<typeof openStore>; staticDir: string }) => Promise<void>) {
  const fake = new FakeJira("test@example.com", TOKEN).start();
  const store = openStore(":memory:");
  const client = createJiraClient({ baseUrl: fake.baseUrl, email: "test@example.com", apiToken: TOKEN, sleep: () => Promise.resolve() });
  const staticDir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${staticDir}/index.html`, "<h1>hi</h1>");
  const app = createApp({ store, project: "ABC", client, fields: FAKE_FIELDS, staticDir });
  try {
    await fn({ fake, app, store, staticDir });
  } finally {
    store.close();
    await fake.stop();
    await Deno.remove(staticDir, { recursive: true });
  }
}
const get = (app: ReturnType<typeof createApp>, path: string, init: RequestInit = {}) =>
  app.handler(new Request(`http://localhost:8766${path}`, init));
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.handler(new Request(`http://localhost:8766${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

Deno.test("bootstrap returns the full mirror and current syncId", () =>
  setup(async ({ fake, app }) => {
    fake.seed({ key: "ABC-1" });
    await app.tick();
    const res = await get(app, "/api/bootstrap");
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.issues.map((i: { key: string }) => i.key), ["ABC-1"]);
    assertEquals(body.syncId, 1);
  }));

Deno.test("delta returns only rows after ?since", () =>
  setup(async ({ fake, app }) => {
    fake.seed({ key: "ABC-1" });
    fake.seed({ key: "ABC-2" });
    await app.tick();
    const body = await (await get(app, "/api/delta?since=1")).json();
    assertEquals(body.issues.map((i: { key: string }) => i.key), ["ABC-2"]);
  }));

Deno.test("delta rejects a missing or invalid since", () =>
  setup(async ({ app }) => {
    assertEquals((await get(app, "/api/delta")).status, 400);
    assertEquals((await get(app, "/api/delta?since=abc")).status, 400);
  }));

Deno.test("mutate applies a mutation and the delta reflects it", () =>
  setup(async ({ fake, app }) => {
    fake.seed({ key: "ABC-1" });
    await app.tick();
    const res = await post(app, "/api/mutate", { id: "m1", op: "setSummary", key: "ABC-1", summary: "Changed" });
    assertEquals(res.status, 200);
    const result = await res.json();
    assertEquals(result.key, "ABC-1");
    const delta = await (await get(app, `/api/delta?since=${result.syncId - 1}`)).json();
    assertEquals(delta.issues[0].summary, "Changed");
    assertEquals(fake.issues.get("ABC-1").fields.summary, "Changed");
  }));

Deno.test("mutate surfaces Jira/validation errors with a status and message", () =>
  setup(async ({ app }) => {
    const res = await post(app, "/api/mutate", { id: "m2", op: "setStatus", key: "ABC-404", status: "Done" });
    assert(res.status >= 400);
    const body = await res.json();
    assertEquals(typeof body.error, "string");
  }));

Deno.test("mutate rejects malformed bodies with 400", () =>
  setup(async ({ app }) => {
    assertEquals((await post(app, "/api/mutate", { op: "setSummary" })).status, 400); // no id
    assertEquals((await post(app, "/api/mutate", { id: "x", op: "dropDatabase" })).status, 400);
    const raw = await app.handler(new Request("http://localhost:8766/api/mutate", { method: "POST", body: "{not json" }));
    assertEquals(raw.status, 400);
  }));

Deno.test("requests with a non-localhost Host are refused (DNS rebinding)", () =>
  setup(async ({ app }) => {
    const res = await app.handler(new Request("http://evil.example.com/api/bootstrap"));
    assertEquals(res.status, 403);
  }));

Deno.test("cross-origin writes are refused, same-origin allowed", () =>
  setup(async ({ fake, app }) => {
    fake.seed({ key: "ABC-1" });
    await app.tick();
    const body = { id: "c1", op: "setSummary", key: "ABC-1", summary: "x" };
    assertEquals((await post(app, "/api/mutate", body, { origin: "http://evil.example.com" })).status, 403);
    assertEquals((await post(app, "/api/mutate", { ...body, id: "c2" }, { origin: "http://localhost:5173" })).status, 200);
    assertEquals(fake.issues.get("ABC-1").fields.summary, "x");
  }));

Deno.test("the Jira token never appears in any API response", () =>
  setup(async ({ fake, app }) => {
    fake.seed({ key: "ABC-1" });
    await app.tick();
    for (const p of ["/api/bootstrap", "/api/delta?since=0", "/api/status"]) {
      const text = await (await get(app, p)).text();
      assert(!text.includes(TOKEN), p);
      assert(!text.includes(btoa(`test@example.com:${TOKEN}`)), p);
    }
  }));

Deno.test("status reports syncId, last sync time and last error", () =>
  setup(async ({ fake, app }) => {
    fake.seed({ key: "ABC-1" });
    await app.tick();
    const ok = await (await get(app, "/api/status")).json();
    assertEquals(ok.syncId, 1);
    assertEquals(ok.lastError, null);
    assertEquals(typeof ok.lastSyncAt, "string");

    fake.failures.push({ status: 500 });
    await app.tick();
    const bad = await (await get(app, "/api/status")).json();
    assertStringIncludes(bad.lastError, "500");
  }));

Deno.test("POST /api/sync runs a sync now and reports the result", () =>
  setup(async ({ fake, app }) => {
    fake.seed({ key: "ABC-1" });
    const res = await post(app, "/api/sync", {});
    assertEquals(res.status, 200);
    assertEquals((await res.json()).mode, "full");
  }));

Deno.test("SSE sends the current syncId, then again after a change", () =>
  setup(async ({ fake, app }) => {
    fake.seed({ key: "ABC-1" });
    await app.tick();
    const res = await get(app, "/api/events");
    assertEquals(res.headers.get("content-type"), "text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const first = dec.decode((await reader.read()).value);
    assertStringIncludes(first, '"syncId":1');
    fake.now = "2026-10-15T09:30:00.000+0000";
    fake.issues.get("ABC-1").fields.summary = "again";
    fake.touch("ABC-1");
    await app.tick();
    const second = dec.decode((await reader.read()).value);
    assertStringIncludes(second, '"syncId":2');
    await reader.cancel();
  }));

Deno.test("static files are served and path traversal is blocked", () =>
  setup(async ({ app }) => {
    const index = await get(app, "/");
    assertEquals(index.status, 200);
    assertStringIncludes(await index.text(), "<h1>hi</h1>");
    assertEquals((await get(app, "/../deno.json")).status, 404);
    assertEquals((await get(app, "/%2e%2e/deno.json")).status, 404);
  }));

Deno.test("unknown /api routes return 404 JSON", () =>
  setup(async ({ app }) => {
    const res = await get(app, "/api/nope");
    assertEquals(res.status, 404);
  }));

Deno.test("GET /api/me returns the current Jira user and is cached", () =>
  setup(async ({ fake, app }) => {
    const res = await get(app, "/api/me");
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { id: "me", name: "Me" });
    await get(app, "/api/me");
    assertEquals(fake.requests.filter((r) => r.path === "/myself").length, 1);
  }));

Deno.test("GET /api/projects/:key/history returns ticket timings and is cached until something changes", () =>
  setup(async ({ fake, app }) => {
    fake.seed({ key: "ABC-10", issuetype: "Epic" });
    fake.seed({ key: "ABC-11", parent: "ABC-10", status: "Cerrada", created: "2026-09-01T10:00:00.000+0000" });
    fake.setHistory("ABC-11", [{ at: "2026-09-03T10:00:00.000+0000", from: "Backlog", to: "Cerrada" }]);
    fake.setResolved("ABC-11", "2026-09-03T10:00:00.000+0000");
    await app.tick();
    const res = await get(app, "/api/projects/ABC-10/history");
    assertEquals(res.status, 200);
    assertEquals(await res.json(), [{ key: "ABC-11", created: "2026-09-01T10:00:00.000+0000", started: "2026-09-03T10:00:00.000+0000", completed: "2026-09-03T10:00:00.000+0000", canceled: null, points: null }]);
    const expanded = () => fake.requests.filter((r) => r.path === "/search/jql" && (r.body as { expand?: string }).expand === "changelog").length;
    assertEquals(expanded(), 1);
    await get(app, "/api/projects/ABC-10/history");
    assertEquals(expanded(), 1); // cached
    await post(app, "/api/mutate", { id: "h1", op: "setSummary", key: "ABC-11", summary: "Renamed" });
    await get(app, "/api/projects/ABC-10/history");
    assertEquals(expanded(), 2); // a write clears the cache
  }));

Deno.test("history only answers for ABC project keys", () =>
  setup(async ({ app }) => {
    assertEquals((await get(app, "/api/projects/OTH-1/history")).status, 400);
    assertEquals((await get(app, "/api/projects/nope/history")).status, 400);
  }));

Deno.test("GET /api/issues/:key/links lists the issue's remote links, and addLink adds one", () =>
  setup(async ({ fake, app }) => {
    fake.seed({ key: "ABC-10", issuetype: "Epic" });
    assertEquals(await (await get(app, "/api/issues/ABC-10/links")).json(), []);
    const add = await post(app, "/api/mutate", { id: "l1", op: "addLink", key: "ABC-10", url: "https://example.com/spec", title: "Spec" });
    assertEquals(add.status, 200);
    const links = await (await get(app, "/api/issues/ABC-10/links")).json();
    assertEquals(links.map((l: { url: string; title: string }) => [l.url, l.title]), [["https://example.com/spec", "Spec"]]);
  }));

Deno.test("addLink refuses anything that is not an http(s) url", () =>
  setup(async ({ fake, app }) => {
    fake.seed({ key: "ABC-10" });
    const res = await post(app, "/api/mutate", { id: "l2", op: "addLink", key: "ABC-10", url: "javascript:alert(1)", title: "x" });
    assertEquals(res.status, 400);
    assertEquals(fake.remoteLinks.get("ABC-10"), undefined);
  }));

Deno.test("links for keys outside ABC are refused", () =>
  setup(async ({ app }) => {
    assertEquals((await get(app, "/api/issues/OTH-1/links")).status, 400);
  }));

Deno.test("GET /api/issues/:key/activity returns the ticket's history", () =>
  setup(async ({ fake, app }) => {
    fake.seed({ key: "ABC-1" });
    fake.setHistory("ABC-1", [{ at: "2026-09-02T10:00:00.000+0000", field: "status", from: "Backlog", to: "Code Review", author: { accountId: "u1", displayName: "Ana" } }]);
    const res = await get(app, "/api/issues/ABC-1/activity");
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals([body[0].field, body[0].to, body[0].author.name], ["status", "Code Review", "Ana"]);
    assertEquals((await get(app, "/api/issues/OTH-1/activity")).status, 400);
  }));

Deno.test("local project health and updates no longer exist", () =>
  setup(async ({ app }) => {
    assertEquals((await post(app, "/api/projects/ABC-10/updates", { health: "onTrack", body: "x" })).status, 404);
    assertEquals((await get(app, "/api/project-health")).status, 404);
  }));

Deno.test("tickets can be marked for team review, locally, without touching Jira", () =>
  setup(async ({ fake, app }) => {
    fake.seed({ key: "ABC-1" });
    fake.seed({ key: "ABC-2" });
    assertEquals(await (await get(app, "/api/review")).json(), []);
    const res = await post(app, "/api/review", { keys: ["ABC-1", "ABC-2"], marked: true });
    assertEquals(res.status, 200);
    const list = await (await get(app, "/api/review")).json();
    assertEquals(list.map((r: { key: string }) => r.key).sort(), ["ABC-1", "ABC-2"]);
    assertEquals(typeof list[0].markedAt, "string");
    // marking twice keeps one entry; unmarking removes it
    await post(app, "/api/review", { keys: ["ABC-1"], marked: true });
    await post(app, "/api/review", { keys: ["ABC-2"], marked: false });
    assertEquals((await (await get(app, "/api/review")).json()).map((r: { key: string }) => r.key), ["ABC-1"]);
    assertEquals(fake.requests.filter((r) => r.method !== "GET").length, 0);
  }));

Deno.test("review marks are validated", () =>
  setup(async ({ app }) => {
    assertEquals((await post(app, "/api/review", { keys: ["OTH-1"], marked: true })).status, 400);
    assertEquals((await post(app, "/api/review", { keys: "ABC-1", marked: true })).status, 400);
    assertEquals((await post(app, "/api/review", { keys: ["ABC-1"], marked: "yes" })).status, 400);
    assertEquals((await post(app, "/api/review", { keys: Array.from({ length: 501 }, (_, i) => `ABC-${i + 1}`), marked: true })).status, 400);
  }));

Deno.test("config tells the client the project and the workflow Jira reports", () =>
  setup(async ({ app }) => {
    const body = await (await get(app, "/api/config")).json();
    assertEquals([body.project, body.projectName], ["ABC", "ABC"]);
    assertEquals(body.workflow.statuses[0], { name: "Backlog", category: "new" });
    assertEquals(body.workflow.statuses.at(-1), { name: "Cerrada", category: "done" });
    assertEquals(body.workflow.backlog, ["Backlog"]);
    assertEquals(body.vocab, {});
    assertEquals(JSON.stringify(body).includes(TOKEN), false);
  }));
