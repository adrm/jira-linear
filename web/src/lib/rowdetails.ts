import type { Issue } from "@shared/types";
import { isEpic } from "./projects";
import { WORKFLOW_STATUSES } from "./workflow";

/**
 * How full the started-status icon is: later workflow stages fill more, like Linear's
 * half-full "In Progress" and three-quarter "In Review". Only statuses present in the data count.
 */
export function startedFractions(issues: Issue[], forProject = false): Record<string, number> {
  const order = WORKFLOW_STATUSES.map((s) => s.name);
  const idx = (n: string) => (order.indexOf(n) === -1 ? order.length : order.indexOf(n));
  const present = [...new Set(issues.filter((i) => isEpic(i) === forProject && i.statusCategory === "indeterminate").map((i) => i.status))]
    .sort((a, b) => idx(a) - idx(b) || a.localeCompare(b));
  return Object.fromEntries(present.map((s, i) => [s, (i + 1) / (present.length + 1)]));
}

/** done/total sub-issues for tickets that have sub-issues (children of epics are project members, not sub-issues). */
export function subIssueStats(issues: Issue[]): Record<string, { done: number; total: number }> {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const out: Record<string, { done: number; total: number }> = {};
  for (const i of issues) {
    if (!i.parentKey) continue;
    const parent = byKey.get(i.parentKey);
    if (!parent || isEpic(parent)) continue;
    const s = (out[i.parentKey] ??= { done: 0, total: 0 });
    s.total++;
    if (i.statusCategory === "done") s.done++;
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface DueState { text: string; overdue: boolean; soon: boolean }

export function dueState(date: string | null, done: boolean, now: Date): DueState | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  const today = now.toISOString().slice(0, 10);
  const soonLimit = new Date(now.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
  const overdue = !done && date < today;
  return {
    text: `${MONTHS[m - 1]} ${d}${y === now.getUTCFullYear() ? "" : `, ${y}`}`,
    overdue,
    soon: !done && !overdue && date <= soonLimit,
  };
}

/** A stable hue (0–359) for a label name. */
export function labelHue(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}
