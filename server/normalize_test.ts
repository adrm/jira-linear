import { assertEquals } from "jsr:@std/assert@1";
import { normalizeComment, normalizeIssue as normalize } from "./normalize.ts";
import { FAKE_FIELDS } from "./testing/fake_jira.ts";
const normalizeIssue = (raw: Parameters<typeof normalize>[0]) => normalize(raw, FAKE_FIELDS);
import { adfText, FakeJira } from "./testing/fake_jira.ts";

Deno.test("normalizeIssue flattens a Jira issue into the wire shape", () => {
  const fake = new FakeJira();
  const epic = fake.seed({ key: "ABC-1", summary: "Epic", issuetype: "Epic" });
  void epic;
  const raw = fake.seed({
    key: "ABC-2",
    summary: "Do the thing",
    status: "In Development",
    priority: "High",
    assignee: { accountId: "a1", displayName: "Ana" },
    reporter: { accountId: "r1", displayName: "Raul" },
    labels: ["CA:frontend"],
    parent: "ABC-1",
    duedate: "2026-10-20",
    description: adfText("hello"),
  });
  const issue = normalizeIssue(raw);
  assertEquals(issue, {
    key: "ABC-2",
    id: raw.id,
    project: "ABC",
    summary: "Do the thing",
    descriptionAdf: adfText("hello"),
    status: "In Development",
    statusCategory: "indeterminate",
    issuetype: "Task",
    priority: "High",
    assignee: { id: "a1", name: "Ana" },
    reporter: { id: "r1", name: "Raul" },
    parentKey: "ABC-1",
    parentSummary: "Epic",
    labels: ["CA:frontend"],
    duedate: "2026-10-20",
    created: raw.fields.created,
    updated: raw.fields.updated,
    links: [],
    quarter: null,
    initialEstimate: null,
    revisedEstimate: null,
    statusChanged: null,
    storyPoints: null,
    resolution: null,
  });
});

Deno.test("normalizeIssue reads the Quarter, initial and revised estimate and last status change", () => {
  const fake = new FakeJira();
  const raw = fake.seed({ key: "ABC-5", quarter: ["FY2027 Q3"], initial: "2026-11-30", revised: "2027-01-15", statusChanged: "2026-10-01T10:00:00.000+0000" });
  const i = normalizeIssue(raw);
  assertEquals([i.quarter, i.initialEstimate, i.revisedEstimate, i.statusChanged], ["FY2027 Q3", "2026-11-30", "2027-01-15", "2026-10-01T10:00:00.000+0000"]);
});

Deno.test("several quarters are joined, and missing planning fields are null", () => {
  const fake = new FakeJira();
  assertEquals(normalizeIssue(fake.seed({ key: "ABC-6", quarter: ["FY2027 Q2", "FY2027 Q3"] })).quarter, "FY2027 Q2, FY2027 Q3");
  const none = normalizeIssue(fake.seed({ key: "ABC-7" }));
  assertEquals([none.quarter, none.initialEstimate, none.revisedEstimate, none.statusChanged], [null, null, null, null]);
});

Deno.test("normalizeIssue handles missing optional fields", () => {
  const fake = new FakeJira();
  const raw = fake.seed({ key: "ABC-3", priority: "" });
  const issue = normalizeIssue(raw);
  assertEquals(issue.priority, null);
  assertEquals(issue.assignee, null);
  assertEquals(issue.parentKey, null);
  assertEquals(issue.descriptionAdf, null);
  assertEquals(issue.duedate, null);
});

Deno.test("normalizeIssue maps issuelinks with direction and phrase", () => {
  const raw = {
    id: "1",
    key: "ABC-10",
    fields: {
      summary: "s",
      status: { name: "Backlog", statusCategory: { key: "new" } },
      issuetype: { name: "Task" },
      labels: [],
      created: "c",
      updated: "u",
      issuelinks: [
        { id: "l1", type: { name: "Blocks", inward: "is blocked by", outward: "blocks" }, outwardIssue: { key: "ABC-11", fields: { summary: "other" } } },
        { id: "l2", type: { name: "Blocks", inward: "is blocked by", outward: "blocks" }, inwardIssue: { key: "ABC-12", fields: { summary: "third" } } },
      ],
    },
  };
  assertEquals(normalizeIssue(raw).links, [
    { id: "l1", type: "Blocks", direction: "outward", phrase: "blocks", key: "ABC-11", summary: "other" },
    { id: "l2", type: "Blocks", direction: "inward", phrase: "is blocked by", key: "ABC-12", summary: "third" },
  ]);
});

Deno.test("normalizeComment maps author and body", () => {
  const c = normalizeComment("ABC-2", {
    id: "9",
    author: { accountId: "a1", displayName: "Ana" },
    body: adfText("hi"),
    created: "c",
    updated: "u",
  });
  assertEquals(c, { id: "9", issueKey: "ABC-2", author: { id: "a1", name: "Ana" }, bodyAdf: adfText("hi"), created: "c", updated: "u" });
});

Deno.test("story points and resolution are read from the ticket", () => {
  const fake = new FakeJira();
  const i = normalizeIssue(fake.seed({ key: "ABC-7", points: 5, resolution: "Won't Do" }));
  assertEquals([i.storyPoints, i.resolution], [5, "Won't Do"]);
  const none = normalizeIssue(fake.seed({ key: "ABC-8" }));
  assertEquals([none.storyPoints, none.resolution], [null, null]);
});
