import type { Issue } from "@shared/types";
import { BACKLOG_STATUSES, STATUS_FLOW } from "./workflow";

export interface Filter {
  open?: boolean;
  /** accountId, or null for unassigned; undefined = any */
  assignee?: string | null;
  label?: string;
  parentKey?: string;
}

export interface Group {
  status: string;
  category: string;
  issues: Issue[];
}

const CATEGORY_RANK: Record<string, number> = { indeterminate: 0, new: 1, done: 2 };

/** Larger = further along. Statuses the workflow does not know are treated as most advanced in their category. */
function progress(status: string): number {
  const i = STATUS_FLOW.indexOf(status);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

export function searchIssues(issues: Issue[], query: string): Issue[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return issues;
  const hits = issues.filter((i) => {
    const hay = `${i.key} ${i.summary}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
  const exact = (i: Issue) => {
    const num = i.key.split("-")[1];
    return tokens.some((t) => t === i.key.toLowerCase() || t === num) ? 0 : 1;
  };
  return hits.map((i, idx) => ({ i, idx })).sort((a, b) => exact(a.i) - exact(b.i) || a.idx - b.idx).map((x) => x.i);
}

export function filterIssues(issues: Issue[], f: Filter): Issue[] {
  return issues.filter((i) => {
    if (f.open && i.statusCategory === "done") return false;
    if (f.assignee !== undefined && (i.assignee?.id ?? null) !== f.assignee) return false;
    if (f.label && !i.labels.includes(f.label)) return false;
    if (f.parentKey && i.parentKey !== f.parentKey) return false;
    return true;
  });
}

export function groupByStatus(issues: Issue[]): Group[] {
  const map = new Map<string, Group>();
  for (const i of issues) {
    const g = map.get(i.status) ?? { status: i.status, category: i.statusCategory, issues: [] };
    g.issues.push(i);
    map.set(i.status, g);
  }
  const groups = [...map.values()];
  for (const g of groups) g.issues.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  return groups.sort(
    (a, b) =>
      (CATEGORY_RANK[a.category] ?? 1) - (CATEGORY_RANK[b.category] ?? 1) ||
      progress(b.status) - progress(a.status) ||
      a.status.localeCompare(b.status),
  );
}

export const flatOrder = (groups: Group[]): Issue[] => groups.flatMap((g) => g.issues);

export interface ViewContext {
  meId: string | null;
  now: Date;
  /** tickets marked for team review (key -> when), kept locally */
  review?: Record<string, string>;
}

export function applyView(all: Issue[], view: string, ctx: ViewContext): Issue[] {
  // Epics are projects in this app; they never show up as tickets.
  const issues = all.filter((i) => i.issuetype !== "Epic");
  const open = issues.filter((i) => i.statusCategory !== "done");
  if (view === "active") return open.filter((i) => !BACKLOG_STATUSES.includes(i.status));
  if (view === "backlog") return open.filter((i) => BACKLOG_STATUSES.includes(i.status));
  if (view === "mine") return ctx.meId ? filterIssues(open, { assignee: ctx.meId }) : [];
  if (view === "created") return ctx.meId ? issues.filter((i) => i.reporter?.id === ctx.meId) : [];
  if (view === "review") return issues.filter((i) => ctx.review?.[i.key]);
  if (view.startsWith("project:")) return filterIssues(issues, { parentKey: view.slice(8) });
  if (view === "projects") return [];
  return issues;
}
