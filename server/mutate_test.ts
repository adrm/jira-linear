import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { openStore } from "./db.ts";
import { createJiraClient } from "./jira.ts";
import { applyMutation, MutationError } from "./mutate.ts";
import { syncOnce } from "./sync.ts";
import { FAKE_FIELDS, FakeJira } from "./testing/fake_jira.ts";

async function setup(fn: (c: { fake: FakeJira; store: ReturnType<typeof openStore>; deps: Parameters<typeof applyMutation>[0] }) => Promise<void>) {
  const fake = new FakeJira().start();
  const store = openStore(":memory:");
  const client = createJiraClient({ baseUrl: fake.baseUrl, email: "test@example.com", apiToken: "test-token", sleep: () => Promise.resolve() });
  try {
    await fn({ fake, store, deps: { client, store, project: "ABC", fields: FAKE_FIELDS } });
  } finally {
    store.close();
    await fake.stop();
  }
}
const writes = (fake: FakeJira) => fake.requests.filter((r) => r.method !== "GET" && r.path !== "/search/jql");

Deno.test("setStatus transitions by target status name and updates the mirror", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1", status: "Backlog" });
    const r = await applyMutation(deps, { id: "m1", op: "setStatus", key: "ABC-1", status: "In Development" });
    assertEquals(fake.issues.get("ABC-1").fields.status.name, "In Development");
    assertEquals(store.delta(0).issues[0].status, "In Development");
    assertEquals(r.key, "ABC-1");
    assertEquals(r.syncId, store.currentSyncId());
  }));

Deno.test("setStatus to an unreachable status raises MutationError(400) and writes nothing", () =>
  setup(async ({ fake, deps }) => {
    fake.seed({ key: "ABC-1", status: "Backlog" });
    const err = await assertRejects(
      () => applyMutation(deps, { id: "m1", op: "setStatus", key: "ABC-1", status: "Nonexistent" }),
      MutationError,
    );
    assertEquals(err.status, 400);
    assertEquals(writes(fake).length, 0);
  }));

Deno.test("setAssignee / setPriority / setLabels / setSummary / setDueDate write through", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1" });
    await applyMutation(deps, { id: "a", op: "setAssignee", key: "ABC-1", accountId: "u9" });
    await applyMutation(deps, { id: "b", op: "setPriority", key: "ABC-1", priority: "High" });
    await applyMutation(deps, { id: "c", op: "setLabels", key: "ABC-1", labels: ["CA:frontend"] });
    await applyMutation(deps, { id: "d", op: "setSummary", key: "ABC-1", summary: "Renamed" });
    await applyMutation(deps, { id: "e", op: "setDueDate", key: "ABC-1", date: "2026-11-01" });
    const i = store.delta(0).issues[0];
    assertEquals(i.assignee?.id, "u9");
    assertEquals(i.priority, "High");
    assertEquals(i.labels, ["CA:frontend"]);
    assertEquals(i.summary, "Renamed");
    assertEquals(i.duedate, "2026-11-01");
  }));

Deno.test("unassign and clear due date send nulls", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1", assignee: { accountId: "u1", displayName: "U" }, duedate: "2026-11-01" });
    await syncOnce({ ...deps, pageSize: 50 });
    await applyMutation(deps, { id: "a", op: "setAssignee", key: "ABC-1", accountId: null });
    await applyMutation(deps, { id: "b", op: "setDueDate", key: "ABC-1", date: null });
    const i = store.delta(0).issues[0];
    assertEquals(i.assignee, null);
    assertEquals(i.duedate, null);
  }));

Deno.test("setDescription converts markdown to ADF", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1" });
    await applyMutation(deps, { id: "a", op: "setDescription", key: "ABC-1", markdown: "**bold** text" });
    const adf = fake.issues.get("ABC-1").fields.description;
    assertEquals(adf.type, "doc");
    assertEquals(adf.content[0].content[0].marks[0].type, "strong");
    assertEquals(store.delta(0).issues[0].descriptionAdf, adf);
  }));

Deno.test("setParent sets and clears the epic", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1", issuetype: "Epic", summary: "Epic one" });
    fake.seed({ key: "ABC-2" });
    await applyMutation(deps, { id: "a", op: "setParent", key: "ABC-2", parentKey: "ABC-1" });
    const set = store.delta(0).issues.find((i) => i.key === "ABC-2")!;
    assertEquals([set.parentKey, set.parentSummary], ["ABC-1", "Epic one"]);
    await applyMutation(deps, { id: "b", op: "setParent", key: "ABC-2", parentKey: null });
    const cleared = store.delta(0).issues.find((i) => i.key === "ABC-2")!;
    assertEquals(cleared.parentKey, null);
  }));

