import { describe, expect, it } from "vitest";
import { applyFilters, describeFilter, filterOptions, toggleValue, type Filter } from "./filters";
import { mkIssue } from "../test/fakeServer";

const ana = { id: "u1", name: "Ana" };
const raul = { id: "u2", name: "Raul" };
const issues = [
  mkIssue("ABC-1", { status: "In Development", assignee: ana, priority: "Crítica", labels: ["a"], parentKey: "ABC-90", issuetype: "Error" }),
  mkIssue("ABC-2", { status: "Backlog", assignee: raul, priority: "Importante", labels: ["a", "b"], parentKey: "ABC-91", issuetype: "Spike" }),
  mkIssue("ABC-3", { status: "Backlog", assignee: null, priority: null, labels: [], parentKey: null, issuetype: "Tarea" }),
];
const all = [...issues, mkIssue("ABC-90", { issuetype: "Epic", summary: "Ops" }), mkIssue("ABC-91", { issuetype: "Epic", summary: "Billing" })];
const f = (field: Filter["field"], values: string[], not = false): Filter => ({ field, values, not });
const keys = (fs: Filter[]) => applyFilters(issues, fs).map((i) => i.key);

describe("applyFilters", () => {
  it("no filters keeps everything; a filter with no values is ignored", () => {
    expect(keys([])).toEqual(["ABC-1", "ABC-2", "ABC-3"]);
    expect(keys([f("status", [])])).toEqual(["ABC-1", "ABC-2", "ABC-3"]);
  });
  it("matches any of the chosen values", () => {
    expect(keys([f("status", ["Backlog"])])).toEqual(["ABC-2", "ABC-3"]);
    expect(keys([f("status", ["Backlog", "In Development"])])).toEqual(["ABC-1", "ABC-2", "ABC-3"]);
  });
  it("assignee can be a person or nobody", () => {
    expect(keys([f("assignee", ["u1"])])).toEqual(["ABC-1"]);
    expect(keys([f("assignee", [""])])).toEqual(["ABC-3"]);
    expect(keys([f("assignee", ["u2", ""])])).toEqual(["ABC-2", "ABC-3"]);
  });
  it("priority can be a level or none", () => {
    expect(keys([f("priority", ["Crítica"])])).toEqual(["ABC-1"]);
    expect(keys([f("priority", [""])])).toEqual(["ABC-3"]);
  });
  it("labels match tickets that have any of them", () => {
    expect(keys([f("label", ["b"])])).toEqual(["ABC-2"]);
    expect(keys([f("label", ["a"])])).toEqual(["ABC-1", "ABC-2"]);
  });
  it("project can be a project or none; type is Bug, Spike or Task", () => {
    expect(keys([f("project", ["ABC-91"])])).toEqual(["ABC-2"]);
    expect(keys([f("project", [""])])).toEqual(["ABC-3"]);
    expect(keys([f("type", ["Bug"])])).toEqual(["ABC-1"]);
    expect(keys([f("type", ["Task"])])).toEqual(["ABC-3"]);
  });
  it("is not inverts a filter", () => {
    expect(keys([f("status", ["Backlog"], true)])).toEqual(["ABC-1"]);
    expect(keys([f("assignee", [""], true)])).toEqual(["ABC-1", "ABC-2"]);
  });
  it("filters combine with AND", () => {
    expect(keys([f("status", ["Backlog"]), f("assignee", ["u2"])])).toEqual(["ABC-2"]);
    expect(keys([f("status", ["Backlog"]), f("assignee", ["u1"])])).toEqual([]);
  });
});

describe("describeFilter", () => {
  const ctx = { all };
  it("words the operator by how many values there are", () => {
    expect(describeFilter(f("status", ["Backlog"]), ctx)).toEqual({ field: "Status", op: "is", value: "Backlog" });
    expect(describeFilter(f("status", ["Backlog", "Code Review"]), ctx)).toEqual({ field: "Status", op: "is either of", value: "Backlog, Code Review" });
    expect(describeFilter(f("status", ["Backlog"], true), ctx).op).toBe("is not");
    expect(describeFilter(f("status", ["Backlog", "Code Review"], true), ctx).op).toBe("is neither of");
  });
  it("shows names rather than ids, and wording for 'none'", () => {
    expect(describeFilter(f("assignee", ["u1", ""]), ctx).value).toBe("Ana, No assignee");
    expect(describeFilter(f("project", ["ABC-90", ""]), ctx).value).toBe("Ops, No project");
    expect(describeFilter(f("priority", [""]), ctx).value).toBe("No priority");
    expect(describeFilter(f("label", ["a"]), ctx).field).toBe("Label");
  });
});

describe("filterOptions", () => {
  it("lists what can be chosen with how many tickets each matches", () => {
    const opts = filterOptions("assignee", issues, all);
    expect(opts).toEqual([
      { value: "", label: "No assignee", count: 1 },
      { value: "u1", label: "Ana", count: 1 },
      { value: "u2", label: "Raul", count: 1 },
    ]);
  });
  it("status options follow the workflow and count tickets", () => {
    const opts = filterOptions("status", issues, all);
    expect(opts.find((o) => o.value === "Backlog")).toMatchObject({ count: 2 });
    expect(opts.find((o) => o.value === "In Development")).toMatchObject({ count: 1 });
  });
  it("type options are the three groups", () => {
    expect(filterOptions("type", issues, all).map((o) => [o.value, o.count])).toEqual([["Bug", 1], ["Spike", 1], ["Task", 1]]);
  });
  it("project options list the projects and No project", () => {
    expect(filterOptions("project", issues, all).map((o) => o.label)).toEqual(["No project", "Billing", "Ops"]);
  });
});

describe("toggleValue", () => {
  it("adds a value to a filter, removes it again, and drops the filter when it becomes empty", () => {
    let fs: Filter[] = [];
    fs = toggleValue(fs, "status", "Backlog");
    fs = toggleValue(fs, "status", "Code Review");
    expect(fs).toEqual([{ field: "status", not: false, values: ["Backlog", "Code Review"] }]);
    fs = toggleValue(fs, "status", "Backlog");
    expect(fs[0].values).toEqual(["Code Review"]);
    fs = toggleValue(fs, "status", "Code Review");
    expect(fs).toEqual([]);
  });
});
