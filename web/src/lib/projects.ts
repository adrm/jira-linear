import type { Issue, IssueLink, UserRef } from "@shared/types";
import { BACKLOG_STATUSES, CANCELED_STATUSES } from "./workflow";
import { DEFAULT_STORY_POINTS, isDropped, pointsOf } from "./points";

export const isEpic = (i: Issue): boolean => i.issuetype === "Epic";
const PERMANENT = /^\s*\[PERMANENT\]\s*/i; // \s also covers the non-breaking space some epics use
export const isPermanent = (summary: string): boolean => PERMANENT.test(summary);
export const stripPermanent = (s: string): string => s.replace(PERMANENT, "").trim();

export interface ProjectStats {
  key: string;
  name: string;
  status: string;
  statusCategory: string;
  lead: UserRef | null;
  targetDate: string | null;
  labels: string[];
  updated: string;
  total: number;
  done: number;
  inProgress: number;
  todo: number;
  /** story points: unestimated tickets count as the configured default */
  totalPoints: number;
  donePoints: number;
  startedPoints: number;
  pct: number;
  overdue: boolean;
  ongoing: boolean;
  quarter: string | null;
  initialEstimate: string | null;
  revisedEstimate: string | null;
  /** where `targetDate` came from */
  targetSource: "revised" | "initial" | "due" | null;
  /** days the revised date is later than the initial estimate, when it has slipped */
  slipDays: number | null;
  statusChanged: string | null;
}

/** The quarters of a project, one by one ("FY2027 Q2, FY2027 Q3" is two). */
export const quarterList = (quarter: string | null): string[] => (quarter ? quarter.split(",").map((q) => q.trim()).filter(Boolean) : []);

export const childrenOf = (issues: Issue[], epicKey: string): Issue[] =>
  issues.filter((i) => i.parentKey === epicKey && !isEpic(i));

export interface StatsOptions { defaultPoints?: number }

export function projectStats(all: Issue[], epic: Issue, now: Date, opts: StatsOptions = {}): ProjectStats {
  const def = opts.defaultPoints ?? DEFAULT_STORY_POINTS;
  // tickets closed as Won't Do and the like are out of scope, not progress
  const kids = childrenOf(all, epic.key).filter((k) => !isDropped(k));
  const sum = (list: Issue[]) => list.reduce((n, k) => n + pointsOf(k, def), 0);
  const doneKids = kids.filter((k) => k.statusCategory === "done");
  const startedKids = kids.filter((k) => k.statusCategory === "indeterminate");
  const done = doneKids.length;
  const inProgress = startedKids.length;
  const totalPoints = sum(kids);
  const donePoints = sum(doneKids);
  const pct = totalPoints ? Math.round((donePoints / totalPoints) * 100) : 0;
  const today = now.toISOString().slice(0, 10);
  // the current commitment: the revised date, else the original estimate, else Jira's own due date
  const targetDate = epic.revisedEstimate ?? epic.initialEstimate ?? epic.duedate;
  const targetSource = epic.revisedEstimate ? "revised" : epic.initialEstimate ? "initial" : epic.duedate ? "due" : null;
  const dayMs = 86_400_000;
  const slip = epic.revisedEstimate && epic.initialEstimate
    ? Math.round((Date.parse(`${epic.revisedEstimate}T00:00:00Z`) - Date.parse(`${epic.initialEstimate}T00:00:00Z`)) / dayMs)
    : 0;
  return {
    key: epic.key,
    name: stripPermanent(epic.summary),
    status: epic.status,
    statusCategory: epic.statusCategory,
    lead: epic.assignee,
    targetDate,
    labels: epic.labels,
    updated: epic.updated,
    total: kids.length,
    done,
    inProgress,
    todo: kids.length - done - inProgress,
    totalPoints,
    donePoints,
    startedPoints: sum(startedKids),
    pct,
    overdue: !!targetDate && targetDate < today && pct < 100 && epic.statusCategory !== "done",
    ongoing: isPermanent(epic.summary),
    quarter: epic.quarter,
    initialEstimate: epic.initialEstimate,
    revisedEstimate: epic.revisedEstimate,
    targetSource,
    slipDays: slip > 0 ? slip : null,
    statusChanged: epic.statusChanged,
  };
}

