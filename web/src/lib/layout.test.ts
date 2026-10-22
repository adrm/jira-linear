import { describe, expect, it } from "vitest";
import { buildGroups, DEFAULT_DISPLAY, displayFor, type Display } from "./layout";
import { mkIssue } from "../test/fakeServer";

const now = new Date("2026-10-15T12:00:00.000Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const ana = { id: "u1", name: "Ana" };
const raul = { id: "u2", name: "Raul" };

const epic = mkIssue("ABC-90", { issuetype: "Epic", summary: "[PERMANENT] Ops" });
const epic2 = mkIssue("ABC-91", { issuetype: "Epic", summary: "Billing" });
const issues = [
  mkIssue("ABC-1", { status: "In Development", statusCategory: "indeterminate", assignee: ana, priority: "Crítica", parentKey: "ABC-90", labels: ["a", "b"], issuetype: "Bug", updated: ago(1), created: ago(30), duedate: "2026-10-20" }),
  mkIssue("ABC-2", { status: "Backlog", statusCategory: "new", assignee: raul, priority: "Importante", parentKey: "ABC-91", labels: ["a"], issuetype: "Spike", updated: ago(3), created: ago(20), duedate: null }),
  mkIssue("ABC-3", { status: "Code Review", statusCategory: "indeterminate", assignee: null, priority: null, parentKey: null, labels: [], issuetype: "Tarea", updated: ago(2), created: ago(10), duedate: "2026-10-18" }),
  mkIssue("ABC-4", { status: "Cerrada", statusCategory: "done", assignee: ana, priority: "Poco importante", labels: ["b"], updated: ago(3), created: ago(40) }),
  mkIssue("ABC-5", { status: "Cerrada", statusCategory: "done", assignee: ana, priority: "Importante", updated: ago(60), created: ago(90) }),
  mkIssue("ABC-6", { status: "In Development", statusCategory: "indeterminate", parentKey: "ABC-1", issuetype: "Subtarea", updated: ago(1), created: ago(5) }),
];
const all = [...issues, epic, epic2];
const d = (over: Partial<Display> = {}): Display => ({ ...DEFAULT_DISPLAY, completed: "all", ...over });
const g = (display: Display, list = issues) => buildGroups(list, display, { all, now });
const keys = (groups: ReturnType<typeof g>) => groups.map((x) => [x.label, x.issues.map((i) => i.key)]);

describe("grouping", () => {
  it("by status runs from closest to done to farthest, with the usual order inside", () => {
    expect(g(d({ showSubIssues: true })).map((x) => x.label)).toEqual(["Code Review", "In Development", "Backlog", "Cerrada"]);
  });
  it("by assignee puts people alphabetically and No assignee last", () => {
    expect(g(d({ groupBy: "assignee" })).map((x) => x.label)).toEqual(["Ana", "Raul", "No assignee"]);
    expect(g(d({ groupBy: "assignee" }))[0].value).toBe("u1");
    expect(g(d({ groupBy: "assignee" })).at(-1)!.value).toBeNull();
  });
  it("by project uses the project names and No project last", () => {
    const groups = g(d({ groupBy: "project" }));
    expect(groups.map((x) => x.label)).toEqual(["Billing", "Ops", "No project"]);
    expect(groups[1].value).toBe("ABC-90");
  });
  it("by priority runs highest first with No priority last", () => {
    expect(g(d({ groupBy: "priority" })).map((x) => x.label)).toEqual(["Crítica", "Importante", "Poco importante", "No priority"]);
  });
  it("by label lists a ticket under every label it has", () => {
    const groups = g(d({ groupBy: "label" }));
    expect(keys(groups).slice(0, 2)).toEqual([["a", ["ABC-1", "ABC-2"]], ["b", ["ABC-1", "ABC-4"]]]);
    expect(groups.at(-1)!.label).toBe("No label");
  });
  it("by type is Bug, Spike, Task", () => {
    expect(g(d({ groupBy: "type" })).map((x) => x.label)).toEqual(["Bug", "Spike", "Task"]);
  });
  it("with no grouping everything is one list", () => {
    const groups = g(d({ groupBy: "none" }));
    expect(groups).toHaveLength(1);
    expect(groups[0].issues).toHaveLength(5); // sub-issues hidden by default
  });
  it("groups remember what a new issue made inside them should start with", () => {
    expect(g(d({ groupBy: "status" }))[0]).toMatchObject({ kind: "status", status: "Code Review" });
    expect(g(d({ groupBy: "assignee" }))[1]).toMatchObject({ kind: "assignee", value: "u2" });
  });
});

describe("ordering inside groups", () => {
  const one = (orderBy: Display["orderBy"], reverse = false) => g(d({ groupBy: "none", orderBy, reverse, showSubIssues: true }))[0].issues.map((i) => i.key);
  it("updated: newest first", () => expect(one("updated").slice(0, 3)).toEqual(["ABC-1", "ABC-6", "ABC-3"]));
  it("created: newest first", () => expect(one("created").slice(0, 3)).toEqual(["ABC-6", "ABC-3", "ABC-2"]));
  it("priority: highest first, none last", () => {
    const o = one("priority");
    expect(o[0]).toBe("ABC-1");
    expect(o.indexOf("ABC-3")).toBeGreaterThan(o.indexOf("ABC-4"));
  });
  it("due date: soonest first, no date last", () => {
    expect(one("due").slice(0, 2)).toEqual(["ABC-3", "ABC-1"]);
    expect(one("due").at(-1)).not.toBe("ABC-3");
  });
  it("reverse flips it", () => expect(one("updated", true)[0]).toBe("ABC-5"));
});

describe("what is shown", () => {
  it("hides sub-issues unless asked, but not tickets that belong to a project", () => {
    const hidden = g(d({ groupBy: "none" }))[0].issues.map((i) => i.key);
    expect(hidden).not.toContain("ABC-6"); // sub-issue of ABC-1
    expect(hidden).toContain("ABC-1"); // belongs to a project, not a parent ticket
    expect(g(d({ groupBy: "none", showSubIssues: true }))[0].issues.map((i) => i.key)).toContain("ABC-6");
  });
  it("limits completed work to a window", () => {
    const done = (completed: Display["completed"]) => g(d({ groupBy: "none", completed }))[0].issues.filter((i) => i.statusCategory === "done").map((i) => i.key);
    expect(done("none")).toEqual([]);
    expect(done("week")).toEqual(["ABC-4"]);
    expect(done("month")).toEqual(["ABC-4"]);
    expect(done("all").sort()).toEqual(["ABC-4", "ABC-5"]);
  });
  it("can show empty groups", () => {
    const labels = g(d({ groupBy: "status", showEmptyGroups: true })).map((x) => x.label);
    expect(labels).toContain("In Testing (QA)");
    expect(g(d({ groupBy: "status" })).map((x) => x.label)).not.toContain("In Testing (QA)");
  });
});

describe("defaults per view", () => {
  it("all issues keeps a month of completed work; project pages keep all of it", () => {
    expect(displayFor("all").completed).toBe("month");
    expect(displayFor("project:ABC-1").completed).toBe("all");
    expect(displayFor("created").completed).toBe("month");
    expect(displayFor("active")).toMatchObject({ layout: "list", groupBy: "status", orderBy: "updated", showSubIssues: false });
  });
});
