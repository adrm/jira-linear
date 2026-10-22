import { describe, expect, it } from "vitest";
import type { Issue, IssueLink } from "@shared/types";
import { buildProjectGroups, DEFAULT_PROJECTS_DISPLAY, groupProjects, isEpic, isPermanent, listProjects, projectRelationships, projectStats, stripPermanent, summarizeProjects, type ProjectsDisplay } from "./projects";
import { mkIssue } from "../test/fakeServer";

const now = new Date("2026-10-15T12:00:00.000Z");
const epic = (key: string, over: Partial<Issue> = {}) => mkIssue(key, { issuetype: "Epic", summary: `Epic ${key}`, ...over });
const child = (key: string, parent: string, cat: "new" | "indeterminate" | "done", over: Partial<Issue> = {}) =>
  mkIssue(key, { parentKey: parent, statusCategory: cat, status: cat === "done" ? "Cerrada" : cat === "new" ? "Backlog" : "In Development", ...over });
const link = (type: string, direction: "inward" | "outward", key: string): IssueLink => ({
  id: `${type}-${direction}-${key}`, type, direction, phrase: direction === "outward" ? "blocks" : "is blocked by", key, summary: key,
});

describe("isEpic / stripPermanent", () => {
  it("recognises epics by issue type", () => {
    expect(isEpic(epic("ABC-1"))).toBe(true);
    expect(isEpic(mkIssue("ABC-2"))).toBe(false);
  });
  it("strips the [PERMANENT] prefix for display", () => {
    expect(stripPermanent("[PERMANENT] Tech refactor")).toBe("Tech refactor");
    expect(stripPermanent("Multi-dimension filtering")).toBe("Multi-dimension filtering");
  });
});

describe("real-world [PERMANENT] spellings", () => {
  it("copes with a non-breaking space after the tag and with leading whitespace", () => {
    expect(stripPermanent("[PERMANENT]\u00a0Design polish after launch")).toBe("Design polish after launch");
    expect(stripPermanent(" [PERMANENT] Downstream updates")).toBe("Downstream updates");
    expect(isPermanent("[PERMANENT]\u00a0Design polish")).toBe(true);
    expect(isPermanent("  [permanent] x")).toBe(true);
    expect(isPermanent("Not [PERMANENT] at the start")).toBe(false);
  });
  it("groups such epics under Ongoing", () => {
    const e = epic("ABC-1", { summary: " [PERMANENT] Downstream updates", statusCategory: "new", status: "Abierta" });
    expect(groupProjects(listProjects([e], now)).map((g) => g.label)).toEqual(["Ongoing"]);
  });
});

describe("projectStats", () => {
  const all = [
    epic("ABC-1", { duedate: "2026-12-01", assignee: { id: "u1", name: "Ana" }, statusCategory: "indeterminate", status: "In Development" }),
    child("ABC-2", "ABC-1", "done"), child("ABC-3", "ABC-1", "done"), child("ABC-4", "ABC-1", "indeterminate"), child("ABC-5", "ABC-1", "new"),
    child("ABC-6", "ABC-99", "done"),
  ];
  it("counts children by category and computes percent complete", () => {
    const s = projectStats(all, all[0], now);
    expect(s).toMatchObject({ total: 4, done: 2, inProgress: 1, todo: 1, pct: 50, name: "Epic ABC-1", targetDate: "2026-12-01" });
    expect(s.lead).toEqual({ id: "u1", name: "Ana" });
  });
  it("an empty project is 0% with zero scope", () => {
    const s = projectStats([epic("ABC-7")], epic("ABC-7"), now);
    expect([s.total, s.pct]).toEqual([0, 0]);
  });
  it("is overdue when the target date has passed and work remains", () => {
    const late = epic("ABC-8", { duedate: "2026-10-01" });
    expect(projectStats([late, child("ABC-9", "ABC-8", "new")], late, now).overdue).toBe(true);
    expect(projectStats([late, child("ABC-9", "ABC-8", "done")], late, now).overdue).toBe(false);
  });
  it("never counts other epics as tickets of a project", () => {
    const e1 = epic("ABC-1"); const e2 = epic("ABC-2", { parentKey: "ABC-1" });
    expect(projectStats([e1, e2], e1, now).total).toBe(0);
  });
  it("flags [PERMANENT] epics as ongoing", () => {
    const p = epic("ABC-1", { summary: "[PERMANENT] Tech refactor" });
    const s = projectStats([p], p, now);
    expect([s.ongoing, s.name]).toEqual([true, "Tech refactor"]);
  });
});

