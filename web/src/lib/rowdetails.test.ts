import { describe, expect, it } from "vitest";
import { dueState, labelHue, startedFractions, subIssueStats } from "./rowdetails";
import { priorityLevel } from "./vocab";
import { mkIssue } from "../test/fakeServer";

describe("priorityLevel", () => {
  it("maps English and Spanish names to Linear's five levels", () => {
    expect(priorityLevel("Crítica")).toBe("urgent");
    expect(priorityLevel("Highest")).toBe("urgent");
    expect(priorityLevel("High")).toBe("high");
    expect(priorityLevel("Importante")).toBe("medium");
    expect(priorityLevel("Medium (migrated)")).toBe("medium");
    expect(priorityLevel("Poco importante")).toBe("low");
    expect(priorityLevel("Lowest")).toBe("low");
    expect(priorityLevel(null)).toBe("none");
  });
});

describe("startedFractions", () => {
  const issues = [
    mkIssue("ABC-1", { status: "In Development", statusCategory: "indeterminate" }),
    mkIssue("ABC-2", { status: "Code Review", statusCategory: "indeterminate" }),
    mkIssue("ABC-3", { status: "In Testing (QA)", statusCategory: "indeterminate" }),
    mkIssue("ABC-4", { status: "Backlog", statusCategory: "new" }),
    mkIssue("ABC-5", { status: "Cerrada", statusCategory: "done" }),
  ];
  it("fills a started status in proportion to how far along the workflow it is", () => {
    const f = startedFractions(issues);
    expect(f["In Development"]).toBeCloseTo(1 / 4);
    expect(f["Code Review"]).toBeCloseTo(2 / 4);
    expect(f["In Testing (QA)"]).toBeCloseTo(3 / 4);
  });
  it("only covers started statuses", () => {
    const f = startedFractions(issues);
    expect(f["Backlog"]).toBeUndefined();
    expect(f["Cerrada"]).toBeUndefined();
  });
  it("projects (epics) are measured against the statuses epics use, not tickets", () => {
    const withEpics = [
      ...issues,
      mkIssue("ABC-10", { issuetype: "Epic", status: "Shippable", statusCategory: "indeterminate" }),
      mkIssue("ABC-11", { issuetype: "Epic", status: "In Development", statusCategory: "indeterminate" }),
    ];
    expect(startedFractions(withEpics, true)["Shippable"]).toBeGreaterThan(0.5);
    expect(startedFractions(withEpics, true)["Code Review"]).toBeUndefined();
    expect(startedFractions(withEpics)["Shippable"]).toBeUndefined();
  });
  it("a single started status is half full", () => {
    expect(startedFractions([mkIssue("ABC-1", { status: "In Development", statusCategory: "indeterminate" })])["In Development"]).toBe(0.5);
  });
});

describe("subIssueStats", () => {
  it("counts done and total sub-issues per parent, ignoring epics' children", () => {
    const issues = [
      mkIssue("ABC-1"), mkIssue("ABC-9", { issuetype: "Epic" }),
      mkIssue("ABC-2", { parentKey: "ABC-1", statusCategory: "done" }),
      mkIssue("ABC-3", { parentKey: "ABC-1", statusCategory: "new" }),
      mkIssue("ABC-4", { parentKey: "ABC-1", statusCategory: "indeterminate" }),
      mkIssue("ABC-5", { parentKey: "ABC-9", statusCategory: "done" }), // belongs to a project, not a parent ticket
    ];
    const s = subIssueStats(issues);
    expect(s["ABC-1"]).toEqual({ done: 1, total: 3 });
    expect(s["ABC-9"]).toBeUndefined();
  });
});

describe("dueState", () => {
  const now = new Date("2026-10-15T12:00:00.000Z");
  it("formats the date and flags overdue work", () => {
    expect(dueState("2026-10-20", false, now)).toEqual({ text: "Oct 20", overdue: false, soon: false });
    expect(dueState("2026-10-10", false, now)).toEqual({ text: "Oct 10", overdue: true, soon: false });
  });
  it("flags dates in the next three days as soon", () => {
    expect(dueState("2026-10-17", false, now)!.soon).toBe(true);
    expect(dueState("2026-10-15", false, now)!.soon).toBe(true);
  });
  it("done work is never overdue, and a missing date is null", () => {
    expect(dueState("2026-10-10", true, now)!.overdue).toBe(false);
    expect(dueState(null, false, now)).toBeNull();
  });
  it("shows the year when it is not this year", () => {
    expect(dueState("2027-01-05", false, now)!.text).toBe("Jan 5, 2027");
  });
});

describe("labelHue", () => {
  it("is stable for a name and spreads different names around the colour wheel", () => {
    expect(labelHue("CA:frontend")).toBe(labelHue("CA:frontend"));
    const hues = new Set(["CA:frontend", "CA:backend", "CA:design", "FeatureReporting", "PubAdmin", "AR-SOS"].map(labelHue));
    expect(hues.size).toBeGreaterThanOrEqual(5);
    for (const h of hues) expect(h).toBeGreaterThanOrEqual(0), expect(h).toBeLessThan(360);
  });
});