Deno.test("addComment posts ADF and mirrors the comment", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1" });
    await applyMutation(deps, { id: "a", op: "addComment", key: "ABC-1", markdown: "hello there" });
    assertEquals(fake.comments.get("ABC-1")!.length, 1);
    assertEquals(store.delta(0).comments.length, 1);
  }));

Deno.test("createIssue creates in the configured project and mirrors it", () =>
  setup(async ({ fake, store, deps }) => {
    const r = await applyMutation(deps, {
      id: "a",
      op: "createIssue",
      summary: "New one",
      issuetype: "Task",
      markdown: "details",
      labels: ["CA:backend"],
      duedate: "2026-11-05",
    });
    assert(r.key.startsWith("ABC-"));
    const raw = fake.issues.get(r.key);
    assertEquals(raw.fields.summary, "New one");
    assertEquals(raw.fields.labels, ["CA:backend"]);
    const body = fake.requests.find((x) => x.method === "POST" && x.path === "/issue")!.body as { fields: { project: { key: string } } };
    assertEquals(body.fields.project.key, "ABC");
    assertEquals(store.delta(0).issues[0].key, r.key);
  }));

Deno.test("createIssue without a summary is rejected before calling Jira", () =>
  setup(async ({ fake, deps }) => {
    const err = await assertRejects(
      () => applyMutation(deps, { id: "a", op: "createIssue", summary: "  ", issuetype: "Task" }),
      MutationError,
    );
    assertEquals(err.status, 400);
    assertEquals(fake.requests.length, 0);
  }));

Deno.test("link creates the link and verifies its direction", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1" });
    fake.seed({ key: "ABC-2" });
    // ABC-1 blocks ABC-2
    await applyMutation(deps, { id: "a", op: "link", type: "Blocks", outwardKey: "ABC-1", inwardKey: "ABC-2" });
    const one = store.delta(0).issues.find((i) => i.key === "ABC-1")!;
    assertEquals(one.links.map((l) => [l.direction, l.key]), [["outward", "ABC-2"]]);
  }));

Deno.test("a backwards link is detected and reported", () =>
  setup(async ({ fake, deps }) => {
    fake.seed({ key: "ABC-1" });
    fake.seed({ key: "ABC-2" });
    fake.reverseLinks = true;
    const err = await assertRejects(
      () => applyMutation(deps, { id: "a", op: "link", type: "Blocks", outwardKey: "ABC-1", inwardKey: "ABC-2" }),
      MutationError,
    );
    assert(/direction/i.test(err.message));
  }));

Deno.test("replaying a mutation id does not call Jira again", () =>
  setup(async ({ fake, deps }) => {
    const m = { id: "same", op: "createIssue", summary: "Once", issuetype: "Task" } as const;
    const first = await applyMutation(deps, m);
    const second = await applyMutation(deps, m);
    assertEquals(second.key, first.key);
    assertEquals(fake.requests.filter((r) => r.method === "POST" && r.path === "/issue").length, 1);
  }));

Deno.test("a failed mutation is not recorded and can be retried", () =>
  setup(async ({ fake, deps }) => {
    fake.seed({ key: "ABC-1" });
    fake.failures.push({ status: 500 });
    await assertRejects(() => applyMutation(deps, { id: "r", op: "setSummary", key: "ABC-1", summary: "X" }), MutationError);
    await applyMutation(deps, { id: "r", op: "setSummary", key: "ABC-1", summary: "X" });
    assertEquals(fake.issues.get("ABC-1").fields.summary, "X");
  }));

Deno.test("Jira errors surface as MutationError carrying Jira's status", () =>
  setup(async ({ fake, deps }) => {
    const err = await assertRejects(
      () => applyMutation(deps, { id: "x", op: "setSummary", key: "ABC-404", summary: "X" }),
      MutationError,
    );
    assertEquals(err.status, 404);
    assertEquals(fake.requests.length >= 1, true);
  }));

Deno.test("mutations on keys outside the configured project are refused", () =>
  setup(async ({ fake, deps }) => {
    const err = await assertRejects(
      () => applyMutation(deps, { id: "x", op: "setSummary", key: "OTH-1", summary: "X" }),
      MutationError,
    );
    assertEquals(err.status, 400);
    assertEquals(fake.requests.length, 0);
  }));