describe("listProjects / groupProjects", () => {
  const all = [
    epic("ABC-1", { statusCategory: "indeterminate", status: "In Development", updated: "2026-10-10T00:00:00.000+0000" }),
    epic("ABC-2", { statusCategory: "new", status: "Backlog" }),
    epic("ABC-3", { statusCategory: "done", status: "Cerrada" }),
    epic("ABC-4", { summary: "[PERMANENT] Ops", statusCategory: "indeterminate", status: "In Development" }),
    epic("ABC-5", { statusCategory: "indeterminate", status: "In Development", updated: "2026-10-14T00:00:00.000+0000" }),
    mkIssue("ABC-10"),
  ];
  it("lists only epics", () => {
    expect(listProjects(all, now).map((p) => p.key).sort()).toEqual(["ABC-1", "ABC-2", "ABC-3", "ABC-4", "ABC-5"]);
  });
  it("groups into In progress, Backlog, Ongoing and Completed in that order, newest first", () => {
    const g = groupProjects(listProjects(all, now));
    expect(g.map((x) => x.label)).toEqual(["In progress", "Backlog", "Ongoing", "Completed"]);
    expect(g[0].projects.map((p) => p.key)).toEqual(["ABC-5", "ABC-1"]);
    expect(g[2].projects.map((p) => p.key)).toEqual(["ABC-4"]);
  });
  it("omits empty groups", () => {
    const g = groupProjects(listProjects([epic("ABC-1", { statusCategory: "new", status: "Research & Discovery" })], now));
    expect(g.map((x) => x.label)).toEqual(["Planned"]);
  });
});

describe("projectRelationships", () => {
  const all = [
    epic("ABC-1"), epic("ABC-2", { summary: "Platform" }), epic("ABC-3", { summary: "Billing" }),
    // ABC-10 (project 1) is blocked by ABC-20 (project 2) and blocks ABC-30 (project 3); ABC-11 relates to ABC-21 (project 2)
    child("ABC-10", "ABC-1", "new", { links: [link("Blocks", "inward", "ABC-20"), link("Blocks", "outward", "ABC-30")] }),
    child("ABC-11", "ABC-1", "new", { links: [{ ...link("Relates", "outward", "ABC-21"), phrase: "relates to" }] }),
    child("ABC-12", "ABC-1", "new", { links: [link("Blocks", "inward", "ABC-13")] }), // same project: ignored
    child("ABC-13", "ABC-1", "new"),
    child("ABC-20", "ABC-2", "new", { links: [link("Blocks", "outward", "ABC-10")] }),
    child("ABC-21", "ABC-2", "new"),
    child("ABC-30", "ABC-3", "new", { links: [link("Blocks", "inward", "ABC-10")] }),
    mkIssue("ABC-40", { links: [link("Blocks", "outward", "ABC-10")] }), // no project, blocks ABC-10
  ];
  it("derives project-level dependencies from ticket links that cross projects", () => {
    const r = projectRelationships(all, "ABC-1");
    const find = (kind: string, key: string | null) => r.derived.find((d) => d.kind === kind && d.projectKey === key);
    expect(find("blockedBy", "ABC-2")).toMatchObject({ name: "Platform", count: 1 });
    expect(find("blocks", "ABC-3")).toMatchObject({ name: "Billing", count: 1 });
    expect(find("relates", "ABC-2")).toMatchObject({ count: 1 });
  });
  it("ignores links that stay inside the project", () => {
    const r = projectRelationships(all, "ABC-1");
    expect(r.derived.some((d) => d.projectKey === "ABC-1")).toBe(false);
  });
  it("groups links to tickets without a project under No project", () => {
    const r = projectRelationships(all, "ABC-1");
    expect(r.derived.find((d) => d.projectKey === null)).toMatchObject({ kind: "blockedBy", name: "No project", count: 1 });
  });
  it("lists the ticket pairs behind each dependency", () => {
    const r = projectRelationships(all, "ABC-1");
    expect(r.derived.find((d) => d.kind === "blockedBy" && d.projectKey === "ABC-2")!.pairs).toEqual([{ from: "ABC-10", to: "ABC-20" }]);
  });
  it("includes the epic's own direct links to other projects", () => {
    const w = [epic("ABC-1", { links: [link("Blocks", "outward", "ABC-2")] }), epic("ABC-2", { summary: "Platform", links: [link("Blocks", "inward", "ABC-1")] })];
    const r = projectRelationships(w, "ABC-1");
    expect(r.direct).toEqual([{ kind: "blocks", key: "ABC-2", name: "Platform", phrase: "blocks" }]);
  });
  it("is empty for a project with no relationships", () => {
    expect(projectRelationships([epic("ABC-1")], "ABC-1")).toEqual({ direct: [], derived: [] });
  });
});

