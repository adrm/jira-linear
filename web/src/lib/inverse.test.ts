import { describe, expect, it } from "vitest";
import { describeMutation, inverseOf } from "./inverse";
import { mkIssue } from "../test/fakeServer";

const before = mkIssue("ABC-1", {
  summary: "Old", status: "Backlog", priority: "Importante", assignee: { id: "u1", name: "Ana" },
  labels: ["a"], duedate: "2026-11-01", parentKey: "ABC-9", parentSummary: "[PERMANENT] Ops",
});
const ctx = { users: { u1: "Ana", u2: "Raul" }, issues: { "ABC-1": before, "ABC-9": mkIssue("ABC-9", { summary: "[PERMANENT] Ops", issuetype: "Epic" }) } };

describe("inverseOf", () => {
  it("restores the previous value for every reversible field", () => {
    expect(inverseOf({ op: "setStatus", key: "ABC-1", status: "Done" }, before)).toEqual({ op: "setStatus", key: "ABC-1", status: "Backlog" });
    expect(inverseOf({ op: "setAssignee", key: "ABC-1", accountId: "u2" }, before)).toEqual({ op: "setAssignee", key: "ABC-1", accountId: "u1" });
    expect(inverseOf({ op: "setPriority", key: "ABC-1", priority: "Crítica" }, before)).toEqual({ op: "setPriority", key: "ABC-1", priority: "Importante" });
    expect(inverseOf({ op: "setLabels", key: "ABC-1", labels: [] }, before)).toEqual({ op: "setLabels", key: "ABC-1", labels: ["a"] });
    expect(inverseOf({ op: "setType", key: "ABC-1", issuetype: "Error" }, before)).toEqual({ op: "setType", key: "ABC-1", issuetype: "Task" });
    expect(inverseOf({ op: "setSummary", key: "ABC-1", summary: "New" }, before)).toEqual({ op: "setSummary", key: "ABC-1", summary: "Old" });
    expect(inverseOf({ op: "setDueDate", key: "ABC-1", date: null }, before)).toEqual({ op: "setDueDate", key: "ABC-1", date: "2026-11-01" });
    expect(inverseOf({ op: "setParent", key: "ABC-1", parentKey: null }, before)).toEqual({ op: "setParent", key: "ABC-1", parentKey: "ABC-9" });
  });
  it("un-assigning inverts to the previous assignee, and assigning inverts to unassigned", () => {
    const none = mkIssue("ABC-2", { assignee: null });
    expect(inverseOf({ op: "setAssignee", key: "ABC-2", accountId: "u2" }, none)).toEqual({ op: "setAssignee", key: "ABC-2", accountId: null });
  });
  it("cannot invert what Jira cannot clear or what creates new things", () => {
    expect(inverseOf({ op: "setPriority", key: "ABC-3", priority: "High" }, mkIssue("ABC-3", { priority: null }))).toBeNull();
    expect(inverseOf({ op: "addComment", key: "ABC-1", markdown: "x" }, before)).toBeNull();
    expect(inverseOf({ op: "createIssue", summary: "x", issuetype: "Task" }, undefined)).toBeNull();
    expect(inverseOf({ op: "link", type: "Blocks", inwardKey: "ABC-1", outwardKey: "ABC-2" }, before)).toBeNull();
    expect(inverseOf({ op: "setDescription", key: "ABC-1", markdown: "x" }, before)).toBeNull();
    expect(inverseOf({ op: "addLink", key: "ABC-1", url: "https://x.test", title: "Spec" }, before)).toBeNull();
  });
  it("is null when the issue is unknown", () => {
    expect(inverseOf({ op: "setStatus", key: "ABC-404", status: "Done" }, undefined)).toBeNull();
  });
});

describe("undoing a removed relation", () => {
  const link = (direction: "inward" | "outward") => ({ id: "L1", type: "Blocks", direction, phrase: "", key: "ABC-2", summary: "x" });
  it("re-creates it with the same direction", () => {
    const blocking = mkIssue("ABC-1", { links: [link("outward")] }); // ABC-1 blocks ABC-2
    expect(inverseOf({ op: "unlink", key: "ABC-1", linkId: "L1", otherKey: "ABC-2" }, blocking)).toEqual({ op: "link", type: "Blocks", outwardKey: "ABC-1", inwardKey: "ABC-2" });
    const blocked = mkIssue("ABC-1", { links: [link("inward")] }); // ABC-2 blocks ABC-1
    expect(inverseOf({ op: "unlink", key: "ABC-1", linkId: "L1", otherKey: "ABC-2" }, blocked)).toEqual({ op: "link", type: "Blocks", outwardKey: "ABC-2", inwardKey: "ABC-1" });
  });
  it("cannot be undone when the relation is unknown", () => {
    expect(inverseOf({ op: "unlink", key: "ABC-1", linkId: "nope", otherKey: "ABC-2" }, mkIssue("ABC-1"))).toBeNull();
  });
});

describe("describeMutation", () => {
  it.each([
    [{ op: "setStatus", key: "ABC-1", status: "Code Review" }, "Status set to Code Review"],
    [{ op: "setAssignee", key: "ABC-1", accountId: "u2" }, "Assigned to Raul"],
    [{ op: "setAssignee", key: "ABC-1", accountId: null }, "Unassigned"],
    [{ op: "setPriority", key: "ABC-1", priority: "Crítica" }, "Priority set to Crítica"],
    [{ op: "setLabels", key: "ABC-1", labels: ["x"] }, "Labels updated"],
    [{ op: "setType", key: "ABC-1", issuetype: "Error" }, "Type set to Bug"],
    [{ op: "setType", key: "ABC-1", issuetype: "Spike" }, "Type set to Spike"],
    [{ op: "setType", key: "ABC-1", issuetype: "Tarea" }, "Type set to Task"],
    [{ op: "setSummary", key: "ABC-1", summary: "x" }, "Renamed"],
    [{ op: "setDueDate", key: "ABC-1", date: "2026-12-01" }, "Due date set to 2026-12-01"],
    [{ op: "setDueDate", key: "ABC-1", date: null }, "Due date cleared"],
    [{ op: "setParent", key: "ABC-1", parentKey: "ABC-9" }, "Moved to Ops"],
    [{ op: "setParent", key: "ABC-1", parentKey: null }, "Removed from project"],
    [{ op: "addComment", key: "ABC-1", markdown: "x" }, "Comment added"],
    [{ op: "createIssue", summary: "Fresh", issuetype: "Task" }, "Created “Fresh”"],
    [{ op: "addLink", key: "ABC-1", url: "https://x.test", title: "Spec" }, "Link added"],
    [{ op: "unlink", key: "ABC-1", linkId: "L1", otherKey: "ABC-2" }, "Relation removed"],
    [{ op: "link", type: "Blocks", outwardKey: "ABC-1", inwardKey: "ABC-2" }, "Relation added"],
  ] as const)("%j -> %s", (m, text) => {
    expect(describeMutation(m as never, ctx)).toBe(text);
  });
});
