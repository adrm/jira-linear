import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createJiraClient, JiraError } from "./jira.ts";
import { adfText, FakeJira } from "./testing/fake_jira.ts";

async function withFake(fn: (fake: FakeJira, mk: (over?: Record<string, unknown>) => ReturnType<typeof createJiraClient>) => Promise<void>) {
  const fake = new FakeJira().start();
  const sleeps: number[] = [];
  const mk = (over = {}) =>
    createJiraClient({
      baseUrl: fake.baseUrl,
      email: "test@example.com",
      apiToken: "test-token",
      sleep: (ms: number) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      ...over,
    });
  try {
    await fn(fake, mk);
  } finally {
    await fake.stop();
  }
}

Deno.test("searchAll follows nextPageToken until isLast", () =>
  withFake(async (fake, mk) => {
    for (let i = 0; i < 5; i++) fake.seed({ key: `ABC-${i + 1}` });
    const issues = await mk().searchAll("project = ABC ORDER BY updated ASC", ["summary"], 2);
    assertEquals(issues.length, 5);
    assertEquals(new Set(issues.map((i: { key: string }) => i.key)).size, 5);
    assertEquals(fake.requests.filter((r) => r.path === "/search/jql").length, 3);
  }));

Deno.test("requests carry Basic auth and bad credentials raise JiraError(401)", () =>
  withFake(async (_fake, mk) => {
    const err = await assertRejects(() => mk({ apiToken: "wrong" }).getIssue("ABC-1"), JiraError);
    assertEquals(err.status, 401);
  }));

Deno.test("429 is retried after Retry-After seconds then succeeds", () =>
  withFake(async (fake, mk) => {
    fake.seed({ key: "ABC-1" });
    fake.failures.push({ status: 429, headers: { "Retry-After": "2" } });
    const issue = await mk().getIssue("ABC-1");
    assertEquals(issue.key, "ABC-1");
  }));

Deno.test("429 backoff waits the Retry-After duration", async () => {
  const fake = new FakeJira().start();
  const sleeps: number[] = [];
  try {
    fake.seed({ key: "ABC-1" });
    fake.failures.push({ status: 429, headers: { "Retry-After": "2" } });
    const c = createJiraClient({
      baseUrl: fake.baseUrl,
      email: "test@example.com",
      apiToken: "test-token",
      sleep: (ms) => (sleeps.push(ms), Promise.resolve()),
    });
    await c.getIssue("ABC-1");
    assertEquals(sleeps, [2000]);
  } finally {
    await fake.stop();
  }
});

Deno.test("429 gives up after maxRetries", () =>
  withFake(async (fake, mk) => {
    fake.seed({ key: "ABC-1" });
    for (let i = 0; i < 10; i++) fake.failures.push({ status: 429, headers: { "Retry-After": "1" } });
    const err = await assertRejects(() => mk({ maxRetries: 2 }).getIssue("ABC-1"), JiraError);
    assertEquals(err.status, 429);
    assertEquals(fake.requests.length, 3);
  }));

Deno.test("404 raises JiraError with status and is not retried", () =>
  withFake(async (fake, mk) => {
    const err = await assertRejects(() => mk().getIssue("ABC-999"), JiraError);
    assertEquals(err.status, 404);
    assertEquals(fake.requests.length, 1);
  }));

Deno.test("getTransitions lists targets and transition changes status", () =>
  withFake(async (fake, mk) => {
    fake.seed({ key: "ABC-1", status: "Backlog" });
    const c = mk();
    const ts = await c.getTransitions("ABC-1");
    assert(ts.some((t: { name: string }) => t.name === "Ready for Dev"));
    assert(!ts.some((t: { name: string }) => t.name === "Backlog"));
    const target = ts.find((t: { name: string }) => t.name === "In Development")!;
    await c.transition("ABC-1", target.id);
    assertEquals(fake.issues.get("ABC-1").fields.status.name, "In Development");
  }));