describe("project status groups follow Linear's categories", () => {
  it("separates Backlog from Planned, and Canceled from Completed", () => {
    const list = listProjects([
      epic("ABC-1", { status: "Ideas", statusCategory: "new" }),
      epic("ABC-2", { status: "Planned & Committed", statusCategory: "new" }),
      epic("ABC-3", { status: "Lanzado", statusCategory: "done" }),
      epic("ABC-4", { status: "No en progreso", statusCategory: "done" }),
    ], now);
    const g = groupProjects(list);
    expect(g.map((x) => [x.label, x.projects.map((p) => p.key)])).toEqual([["Planned", ["ABC-2"]], ["Backlog", ["ABC-1"]], ["Completed", ["ABC-3"]], ["Canceled", ["ABC-4"]]]);
  });
});

describe("buildProjectGroups (display options for the project list)", () => {
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  const list = listProjects([
    epic("ABC-1", { summary: "Zeta", assignee: { id: "u1", name: "Ana" }, statusCategory: "indeterminate", status: "In Development", updated: ago(1), duedate: "2026-12-01" }),
    epic("ABC-2", { summary: "Alpha", assignee: { id: "u2", name: "Raul" }, statusCategory: "indeterminate", status: "In Development", updated: ago(5), duedate: "2026-11-01" }),
    epic("ABC-3", { summary: "Mid", assignee: null, statusCategory: "new", status: "Backlog", updated: ago(3) }),
    epic("ABC-4", { summary: "Old done", statusCategory: "done", status: "Lanzado", updated: ago(90) }),
    epic("ABC-5", { summary: "New done", statusCategory: "done", status: "Lanzado", updated: ago(10) }),
    child("ABC-20", "ABC-2", "done"),
  ], now);
  const d = (over: Partial<ProjectsDisplay> = {}): ProjectsDisplay => ({ ...DEFAULT_PROJECTS_DISPLAY, completed: "all", ...over });
  const run = (display: ProjectsDisplay) => buildProjectGroups(list, display, now);
  const keys = (g: ReturnType<typeof run>) => g.map((x) => [x.label, x.projects.map((p) => p.key)]);

  it("by status is the default, with the usual groups", () => {
    expect(run(d()).map((g) => g.label)).toEqual(["In progress", "Backlog", "Completed"]);
  });
  it("by lead lists people alphabetically and No lead last", () => {
    expect(run(d({ groupBy: "lead" })).map((g) => g.label)).toEqual(["Ana", "Raul", "No lead"]);
  });
  it("with no grouping it is one list", () => {
    expect(run(d({ groupBy: "none" }))).toHaveLength(1);
  });
  it("orders by name, progress or target date inside a group", () => {
    const inProgress = (o: ProjectsDisplay["orderBy"]) => run(d({ orderBy: o }))[0].projects.map((p) => p.key);
    expect(inProgress("updated")).toEqual(["ABC-1", "ABC-2"]);
    expect(inProgress("name")).toEqual(["ABC-2", "ABC-1"]);
    expect(inProgress("progress")).toEqual(["ABC-2", "ABC-1"]); // ABC-2 has a finished ticket
    expect(inProgress("target")).toEqual(["ABC-2", "ABC-1"]);
  });
  it("reverse flips the order", () => {
    expect(run(d({ reverse: true }))[0].projects.map((p) => p.key)).toEqual(["ABC-2", "ABC-1"]);
  });
  it("limits completed and canceled projects to a window", () => {
    const labels = (c: ProjectsDisplay["completed"]) => keys(run(d({ completed: c }))).find(([l]) => l === "Completed");
    expect(labels("none")).toBeUndefined();
    expect(labels("month")).toEqual(["Completed", ["ABC-5"]]);
    expect(labels("all")).toEqual(["Completed", ["ABC-5", "ABC-4"]]);
  });
  it("defaults to showing the last month of completed work", () => {
    expect(DEFAULT_PROJECTS_DISPLAY.completed).toBe("month");
  });
});

