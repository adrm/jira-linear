import { afterEach, describe, expect, it } from "vitest";
import { configureVocab, jiraTypeFor, priorityOptions, priorityRank, statusOptions, subtaskType, typeClass, typeOptions } from "./vocab";
import type { Issue } from "@shared/types";
import { mkIssue } from "../test/fakeServer";

describe("ticket type groups", () => {
  it("maps every Jira type to Bug, Spike or Task", () => {
    for (const n of ["Bug", "Error"]) expect(typeClass(n)).toBe("Bug");
    expect(typeClass("Spike")).toBe("Spike");
    for (const n of ["Tarea", "Historia", "Mejora", "Nueva función", "Subtarea", "Task", "Story", "Sub-task", "Anything else"]) expect(typeClass(n)).toBe("Task");
  });
  it("offers the three groups, each with the Jira type name used for it in this data", () => {
    const issues = [
      mkIssue("ABC-1", { issuetype: "Tarea" }), mkIssue("ABC-2", { issuetype: "Tarea" }), mkIssue("ABC-3", { issuetype: "Historia" }),
      mkIssue("ABC-4", { issuetype: "Error" }), mkIssue("ABC-5", { issuetype: "Spike" }),
      mkIssue("ABC-6", { issuetype: "Epic" }), mkIssue("ABC-7", { issuetype: "Subtarea" }),
    ];
    expect(typeOptions(issues)).toEqual([
      { group: "Bug", jiraName: "Error" },
      { group: "Spike", jiraName: "Spike" },
      { group: "Task", jiraName: "Tarea" },
    ]);
  });
  it("uses the most common name when a group has several Jira types", () => {
    const issues = [mkIssue("ABC-1", { issuetype: "Bug" }), mkIssue("ABC-2", { issuetype: "Error" }), mkIssue("ABC-3", { issuetype: "Error" })];
    expect(typeOptions(issues).find((o) => o.group === "Bug")!.jiraName).toBe("Error");
  });
  it("falls back to the plain English names with no data", () => {
    expect(typeOptions([])).toEqual([
      { group: "Bug", jiraName: "Bug" }, { group: "Spike", jiraName: "Spike" }, { group: "Task", jiraName: "Task" },
    ]);
  });
  it("jiraTypeFor translates a group back to the Jira name", () => {
    const issues = [mkIssue("ABC-1", { issuetype: "Tarea" }), mkIssue("ABC-2", { issuetype: "Error" })];
    expect(jiraTypeFor("Bug", issues)).toBe("Error");
    expect(jiraTypeFor("Task", issues)).toBe("Tarea");
    expect(jiraTypeFor("Spike", issues)).toBe("Spike");
  });
});

describe("priorities", () => {
  it("ranks English and Spanish names", () => {
    expect(priorityRank("Crítica")).toBeGreaterThan(priorityRank("Importante"));
    expect(priorityRank("Importante")).toBeGreaterThan(priorityRank("Poco importante"));
    expect(priorityRank("Highest")).toBe(priorityRank("Crítica"));
    expect(priorityRank("Something custom")).toBe(priorityRank("Medium"));
    expect(priorityRank(null)).toBe(-1);
  });
  it("offers the priorities used in the data, highest first, ties by usage", () => {
    const issues = [
      ...[1, 2, 3].map((n) => mkIssue(`ABC-${n}`, { priority: "Importante" })),
      mkIssue("ABC-4", { priority: "Crítica" }), mkIssue("ABC-5", { priority: "Poco importante" }),
      mkIssue("ABC-6", { priority: null }),
    ];
    expect(priorityOptions(issues)).toEqual(["Crítica", "Importante", "Poco importante"]);
  });
  it("falls back to the standard Jira names with no data", () => {
    expect(priorityOptions([])).toEqual(["Highest", "High", "Medium", "Low", "Lowest"]);
  });
});

describe("statusOptions", () => {
  const issues = [
    mkIssue("ABC-1", { status: "In Development", statusCategory: "indeterminate" }),
    mkIssue("ABC-2", { status: "Backlog", statusCategory: "new" }),
    mkIssue("ABC-3", { status: "Cerrada", statusCategory: "done" }),
    mkIssue("ABC-9", { issuetype: "Epic", status: "Lanzado", statusCategory: "done" }),
    mkIssue("ABC-10", { issuetype: "Epic", status: "Research & Discovery", statusCategory: "new" }),
    mkIssue("ABC-11", { issuetype: "Epic", status: "Shippable", statusCategory: "indeterminate" }),
  ];
  it("for tickets: the ticket workflow, plus any other statuses seen on tickets", () => {
    const names = statusOptions(issues, false).map((s) => s.name);
    expect(names).toContain("Code Review"); // known workflow status not yet used
    expect(names).toContain("In Development");
    expect(names).not.toContain("Lanzado");
    expect(names).not.toContain("Research & Discovery");
  });
  it("for projects: only the statuses epics actually use", () => {
    const opts = statusOptions(issues, true);
    expect(opts.map((s) => s.name).sort()).toEqual(["Lanzado", "Research & Discovery", "Shippable"]);
    expect(opts.find((s) => s.name === "Lanzado")!.category).toBe("done");
  });
  it("orders active, then not started, then done", () => {
    expect(statusOptions(issues, true).map((s) => s.name)).toEqual(["Shippable", "Research & Discovery", "Lanzado"]);
  });
  it("a project picker with no epics in the data falls back to the ticket statuses", () => {
    expect(statusOptions(issues.slice(0, 3), true).map((s) => s.name)).toContain("In Development");
  });
});

describe("subtaskType", () => {
  it("uses the sub-task name found in the data (Jira localises it)", () => {
    expect(subtaskType([mkIssue("ABC-1", { issuetype: "Tarea" }), mkIssue("ABC-2", { issuetype: "Subtarea" })])).toBe("Subtarea");
    expect(subtaskType([mkIssue("ABC-1", { issuetype: "Sub-task" })])).toBe("Sub-task");
  });
  it("falls back to Sub-task", () => {
    expect(subtaskType([])).toBe("Sub-task");
  });
});

describe("configureVocab", () => {
  afterEach(() => configureVocab());

  it("replaces the type and priority names for a site", () => {
    configureVocab({ bugTypes: ["Defect"], spikeTypes: ["Research"], priorities: { Blocker: 4, Minor: 1 }, subtaskTypes: ["Child"] });
    expect(typeClass("defect")).toBe("Bug");
    expect(typeClass("Bug")).toBe("Task");
    expect(typeClass("RESEARCH")).toBe("Spike");
    expect(priorityRank("Blocker")).toBe(4);
    expect(priorityRank("High")).toBe(2);
    expect(subtaskType([{ issuetype: "Child" } as Issue])).toBe("Child");
  });

  it("keeps the defaults for anything not given", () => {
    configureVocab({ bugTypes: ["Defect"] });
    expect(typeClass("Spike")).toBe("Spike");
    expect(priorityRank("Highest")).toBe(4);
  });
});