Deno.test("an invalid transition raises JiraError(400)", () =>
  withFake(async (fake, mk) => {
    fake.seed({ key: "ABC-1", status: "Backlog" });
    const err = await assertRejects(() => mk().transition("ABC-1", "591"), JiraError);
    assertEquals(err.status, 400);
  }));

Deno.test("editFields sends a PUT with fields", () =>
  withFake(async (fake, mk) => {
    fake.seed({ key: "ABC-1" });
    await mk().editFields("ABC-1", { summary: "New", labels: ["a"] });
    assertEquals(fake.issues.get("ABC-1").fields.summary, "New");
    assertEquals(fake.issues.get("ABC-1").fields.labels, ["a"]);
  }));

Deno.test("addComment posts an ADF body and listComments returns it", () =>
  withFake(async (fake, mk) => {
    fake.seed({ key: "ABC-1" });
    const c = mk();
    await c.addComment("ABC-1", adfText("hello"));
    const comments = await c.listComments("ABC-1");
    assertEquals(comments.length, 1);
    assertEquals(comments[0].body, adfText("hello"));
  }));

Deno.test("createIssue returns the new key", () =>
  withFake(async (fake, mk) => {
    const { key } = await mk().createIssue({ project: { key: "ABC" }, summary: "Hi", issuetype: { name: "Task" } });
    assert(fake.issues.has(key));
    assertEquals(fake.issues.get(key).fields.summary, "Hi");
  }));

Deno.test("createLink posts type, inwardIssue and outwardIssue", () =>
  withFake(async (fake, mk) => {
    fake.seed({ key: "ABC-1" });
    fake.seed({ key: "ABC-2" });
    await mk().createLink("Blocks", { inwardKey: "ABC-2", outwardKey: "ABC-1" });
    const body = fake.requests.find((r) => r.path === "/issueLink")!.body;
    assertEquals(body, { type: { name: "Blocks" }, inwardIssue: { key: "ABC-2" }, outwardIssue: { key: "ABC-1" } });
  }));

Deno.test("getMyself returns the authenticated user", () =>
  withFake(async (_fake, mk) => {
    const me = await mk().getMyself();
    assertEquals(me.accountId, "me");
  }));

Deno.test("searchAll can expand the changelog", () =>
  withFake(async (fake, mk) => {
    fake.seed({ key: "ABC-1" });
    fake.setHistory("ABC-1", [{ at: "2026-09-02T10:00:00.000+0000", from: "Backlog", to: "In Development" }]);
    const [issue] = await mk().searchAll("project = ABC", ["status"], 50, "changelog");
    assertEquals(issue.changelog.histories[0].items[0].toString, "In Development");
  }));

Deno.test("remote links can be listed and added", () =>
  withFake(async (fake, mk) => {
    fake.seed({ key: "ABC-1" });
    const c = mk();
    assertEquals(await c.getRemoteLinks("ABC-1"), []);
    await c.addRemoteLink("ABC-1", { url: "https://example.com/doc", title: "Spec" });
    const links = await c.getRemoteLinks("ABC-1");
    assertEquals(links.map((l: { object: { url: string; title: string } }) => [l.object.url, l.object.title]), [["https://example.com/doc", "Spec"]]);
  }));

Deno.test("deleteLink removes an issue link", () =>
  withFake(async (fake, mk) => {
    fake.seed({ key: "ABC-1" });
    fake.seed({ key: "ABC-2" });
    const c = mk();
    await c.createLink("Blocks", { inwardKey: "ABC-2", outwardKey: "ABC-1" });
    const id = fake.issues.get("ABC-1").fields.issuelinks[0].id;
    await c.deleteLink(id);
    assertEquals(fake.issues.get("ABC-1").fields.issuelinks, []);
    assertEquals(fake.issues.get("ABC-2").fields.issuelinks, []);
  }));