export const listProjects = (all: Issue[], now: Date, opts: StatsOptions = {}): ProjectStats[] =>
  all.filter(isEpic).map((e) => projectStats(all, e, now, opts));

export type ProjectGroupLabel = "In progress" | "Planned" | "Backlog" | "Ongoing" | "Completed" | "Canceled";

export interface ProjectGroup {
  label: string;
  projects: ProjectStats[];
}

const GROUP_ORDER: ProjectGroupLabel[] = ["In progress", "Planned", "Backlog", "Ongoing", "Completed", "Canceled"];

/** Linear-style project state for a Jira epic. */
function statusGroup(p: ProjectStats): ProjectGroupLabel {
  if (p.statusCategory === "done") return CANCELED_STATUSES.includes(p.status.trim().toLowerCase()) ? "Canceled" : "Completed";
  if (p.ongoing) return "Ongoing";
  if (p.statusCategory === "indeterminate") return "In progress";
  return BACKLOG_STATUSES.includes(p.status) ? "Backlog" : "Planned";
}

const byUpdated = (a: ProjectStats, b: ProjectStats) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0);

export function groupProjects(projects: ProjectStats[]): ProjectGroup[] {
  return GROUP_ORDER.map((label) => ({ label, projects: projects.filter((p) => statusGroup(p) === label).sort(byUpdated) })).filter((g) => g.projects.length > 0);
}

export interface ProjectsSummary {
  /** one entry per status group that has projects, with combined progress in story points */
  groups: Array<{ label: string; count: number; pct: number }>;
  /** open projects past their target date */
  overdue: number;
  /** open projects whose revised date is later than the initial estimate */
  slipped: number;
}

/** The numbers behind the overview strip on the Projects page. */
export function summarizeProjects(projects: ProjectStats[]): ProjectsSummary {
  const groups = groupProjects(projects).map((g) => {
    const total = g.projects.reduce((n, p) => n + p.totalPoints, 0);
    const done = g.projects.reduce((n, p) => n + p.donePoints, 0);
    return { label: g.label, count: g.projects.length, pct: g.label === "Completed" ? 100 : total ? Math.round((done / total) * 100) : 0 };
  });
  const open = projects.filter((p) => p.statusCategory !== "done");
  return { groups, overdue: open.filter((p) => p.overdue).length, slipped: open.filter((p) => p.slipDays !== null).length };
}

export interface ProjectsDisplay {
  layout: "list" | "board";
  groupBy: "status" | "lead" | "quarter" | "none";
  orderBy: "updated" | "name" | "progress" | "target";
  reverse: boolean;
  completed: "none" | "week" | "month" | "all";
}

export const DEFAULT_PROJECTS_DISPLAY: ProjectsDisplay = { layout: "list", groupBy: "status", orderBy: "updated", reverse: false, completed: "month" };

const WINDOW_DAYS = { none: 0, week: 7, month: 30, all: Infinity } as const;

