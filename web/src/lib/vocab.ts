import type { Issue } from "@shared/types";
import { isEpic } from "./projects";
import { WORKFLOW_STATUSES } from "./workflow";

const count = (values: string[]): Array<[string, number]> => {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

export type TypeGroup = "Bug" | "Spike" | "Task";
export const TYPE_GROUPS: TypeGroup[] = ["Bug", "Spike", "Task"];

/** What depends on the Jira site and its language. `jira-linear.config.json` (`vocab`) replaces any of these. */
export interface Vocab {
  priorities?: Record<string, number>;
  bugTypes?: string[];
  spikeTypes?: string[];
  subtaskTypes?: string[];
  nonTicketTypes?: string[];
}

const DEFAULT_PRIORITIES: Record<string, number> = {
  Highest: 4, "Crítica": 4, Critical: 4, P1: 4,
  High: 3, Alta: 3, P2: 3,
  Medium: 2, "Medium (migrated)": 2, Importante: 2, Media: 2, P3: 2,
  Low: 1, "Low (migrated)": 1, "Poco importante": 1, Baja: 1, P4: 1,
  Lowest: 0, Trivial: 0,
};

let BUG_NAMES = new Set(["bug", "error"]);
let SPIKE_NAMES = new Set(["spike"]);
let NOT_A_TICKET_TYPE = new Set(["Epic", "Subtarea", "Sub-task", "Subtask"]);
let SUBTASK_NAMES = ["Subtarea", "Sub-task", "Subtask"];
const RANKS: Record<string, number> = { ...DEFAULT_PRIORITIES };
const lower = (l: string[]) => new Set(l.map((x) => x.trim().toLowerCase()));

/** Apply the site's vocabulary; anything not given keeps its default. */
export function configureVocab(v: Vocab = {}) {
  BUG_NAMES = lower(v.bugTypes ?? ["bug", "error"]);
  SPIKE_NAMES = lower(v.spikeTypes ?? ["spike"]);
  NOT_A_TICKET_TYPE = new Set(v.nonTicketTypes ?? ["Epic", "Subtarea", "Sub-task", "Subtask"]);
  SUBTASK_NAMES = v.subtaskTypes ?? ["Subtarea", "Sub-task", "Subtask"];
  for (const k of Object.keys(RANKS)) delete RANKS[k];
  Object.assign(RANKS, v.priorities ?? DEFAULT_PRIORITIES);
}

/** Jira has many ticket types (and they are localised); this app only distinguishes Bug, Spike and everything else. */
export function typeClass(jiraType: string): TypeGroup {
  const t = jiraType.trim().toLowerCase();
  if (BUG_NAMES.has(t)) return "Bug";
  if (SPIKE_NAMES.has(t)) return "Spike";
  return "Task";
}

/** The three groups with the Jira type name each one is stored as in this data (most used name wins). */
export function typeOptions(issues: Issue[]): Array<{ group: TypeGroup; jiraName: string }> {
  const used = count(issues.map((i) => i.issuetype).filter((t) => !NOT_A_TICKET_TYPE.has(t)));
  return TYPE_GROUPS.map((group) => ({
    group,
    jiraName: used.find(([name]) => typeClass(name) === group)?.[0] ?? group,
  }));
}

export const jiraTypeFor = (group: TypeGroup, issues: Issue[]): string =>
  typeOptions(issues).find((o) => o.group === group)!.jiraName;

/** 0 (lowest) to 4 (highest); unknown names count as medium; no priority is -1. */
export function priorityRank(name: string | null): number {
  if (!name) return -1;
  return RANKS[name] ?? 2;
}

export type PriorityLevel = "urgent" | "high" | "medium" | "low" | "none";

/** Linear's five levels, whatever the Jira scheme calls them. */
export function priorityLevel(name: string | null): PriorityLevel {
  const r = priorityRank(name);
  return r < 0 ? "none" : r >= 4 ? "urgent" : r === 3 ? "high" : r === 2 ? "medium" : "low";
}

/** The name Jira uses for sub-tasks in this workspace (it is localised). */
export function subtaskType(issues: Issue[]): string {
  return issues.find((i) => SUBTASK_NAMES.includes(i.issuetype))?.issuetype ?? "Sub-task";
}

export function priorityOptions(issues: Issue[]): string[] {
  const used = count(issues.flatMap((i) => (i.priority ? [i.priority] : [])));
  if (!used.length) return ["Highest", "High", "Medium", "Low", "Lowest"];
  return used.sort((a, b) => priorityRank(b[0]) - priorityRank(a[0]) || b[1] - a[1]).map(([p]) => p);
}

const CATEGORY_RANK: Record<string, number> = { indeterminate: 0, new: 1, done: 2 };

/** Statuses a ticket or a project can be moved to, as seen in the data (projects have their own workflow). */
export function statusOptions(issues: Issue[], forProject: boolean): Array<{ name: string; category: string }> {
  const seen = new Map<string, string>();
  const pool = issues.filter((i) => isEpic(i) === forProject);
  for (const i of pool) seen.set(i.status, i.statusCategory);
  if (!forProject) for (const s of WORKFLOW_STATUSES) if (!seen.has(s.name)) seen.set(s.name, s.category);
  if (forProject && seen.size === 0) for (const i of issues) seen.set(i.status, i.statusCategory);
  const order = WORKFLOW_STATUSES.map((s) => s.name);
  const idx = (n: string) => (order.indexOf(n) === -1 ? order.length : order.indexOf(n));
  return [...seen]
    .map(([name, category]) => ({ name, category }))
    .sort((a, b) => (CATEGORY_RANK[a.category] ?? 1) - (CATEGORY_RANK[b.category] ?? 1) || idx(a.name) - idx(b.name) || a.name.localeCompare(b.name));
}
