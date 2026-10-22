import { describe, expect, it } from "vitest";
import type { Issue, Mutation, MutationInput } from "@shared/types";
import { applyLocal, type IssueMap } from "./optimistic";

const base = (key: string, over: Partial<Issue> = {}): Issue => ({
  key, id: "1", project: "ABC", summary: "S", descriptionAdf: null, status: "Backlog", statusCategory: "new",
  issuetype: "Task", priority: "Medium", assignee: null, reporter: null, parentKey: null, parentSummary: null,
  labels: [], duedate: null, created: "2026-10-01T00:00:00.000+0000", updated: "2026-10-01T00:00:00.000+0000", links: [],
  quarter: null, initialEstimate: null, revisedEstimate: null, statusChanged: null, storyPoints: null, resolution: null, ...over,
});
const world = (): IssueMap => ({ "ABC-1": base("ABC-1"), "ABC-2": base("ABC-2", { issuetype: "Epic", summary: "Epic two" }) });
const ctx = { statuses: { "In Development": "indeterminate", Cerrada: "done" } as Record<string, string>, users: { u1: "Ana" } as Record<string, string> };
const m = (b: MutationInput): Mutation => ({ id: "m", ...b } as Mutation);

describe("applyLocal", () => {
  it("does not mutate its input", () => {
    const w = world();
    applyLocal(w, m({ op: "setSummary", key: "ABC-1", summary: "X" }), ctx);
    expect(w["ABC-1"].summary).toBe("S");
  });
  it("setStatus updates name and category", () => {
    const r = applyLocal(world(), m({ op: "setStatus", key: "ABC-1", status: "Cerrada" }), ctx);
    expect([r["ABC-1"].status, r["ABC-1"].statusCategory]).toEqual(["Cerrada", "done"]);
  });
  it("setAssignee resolves the display name and clears with null", () => {
    const a = applyLocal(world(), m({ op: "setAssignee", key: "ABC-1", accountId: "u1" }), ctx);
    expect(a["ABC-1"].assignee).toEqual({ id: "u1", name: "Ana" });
    const b = applyLocal(a, m({ op: "setAssignee", key: "ABC-1", accountId: null }), ctx);
    expect(b["ABC-1"].assignee).toBeNull();
  });
  it("simple field ops", () => {
    let w = world();
    w = applyLocal(w, m({ op: "setPriority", key: "ABC-1", priority: "High" }), ctx);
    w = applyLocal(w, m({ op: "setLabels", key: "ABC-1", labels: ["a", "b"] }), ctx);
    w = applyLocal(w, m({ op: "setDueDate", key: "ABC-1", date: "2026-11-01" }), ctx);
    w = applyLocal(w, m({ op: "setSummary", key: "ABC-1", summary: "New" }), ctx);
    expect(w["ABC-1"]).toMatchObject({ priority: "High", labels: ["a", "b"], duedate: "2026-11-01", summary: "New" });
  });
  it("setType changes the issue type", () => {
    const r = applyLocal(world(), m({ op: "setType", key: "ABC-1", issuetype: "Spike" }), ctx);
    expect(r["ABC-1"].issuetype).toBe("Spike");
  });
  it("setDescription shows the new description straight away", () => {
    const r = applyLocal(world(), m({ op: "setDescription", key: "ABC-1", markdown: "**Hi** there" }), ctx);
    expect(r["ABC-1"].descriptionAdf).toMatchObject({ type: "doc", content: [{ type: "paragraph" }] });
  });
  it("setParent uses the parent summary from the world, and clears", () => {
    const a = applyLocal(world(), m({ op: "setParent", key: "ABC-1", parentKey: "ABC-2" }), ctx);
    expect([a["ABC-1"].parentKey, a["ABC-1"].parentSummary]).toEqual(["ABC-2", "Epic two"]);
    const b = applyLocal(a, m({ op: "setParent", key: "ABC-1", parentKey: null }), ctx);
    expect(b["ABC-1"].parentKey).toBeNull();
  });
  it("createIssue adds a temporary issue keyed by the mutation id", () => {
    const r = applyLocal(world(), { id: "abc", op: "createIssue", summary: "Fresh", issuetype: "Task", labels: ["x"] }, ctx);
    const t = r["NEW-abc"];
    expect(t).toMatchObject({ summary: "Fresh", issuetype: "Task", labels: ["x"], status: "New Idea", project: "ABC" });
  });
  it("createIssue shows the status, assignee, priority and labels it was created with", () => {
    const r = applyLocal(world(), { id: "n1", op: "createIssue", summary: "Fresh", issuetype: "Bug", status: "In Development", assigneeId: "u1", priority: "High", labels: ["a"], parentKey: "ABC-2", duedate: "2026-12-01" }, ctx);
    expect(r["NEW-n1"]).toMatchObject({
      status: "In Development", statusCategory: "indeterminate", assignee: { id: "u1", name: "Ana" }, priority: "High",
      labels: ["a"], parentKey: "ABC-2", parentSummary: "Epic two", duedate: "2026-12-01", issuetype: "Bug",
    });
  });
  it("link adds a link to both issues with the right directions", () => {
    const r = applyLocal(world(), m({ op: "link", type: "Blocks", outwardKey: "ABC-1", inwardKey: "ABC-2" }), ctx);
    expect(r["ABC-1"].links[0]).toMatchObject({ direction: "outward", key: "ABC-2", type: "Blocks" });
    expect(r["ABC-2"].links[0]).toMatchObject({ direction: "inward", key: "ABC-1", type: "Blocks" });
  });
  it("unlink removes the relation from both tickets", () => {
    const linked = applyLocal(world(), m({ op: "link", type: "Blocks", outwardKey: "ABC-1", inwardKey: "ABC-2" }), ctx);
    const id = linked["ABC-1"].links[0].id;
    const r = applyLocal(linked, m({ op: "unlink", key: "ABC-1", linkId: id, otherKey: "ABC-2" }), ctx);
    expect([r["ABC-1"].links, r["ABC-2"].links]).toEqual([[], []]);
  });
  it("ops on unknown keys and addComment leave issues unchanged", () => {
    const w = world();
    expect(applyLocal(w, m({ op: "setSummary", key: "ABC-99", summary: "x" }), ctx)).toEqual(w);
    expect(applyLocal(w, m({ op: "addComment", key: "ABC-1", markdown: "hi" }), ctx)).toEqual(w);
  });
});