describe("planning fields: quarter, initial and revised estimate", () => {
  const e = (over: Partial<Issue>) => epic("ABC-1", { statusCategory: "indeterminate", status: "In Development", ...over });
  it("carries the quarter and both estimates", () => {
    const s = projectStats([], e({ quarter: "FY2027 Q3", initialEstimate: "2026-11-30", revisedEstimate: "2027-01-15" }), now);
    expect([s.quarter, s.initialEstimate, s.revisedEstimate]).toEqual(["FY2027 Q3", "2026-11-30", "2027-01-15"]);
  });
  it("the target date is the revised date, else the initial estimate, else Jira's due date", () => {
    expect(projectStats([], e({ initialEstimate: "2026-11-30", revisedEstimate: "2027-01-15", duedate: "2026-12-01" }), now)).toMatchObject({ targetDate: "2027-01-15", targetSource: "revised" });
    expect(projectStats([], e({ initialEstimate: "2026-11-30", duedate: "2026-12-01" }), now)).toMatchObject({ targetDate: "2026-11-30", targetSource: "initial" });
    expect(projectStats([], e({ duedate: "2026-12-01" }), now)).toMatchObject({ targetDate: "2026-12-01", targetSource: "due" });
    expect(projectStats([], e({}), now)).toMatchObject({ targetDate: null, targetSource: null });
  });
  it("reports how far the date has slipped when the revised date is later", () => {
    expect(projectStats([], e({ initialEstimate: "2026-11-30", revisedEstimate: "2026-12-14" }), now).slipDays).toBe(14);
    expect(projectStats([], e({ initialEstimate: "2026-11-30", revisedEstimate: "2026-11-20" }), now).slipDays).toBeNull(); // pulled in, not slipped
    expect(projectStats([], e({ initialEstimate: "2026-11-30" }), now).slipDays).toBeNull();
  });
  it("overdue is judged against the effective target", () => {
    expect(projectStats([], e({ initialEstimate: "2026-10-01", revisedEstimate: "2026-12-01" }), now).overdue).toBe(false); // revised, so not late
    expect(projectStats([], e({ initialEstimate: "2026-10-01" }), now).overdue).toBe(true);
  });
});