/** The project list as the display options ask for it: window, grouping, ordering. */
export function buildProjectGroups(
  projects: ProjectStats[], display: ProjectsDisplay, now: Date,
): ProjectGroup[] {
  const days = WINDOW_DAYS[display.completed];
  const shown = projects.filter((p) => p.statusCategory !== "done" || days === Infinity || (days > 0 && now.getTime() - new Date(p.updated).getTime() <= days * 86_400_000));

  const cmp: Record<ProjectsDisplay["orderBy"], (a: ProjectStats, b: ProjectStats) => number> = {
    updated: byUpdated,
    name: (a, b) => a.name.localeCompare(b.name),
    progress: (a, b) => b.pct - a.pct || byUpdated(a, b),
    target: (a, b) => (a.targetDate && b.targetDate ? (a.targetDate < b.targetDate ? -1 : a.targetDate > b.targetDate ? 1 : 0) : a.targetDate ? -1 : b.targetDate ? 1 : 0) || byUpdated(a, b),
  };
  const sort = (list: ProjectStats[]) => [...list].sort(display.reverse ? (a, b) => cmp[display.orderBy](b, a) : cmp[display.orderBy]);
  const finish = (groups: ProjectGroup[]) => groups.filter((g) => g.projects.length).map((g) => ({ ...g, projects: sort(g.projects) }));

  switch (display.groupBy) {
    case "none": return finish([{ label: "", projects: shown }]);
    case "lead": {
      const names = [...new Set(shown.map((p) => p.lead?.name).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b));
      return finish([...names.map((n) => ({ label: n, projects: shown.filter((p) => p.lead?.name === n) })), { label: "No lead", projects: shown.filter((p) => !p.lead) }]);
    }
    case "quarter": {
      const quarters = (p: ProjectStats) => (p.quarter ? p.quarter.split(",").map((q) => q.trim()).filter(Boolean) : []);
      const names = [...new Set(shown.flatMap(quarters))].sort((a, b) => a.localeCompare(b));
      return finish([...names.map((n) => ({ label: n, projects: shown.filter((p) => quarters(p).includes(n)) })), { label: "No quarter", projects: shown.filter((p) => quarters(p).length === 0) }]);
    }
    default:
      return finish(groupProjects(shown));
  }
}

export type RelKind = "blockedBy" | "blocks" | "relates";

/** How a link reads from the point of view of the issue that holds it. */
export function relKind(l: Pick<IssueLink, "type" | "direction">): RelKind {
  if (l.type !== "Blocks") return "relates";
  return l.direction === "outward" ? "blocks" : "blockedBy";
}
const INVERSE: Record<RelKind, RelKind> = { blocks: "blockedBy", blockedBy: "blocks", relates: "relates" };
const KIND_ORDER: RelKind[] = ["blockedBy", "blocks", "relates"];

export interface DirectRelation { kind: RelKind; key: string; name: string; phrase: string }
export interface DerivedRelation {
  kind: RelKind;
  projectKey: string | null;
  name: string;
  count: number;
  pairs: Array<{ from: string; to: string }>;
}

export function projectRelationships(all: Issue[], epicKey: string): { direct: DirectRelation[]; derived: DerivedRelation[] } {
  const byKey = new Map(all.map((i) => [i.key, i]));
  const epic = byKey.get(epicKey);
  const nameOf = (key: string | null) => (key ? stripPermanent(byKey.get(key)?.summary ?? key) : "No project");
  const projectOf = (i: Issue) => (isEpic(i) ? i.key : i.parentKey);

  const direct: DirectRelation[] = (epic?.links ?? [])
    .filter((l) => byKey.get(l.key) && isEpic(byKey.get(l.key)!))
    .map((l) => ({ kind: relKind(l), key: l.key, name: nameOf(l.key), phrase: l.phrase }));

  const kids = new Set(childrenOf(all, epicKey).map((k) => k.key));
  const seen = new Set<string>();
  const buckets = new Map<string, DerivedRelation>();
  const add = (kind: RelKind, from: string, other: Issue) => {
    const pj = projectOf(other) ?? null;
    if (pj === epicKey) return;
    const id = `${kind}|${from}|${other.key}`;
    if (seen.has(id)) return;
    seen.add(id);
    const bk = `${kind}|${pj}`;
    const b = buckets.get(bk) ?? { kind, projectKey: pj, name: nameOf(pj), count: 0, pairs: [] };
    b.pairs.push({ from, to: other.key });
    b.count = b.pairs.length;
    buckets.set(bk, b);
  };
  for (const issue of all) {
    for (const l of issue.links) {
      if (kids.has(issue.key)) {
        const other = byKey.get(l.key);
        if (other) add(relKind(l), issue.key, other);
      } else if (kids.has(l.key)) {
        // links are stored on both sides in Jira, but tolerate partial data by reading the reverse side too
        add(INVERSE[relKind(l)], l.key, issue);
      }
    }
  }
  const derived = [...buckets.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.count - a.count || a.name.localeCompare(b.name),
  );
  return { direct, derived };
}
