import { describe, expect, it } from "vitest";
import type { ActivityEntry, Comment } from "@shared/types";
import { describeActivity, timeline } from "./activity";
import { mkIssue } from "../test/fakeServer";

const e = (field: string, from: string | null, to: string | null, at = "2026-09-02T10:00:00.000+0000"): ActivityEntry => ({ id: `${field}${at}`, at, author: { id: "u1", name: "Ana" }, field, from, to });

describe("describeActivity", () => {
  it.each([
    [e("status", "Backlog", "In Development"), "changed status from Backlog to In Development"],
    [e("status", null, "Backlog"), "set status to Backlog"],
    [e("assignee", null, "Raul"), "assigned this to Raul"],
    [e("assignee", "Raul", null), "unassigned Raul"],
    [e("assignee", "Raul", "Bea"), "changed assignee from Raul to Bea"],
    [e("priority", "Importante", "Crítica"), "changed priority from Importante to Crítica"],
    [e("summary", "Old title", "New title"), "renamed this from “Old title” to “New title”"],
    [e("labels", "a b", "a b c"), "added label c"],
    [e("labels", "a b c", "a"), "removed labels b and c"],
    [e("labels", "a", "b"), "added label b and removed label a"],
    [e("type", "Tarea", "Error"), "changed type from Task to Bug"],
    [e("duedate", null, "2026-12-01"), "set the due date to 2026-12-01"],
    [e("duedate", "2026-12-01", null), "cleared the due date"],
    [e("duedate", "2026-12-01", "2027-01-01"), "changed the due date from 2026-12-01 to 2027-01-01"],
    [e("parent", null, "[PERMANENT] Ops"), "added this to project Ops"],
    [e("parent", "Ops", null), "removed this from project Ops"],
    [e("parent", "Ops", "Billing"), "moved this from project Ops to Billing"],
  ])("%j -> %s", (entry, text) => expect(describeActivity(entry)).toBe(text));
});

describe("timeline", () => {
  const issue = mkIssue("ABC-1", { created: "2026-09-01T10:00:00.000+0000", reporter: { id: "u9", name: "Raul" } });
  const comment = (id: string, at: string): Comment => ({ id, issueKey: "ABC-1", author: { id: "u2", name: "Bea" }, bodyAdf: null, created: at, updated: at });
  it("merges creation, changes and comments in time order", () => {
    const items = timeline(issue, [comment("c1", "2026-09-04T10:00:00.000+0000")], [e("status", "A", "B", "2026-09-02T10:00:00.000+0000"), e("status", "B", "C", "2026-09-06T10:00:00.000+0000")]);
    expect(items.map((i) => i.kind)).toEqual(["created", "event", "comment", "event"]);
  });
  it("says who created it", () => {
    const [first] = timeline(issue, [], []);
    expect(first).toMatchObject({ kind: "created", who: "Raul", at: "2026-09-01T10:00:00.000+0000" });
  });
  it("copes with a ticket nobody has touched", () => {
    expect(timeline(issue, [], [])).toHaveLength(1);
  });
  it("copes with a missing reporter", () => {
    expect(timeline(mkIssue("ABC-2", { reporter: null }), [], [])[0]).toMatchObject({ who: "Someone" });
  });
});