Deno.test("setType changes the Jira issue type by name and mirrors it", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1", issuetype: "Tarea" });
    await applyMutation(deps, { id: "t1", op: "setType", key: "ABC-1", issuetype: "Error" });
    assertEquals(fake.issues.get("ABC-1").fields.issuetype.name, "Error");
    assertEquals(store.delta(0).issues[0].issuetype, "Error");
  }));

Deno.test("setType with an empty type is rejected before calling Jira", () =>
  setup(async ({ fake, deps }) => {
    fake.seed({ key: "ABC-1" });
    const err = await assertRejects(() => applyMutation(deps, { id: "t2", op: "setType", key: "ABC-1", issuetype: " " }), MutationError);
    assertEquals(err.status, 400);
    assertEquals(writes(fake).length, 0);
  }));

Deno.test("Jira refusing a type change surfaces as a MutationError with Jira's status", () =>
  setup(async ({ fake, deps }) => {
    fake.seed({ key: "ABC-1" });
    fake.failures.push({ status: 400, body: { errors: { issuetype: "The issue type selected is invalid." } } });
    const err = await assertRejects(() => applyMutation(deps, { id: "t3", op: "setType", key: "ABC-1", issuetype: "Spike" }), MutationError);
    assertEquals(err.status, 400);
    assertEquals(err.message.includes("issuetype"), true);
  }));

Deno.test("createIssue can set the assignee", () =>
  setup(async ({ fake, store, deps }) => {
    const r = await applyMutation(deps, { id: "c1", op: "createIssue", summary: "Assigned", issuetype: "Task", assigneeId: "u7" });
    assertEquals(fake.issues.get(r.key).fields.assignee.accountId, "u7");
    assertEquals(store.delta(0).issues[0].assignee?.id, "u7");
  }));

Deno.test("createIssue can start in another status by transitioning after creation", () =>
  setup(async ({ fake, store, deps }) => {
    const r = await applyMutation(deps, { id: "c2", op: "createIssue", summary: "Moves on", issuetype: "Task", status: "In Development" });
    assertEquals(fake.issues.get(r.key).fields.status.name, "In Development");
    assertEquals(store.delta(0).issues[0].status, "In Development");
    assertEquals(r.warning, undefined);
  }));

Deno.test("if the starting status cannot be applied the issue is still created and a warning is returned", () =>
  setup(async ({ fake, store, deps }) => {
    const r = await applyMutation(deps, { id: "c3", op: "createIssue", summary: "Stuck", issuetype: "Task", status: "No such status" });
    assert(fake.issues.has(r.key));
    assertEquals(store.delta(0).issues[0].status, "Backlog");
    assert(r.warning && r.warning.includes("No such status"));
    // replaying the same mutation must not create a second issue
    const again = await applyMutation(deps, { id: "c3", op: "createIssue", summary: "Stuck", issuetype: "Task", status: "No such status" });
    assertEquals(again.key, r.key);
    assertEquals([...fake.issues.keys()].length, 1);
  }));

Deno.test("unlink removes a relation from both tickets and mirrors that", () =>
  setup(async ({ fake, store, deps }) => {
    fake.seed({ key: "ABC-1" });
    fake.seed({ key: "ABC-2" });
    await applyMutation(deps, { id: "u0", op: "link", type: "Blocks", outwardKey: "ABC-1", inwardKey: "ABC-2" });
    const linkId = store.delta(0).issues.find((i) => i.key === "ABC-1")!.links[0].id;
    await applyMutation(deps, { id: "u1", op: "unlink", key: "ABC-1", linkId, otherKey: "ABC-2" });
    const d = store.delta(0).issues;
    assertEquals([d.find((i) => i.key === "ABC-1")!.links, d.find((i) => i.key === "ABC-2")!.links], [[], []]);
  }));

Deno.test("unlink only touches tickets in the project", () =>
  setup(async ({ fake, deps }) => {
    fake.seed({ key: "ABC-1" });
    const err = await assertRejects(() => applyMutation(deps, { id: "u2", op: "unlink", key: "ABC-1", linkId: "1", otherKey: "OTH-9" }), MutationError);
    assertEquals(err.status, 400);
    assertEquals(writes(fake).length, 0);
  }));

Deno.test("setDescription with an empty text clears the description", () =>
  setup(async ({ fake, deps }) => {
    fake.seed({ key: "ABC-1", description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] } });
    await applyMutation(deps, { id: "d1", op: "setDescription", key: "ABC-1", markdown: "  \n" });
    assertEquals(fake.issues.get("ABC-1").fields.description, null);
  }));
