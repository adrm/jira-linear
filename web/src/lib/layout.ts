import type { Issue } from "@shared/types";
import { groupByStatus } from "./query";
import { isEpic, stripPermanent } from "./projects";
import { parseJiraDate } from "./time";
import { priorityOptions, priorityRank, TYPE_GROUPS, typeClass } from "./vocab";
import { STATUS_FLOW, WORKFLOW_STATUSES } from "./workflow";

export type Layout = "list" | "board";
export type GroupBy = "status" | "assignee" | "project" | "priority" | "label" | "type" | "none";
export type OrderBy = "status" | "priority" | "updated" | "created" | "due";
export type CompletedWindow = "none" | "week" | "month" | "all";
export type DisplayProp = "id" | "priority" | "status" | "type" | "labels" | "project" | "due" | "assignee" | "updated" | "subissues" | "points";

export const ALL_PROPS: DisplayProp[] = ["id", "priority", "status", "type", "labels", "project", "subissues", "points", "due", "assignee", "updated"];

export interface Display {
  layout: Layout;
  groupBy: GroupBy;
  orderBy: OrderBy;
  reverse: boolean;
  showSubIssues: boolean;
  showEmptyGroups: boolean;
  completed: CompletedWindow;
  props: DisplayProp[];
}

export const DEFAULT_DISPLAY: Display = {
  layout: "list", groupBy: "status", orderBy: "updated", reverse: false,
  showSubIssues: false, showEmptyGroups: false, completed: "all", props: ALL_PROPS,
};

/** Starting display options for a view, before the user changes anything. */
export function displayFor(view: string): Display {
  if (view === "all" || view === "created") return { ...DEFAULT_DISPLAY, completed: "month" };
  return { ...DEFAULT_DISPLAY };
}

export interface IssueGroup {
  id: string;
  label: string;
  kind: GroupBy;
  /** assignee id, project key, priority name, label name or type group; null for the "none" bucket */
  value: string | null;
  status?: string;
  category?: string;
  issues: Issue[];
}

const WINDOW_DAYS: Record<CompletedWindow, number> = { none: 0, week: 7, month: 30, all: Infinity };
const ms = (iso: string) => parseJiraDate(iso).getTime();
const progress = (s: string) => { const i = STATUS_FLOW.indexOf(s); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };

function comparator(orderBy: OrderBy): (a: Issue, b: Issue) => number {
  const updated = (a: Issue, b: Issue) => ms(b.updated) - ms(a.updated);
  switch (orderBy) {
    case "created": return (a, b) => ms(b.created) - ms(a.created);
    case "priority": return (a, b) => priorityRank(b.priority) - priorityRank(a.priority) || updated(a, b);
    case "status": return (a, b) => progress(b.status) - progress(a.status) || updated(a, b);
    case "due": return (a, b) => (a.duedate && b.duedate ? (a.duedate < b.duedate ? -1 : a.duedate > b.duedate ? 1 : 0) : a.duedate ? -1 : b.duedate ? 1 : 0) || updated(a, b);
    default: return updated;
  }
}

export function buildGroups(issues: Issue[], display: Display, ctx: { all: Issue[]; now: Date }): IssueGroup[] {
  const byKey = new Map(ctx.all.map((i) => [i.key, i]));
  const days = WINDOW_DAYS[display.completed];
  const cutoff = ctx.now.getTime() - days * 86_400_000;
  const shown = issues.filter((i) => {
    if (!display.showSubIssues && i.parentKey) {
      const parent = byKey.get(i.parentKey);
      if (parent && !isEpic(parent)) return false;
    }
    if (i.statusCategory === "done" && days !== Infinity && (days === 0 || ms(i.updated) < cutoff)) return false;
    return true;
  });

  const cmp = comparator(display.orderBy);
  const sort = (list: Issue[]) => [...list].sort(display.reverse ? (a, b) => cmp(b, a) : cmp);
  const finish = (groups: IssueGroup[]) => groups.map((g) => ({ ...g, issues: sort(g.issues) }));

  const bucket = (keyOf: (i: Issue) => Array<[string | null, string]>, kind: GroupBy, order: (a: IssueGroup, b: IssueGroup) => number, empty: IssueGroup[] = []) => {
    const map = new Map<string, IssueGroup>();
    for (const e of empty) map.set(e.id, e);
    for (const i of shown) {
      for (const [value, label] of keyOf(i)) {
        const id = `${kind}|${value ?? ""}`;
        const g = map.get(id) ?? { id, label, kind, value, issues: [] };
        g.issues.push(i);
        map.set(id, g);
      }
    }
    return finish([...map.values()].sort(order));
  };
  const lastWhenNull = (a: IssueGroup, b: IssueGroup) => (a.value === null ? 1 : 0) - (b.value === null ? 1 : 0);

  switch (display.groupBy) {
    case "none":
      return finish([{ id: "none|", label: "", kind: "none", value: null, issues: shown }]);
    case "status": {
      const groups = groupByStatus(shown).map<IssueGroup>((g) => ({ id: `status|${g.status}`, label: g.status, kind: "status", value: g.status, status: g.status, category: g.category, issues: g.issues }));
      if (display.showEmptyGroups) {
        const have = new Set(groups.map((g) => g.status));
        const extra = WORKFLOW_STATUSES.filter((s) => !have.has(s.name)).map<IssueGroup>((s) => ({ id: `status|${s.name}`, label: s.name, kind: "status", value: s.name, status: s.name, category: s.category, issues: [] }));
        return finish([...groups, ...extra].sort((a, b) => ({ indeterminate: 0, new: 1, done: 2 } as Record<string, number>)[a.category!] - ({ indeterminate: 0, new: 1, done: 2 } as Record<string, number>)[b.category!] || progress(b.status!) - progress(a.status!)));
      }
      return finish(groups);
    }
    case "assignee":
      return bucket((i) => [i.assignee ? [i.assignee.id, i.assignee.name] : [null, "No assignee"]], "assignee", (a, b) => lastWhenNull(a, b) || a.label.localeCompare(b.label));
    case "project":
      return bucket((i) => {
        const p = i.parentKey ? byKey.get(i.parentKey) : undefined;
        return [p && isEpic(p) ? [p.key, stripPermanent(p.summary)] : [null, "No project"]];
      }, "project", (a, b) => lastWhenNull(a, b) || a.label.localeCompare(b.label));
    case "priority": {
      const empty = display.showEmptyGroups ? priorityOptions(ctx.all).map<IssueGroup>((p) => ({ id: `priority|${p}`, label: p, kind: "priority", value: p, issues: [] })) : [];
      return bucket((i) => [i.priority ? [i.priority, i.priority] : [null, "No priority"]], "priority", (a, b) => lastWhenNull(a, b) || priorityRank(b.value) - priorityRank(a.value) || a.label.localeCompare(b.label), empty);
    }
    case "label":
      return bucket((i) => (i.labels.length ? i.labels.map<[string, string]>((l) => [l, l]) : [[null, "No label"]]), "label", (a, b) => lastWhenNull(a, b) || a.label.localeCompare(b.label));
    case "type": {
      const empty = display.showEmptyGroups ? TYPE_GROUPS.map<IssueGroup>((t) => ({ id: `type|${t}`, label: t, kind: "type", value: t, issues: [] })) : [];
      return bucket((i) => [[typeClass(i.issuetype), typeClass(i.issuetype)]], "type", (a, b) => TYPE_GROUPS.indexOf(a.label as never) - TYPE_GROUPS.indexOf(b.label as never), empty);
    }
  }
}