describe("grouping projects by quarter", () => {
  const list = listProjects([
    epic("ABC-1", { quarter: "FY2027 Q3", statusCategory: "indeterminate", status: "In Development" }),
    epic("ABC-2", { quarter: "FY2027 Q2", statusCategory: "indeterminate", status: "In Development" }),
    epic("ABC-3", { quarter: null, statusCategory: "new", status: "Backlog" }),
    epic("ABC-4", { quarter: "FY2027 Q2, FY2027 Q3", statusCategory: "indeterminate", status: "In Development" }),
  ], now);
  it("lists quarters in order, a project under each of its quarters, and No quarter last", () => {
    const g = buildProjectGroups(list, { ...DEFAULT_PROJECTS_DISPLAY, groupBy: "quarter", completed: "all" }, now);
    expect(g.map((x) => [x.label, x.projects.map((p) => p.key).sort()])).toEqual([
      ["FY2027 Q2", ["ABC-2", "ABC-4"]], ["FY2027 Q3", ["ABC-1", "ABC-4"]], ["No quarter", ["ABC-3"]],
    ]);
  });
});

describe("story points in project progress", () => {
  const epic = mkIssue("ABC-1", { issuetype: "Epic", summary: "P" });
  const kid = (key: string, over: Partial<Issue>) => mkIssue(key, { parentKey: "ABC-1", ...over });
  const now = new Date("2026-10-15T12:00:00Z");

  it("weights progress by story points, counting unestimated tickets as 3", () => {
    const all = [epic, kid("ABC-2", { statusCategory: "done", status: "Cerrada", storyPoints: 8 }), kid("ABC-3", {})];
    const p = projectStats(all, epic, now);
    expect([p.totalPoints, p.donePoints, p.pct]).toEqual([11, 8, 73]);
    expect([p.total, p.done]).toEqual([2, 1]);
  });
  it("uses the default you configure for unestimated tickets", () => {
    const all = [epic, kid("ABC-2", { statusCategory: "done", status: "Cerrada", storyPoints: 8 }), kid("ABC-3", {})];
    const p = projectStats(all, epic, now, { defaultPoints: 8 });
    expect([p.totalPoints, p.pct]).toEqual([16, 50]);
  });
  it("counts started work in points too", () => {
    const all = [epic, kid("ABC-2", { statusCategory: "indeterminate", status: "In Development", storyPoints: 5 }), kid("ABC-3", { storyPoints: 5 })];
    expect(projectStats(all, epic, now).startedPoints).toBe(5);
  });
  it("leaves tickets closed as Won't Do out of the scope", () => {
    const all = [epic, kid("ABC-2", { statusCategory: "done", status: "Cerrada", storyPoints: 5 }), kid("ABC-3", { statusCategory: "done", status: "Cerrada", resolution: "Won't Do", storyPoints: 13 })];
    const p = projectStats(all, epic, now);
    expect([p.total, p.done, p.totalPoints, p.pct]).toEqual([1, 1, 5, 100]);
  });
});

describe("summarizeProjects (the overview strip)", () => {
  const list = listProjects([
    epic("ABC-1", { statusCategory: "indeterminate", status: "In Development", duedate: "2026-09-01" }), // overdue
    epic("ABC-2", { statusCategory: "indeterminate", status: "In Development", initialEstimate: "2026-10-01", revisedEstimate: "2026-11-01" }), // slipped
    epic("ABC-3", { statusCategory: "new", status: "Backlog" }),
    epic("ABC-4", { statusCategory: "done", status: "Lanzado", duedate: "2026-01-01" }), // done: never overdue
    child("ABC-10", "ABC-1", "done", { storyPoints: 8 }), child("ABC-11", "ABC-1", "new", { storyPoints: 8 }),
    child("ABC-12", "ABC-2", "done", { storyPoints: 3 }),
  ], now);

  it("counts projects per status with their combined progress in points", () => {
    const s = summarizeProjects(list);
    expect(s.groups.map((g) => [g.label, g.count, g.pct])).toEqual([["In progress", 2, 58], ["Backlog", 1, 0], ["Completed", 1, 100]]);
    // In progress: (8 + 3) done of (16 + 3) points; a completed project counts as 100%
  });
  it("counts overdue and slipped projects that are still open", () => {
    const s = summarizeProjects(list);
    expect([s.overdue, s.slipped]).toEqual([1, 1]);
  });
  it("copes with an empty list", () => {
    expect(summarizeProjects([])).toEqual({ groups: [], overdue: 0, slipped: 0 });
  });
});
