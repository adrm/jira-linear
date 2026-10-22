import { describe, expect, it } from "vitest";
import { dropChanges } from "./drop";
import type { IssueGroup } from "./layout";
import { mkIssue } from "../test/fakeServer";

const group = (over: Partial<IssueGroup>): IssueGroup => ({ id: "x", label: "x", kind: "status", value: null, issues: [], ...over });
const a = mkIssue("ABC-1", { status: "Backlog", assignee: { id: "u1", name: "Ana" }, priority: "Importante", parentKey: "ABC-9", labels: ["x"], issuetype: "Tarea" });
const b = mkIssue("ABC-2", { status: "In Development", assignee: null, priority: null, parentKey: null, labels: [], issuetype: "Error" });
const all = [a, b, mkIssue("ABC-3", { issuetype: "Tarea" }), mkIssue("ABC-4", { issuetype: "Error" }), mkIssue("ABC-5", { issuetype: "Spike" })];

describe("dropChanges", () => {
  it("dropping on a status column sets that status, skipping tickets already there", () => {
    expect(dropChanges(group({ kind: "status", status: "In Development", value: "In Development" }), [a, b], all)).toEqual([
      { op: "setStatus", key: "ABC-1", status: "In Development" },
    ]);
  });
  it("dropping on an assignee column assigns them, and 'No assignee' unassigns", () => {
    expect(dropChanges(group({ kind: "assignee", value: "u2" }), [a, b], all)).toEqual([
      { op: "setAssignee", key: "ABC-1", accountId: "u2" },
      { op: "setAssignee", key: "ABC-2", accountId: "u2" },
    ]);
    expect(dropChanges(group({ kind: "assignee", value: null }), [a, b], all)).toEqual([{ op: "setAssignee", key: "ABC-1", accountId: null }]);
  });
  it("dropping on a project column moves tickets into it, 'No project' removes them", () => {
    expect(dropChanges(group({ kind: "project", value: "ABC-10" }), [a, b], all)).toEqual([
      { op: "setParent", key: "ABC-1", parentKey: "ABC-10" },
      { op: "setParent", key: "ABC-2", parentKey: "ABC-10" },
    ]);
    expect(dropChanges(group({ kind: "project", value: null }), [a, b], all)).toEqual([{ op: "setParent", key: "ABC-1", parentKey: null }]);
  });
  it("dropping on a priority column sets it; there is no way to clear a priority", () => {
    expect(dropChanges(group({ kind: "priority", value: "Crítica" }), [a, b], all)).toHaveLength(2);
    expect(dropChanges(group({ kind: "priority", value: null }), [a, b], all)).toEqual([]);
  });
  it("dropping on a type column switches to the Jira name used for it", () => {
    expect(dropChanges(group({ kind: "type", value: "Bug" }), [a, b], all)).toEqual([{ op: "setType", key: "ABC-1", issuetype: "Error" }]);
  });
  it("dropping on a label column adds the label to tickets that lack it", () => {
    expect(dropChanges(group({ kind: "label", value: "x" }), [a, b], all)).toEqual([{ op: "setLabels", key: "ABC-2", labels: ["x"] }]);
    expect(dropChanges(group({ kind: "label", value: null }), [a, b], all)).toEqual([]);
  });
  it("an ungrouped list has nowhere to drop", () => {
    expect(dropChanges(group({ kind: "none" }), [a, b], all)).toEqual([]);
  });
});
