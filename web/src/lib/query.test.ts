import { describe, expect, it } from "vitest";
import { filterIssues, groupByStatus, searchIssues, flatOrder } from "./query";
import { mkIssue } from "../test/fakeServer";

const issues = [
  mkIssue("ABC-3843", { summary: "Fix revenue chart", status: "In Development", statusCategory: "indeterminate", assignee: { id: "u1", name: "Ana" }, labels: ["CA:frontend"], updated: "2026-10-14T10:00:00.000+0000" }),
  mkIssue("ABC-12", { summary: "Vendor access for Spotify", status: "Backlog", statusCategory: "new", parentKey: "ABC-2836", updated: "2026-10-10T10:00:00.000+0000" }),
  mkIssue("ABC-7", { summary: "Old thing", status: "Cerrada", statusCategory: "done", updated: "2026-09-01T10:00:00.000+0000" }),
  mkIssue("ABC-20", { summary: "Review the chart export", status: "Code Review", statusCategory: "indeterminate", assignee: { id: "u2", name: "Raul" }, updated: "2026-10-15T08:00:00.000+0000" }),
];

describe("searchIssues", () => {
  it("matches every token against key and summary, case-insensitively", () => {
    expect(searchIssues(issues, "chart").map((i) => i.key).sort()).toEqual(["ABC-20", "ABC-3843"]);
    expect(searchIssues(issues, "chart export").map((i) => i.key)).toEqual(["ABC-20"]);
    expect(searchIssues(issues, "SPOTIFY vendor").map((i) => i.key)).toEqual(["ABC-12"]);
  });
  it("finds by key and by bare number", () => {
    expect(searchIssues(issues, "abc-3843").map((i) => i.key)).toEqual(["ABC-3843"]);
    expect(searchIssues(issues, "3843").map((i) => i.key)).toEqual(["ABC-3843"]);
  });
  it("returns everything for an empty query", () => {
    expect(searchIssues(issues, "  ")).toHaveLength(4);
  });
  it("ranks exact key matches first", () => {
    expect(searchIssues(issues, "12")[0].key).toBe("ABC-12");
  });
});

describe("filterIssues", () => {
  it("open hides done issues", () => {
    expect(filterIssues(issues, { open: true }).map((i) => i.key)).not.toContain("ABC-7");
  });
  it("by assignee, unassigned, label and epic", () => {
    expect(filterIssues(issues, { assignee: "u1" }).map((i) => i.key)).toEqual(["ABC-3843"]);
    expect(filterIssues(issues, { assignee: null }).map((i) => i.key).sort()).toEqual(["ABC-12", "ABC-7"]);
    expect(filterIssues(issues, { label: "CA:frontend" }).map((i) => i.key)).toEqual(["ABC-3843"]);
    expect(filterIssues(issues, { parentKey: "ABC-2836" }).map((i) => i.key)).toEqual(["ABC-12"]);
  });
  it("combines filters with AND", () => {
    expect(filterIssues(issues, { open: true, assignee: "u2" }).map((i) => i.key)).toEqual(["ABC-20"]);
  });
});

describe("groupByStatus", () => {
  it("orders groups from closest to done to farthest: started work first, then to-do, then backlog, then done", () => {
    const g = groupByStatus(issues);
    expect(g.map((x) => x.status)).toEqual(["Code Review", "In Development", "Backlog", "Cerrada"]);
    expect(g[0].issues.map((i) => i.key)).toEqual(["ABC-20"]);
  });
  it("sorts issues inside a group by updated, newest first", () => {
    const two = [mkIssue("ABC-1", { updated: "2026-10-01T00:00:00.000+0000" }), mkIssue("ABC-2", { updated: "2026-10-05T00:00:00.000+0000" })];
    expect(groupByStatus(two)[0].issues.map((i) => i.key)).toEqual(["ABC-2", "ABC-1"]);
  });
  it("flatOrder lists issues in the order they are displayed", () => {
    expect(flatOrder(groupByStatus(issues)).map((i) => i.key)).toEqual(["ABC-20", "ABC-3843", "ABC-12", "ABC-7"]);
  });
  it("puts unknown statuses ahead of the backlog but after nothing known: they are treated as most advanced", () => {
    const g = groupByStatus([mkIssue("ABC-1", { status: "Zeta", statusCategory: "new" }), mkIssue("ABC-2", { status: "Backlog", statusCategory: "new" })]);
    expect(g.map((x) => x.status)).toEqual(["Zeta", "Backlog"]);
  });
});

import { applyView } from "./query";

describe("applyView", () => {
  const now = new Date("2026-10-15T12:00:00.000Z");
  const ctx = { meId: "u1", now };
  const world = [
    ...issues,
    mkIssue("ABC-40", { summary: "Ready one", status: "Ready for Dev", statusCategory: "new", updated: "2026-10-12T10:00:00.000+0000" }),
  ];
  it("active is unfinished work that is not in the backlog", () => {
    expect(applyView(world, "active", ctx).map((i) => i.key).sort()).toEqual(["ABC-20", "ABC-3843", "ABC-40"]);
  });
  it("backlog is unfinished work sitting in a backlog status", () => {
    expect(applyView(world, "backlog", ctx).map((i) => i.key)).toEqual(["ABC-12"]);
  });
  it("mine is open work assigned to me, backlog included", () => {
    const w = [...world, mkIssue("ABC-41", { status: "Backlog", statusCategory: "new", assignee: { id: "u1", name: "Ana" } })];
    expect(applyView(w, "mine", ctx).map((i) => i.key).sort()).toEqual(["ABC-3843", "ABC-41"]);
  });
  it("created is everything I reported, finished or not, but never epics", () => {
    const w = [
      mkIssue("ABC-60", { reporter: { id: "u1", name: "Ana" }, statusCategory: "done", status: "Cerrada" }),
      mkIssue("ABC-61", { reporter: { id: "u1", name: "Ana" }, status: "Backlog", statusCategory: "new" }),
      mkIssue("ABC-62", { reporter: { id: "u2", name: "Raul" } }),
      mkIssue("ABC-63", { reporter: { id: "u1", name: "Ana" }, issuetype: "Epic" }),
    ];
    expect(applyView(w, "created", ctx).map((i) => i.key).sort()).toEqual(["ABC-60", "ABC-61"]);
    expect(applyView(w, "created", { meId: null, now })).toEqual([]);
  });
  it("mine is empty when the current user is unknown", () => {
    expect(applyView(world, "mine", { meId: null, now })).toEqual([]);
  });
  it("all includes done work", () => {
    expect(applyView(world, "all", ctx)).toHaveLength(5);
  });
  it("project:<key> keeps that project's tickets, including done ones", () => {
    const withDone = [...issues, mkIssue("ABC-30", { parentKey: "ABC-2836", status: "Cerrada", statusCategory: "done" })];
    expect(applyView(withDone, "project:ABC-2836", ctx).map((i) => i.key).sort()).toEqual(["ABC-12", "ABC-30"]);
  });
  it("epics never appear as tickets in any view", () => {
    const withEpic = [...issues, mkIssue("ABC-50", { issuetype: "Epic", summary: "A project", statusCategory: "indeterminate", assignee: { id: "u1", name: "Ana" }, updated: "2026-10-15T08:00:00.000+0000" })];
    for (const v of ["active", "backlog", "mine", "all", "project:ABC-50"]) {
      expect(applyView(withEpic, v, ctx).map((i) => i.key)).not.toContain("ABC-50");
    }
  });
  it("the projects view has no tickets of its own", () => {
    expect(applyView(issues, "projects", ctx)).toEqual([]);
  });
});
