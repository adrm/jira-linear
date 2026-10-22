// deno-lint-ignore-file no-explicit-any
import type { Settings } from "./settings.ts";

export type StatusCategory = "new" | "indeterminate" | "done";

/** What the client needs to draw statuses: the project's statuses in order, plus naming hints. */
export interface WorkflowConfig {
  statuses: Array<{ name: string; category: StatusCategory }>;
  backlog: string[];
  canceled: string[];
  colors: Record<string, [number, number]>;
}

const RANK: Record<string, number> = { new: 0, indeterminate: 1, done: 2 };
const norm = (s: string) => s.trim().toLowerCase();
const category = (k: string | undefined): StatusCategory => (k !== undefined && k in RANK ? (k as StatusCategory) : "new");

/**
 * Union the statuses of all issue types (Jira's `/project/{key}/statuses`), keep Jira's order within
 * each category, and apply the optional `order` from the settings on top.
 * `extra` are statuses seen on tickets (name -> category) that the project list does not include.
 */
export function buildWorkflow(
  perType: Array<{ statuses?: Array<{ name: string; statusCategory?: { key?: string } }> }>,
  extra: Record<string, string> = {},
  wf: Settings["workflow"] = {},
): WorkflowConfig {
  const seen = new Map<string, StatusCategory>();
  for (const t of perType) {
    for (const s of t.statuses ?? []) if (!seen.has(s.name)) seen.set(s.name, category(s.statusCategory?.key));
  }
  for (const [name, cat] of Object.entries(extra)) if (!seen.has(name)) seen.set(name, category(cat));

  const order = (wf?.order ?? []).map(norm);
  const jiraIndex = new Map([...seen.keys()].map((n, i) => [n, i]));
  const statuses = [...seen].map(([name, cat]) => ({ name, category: cat }));
  statuses.sort((a, b) => {
    if (RANK[a.category] !== RANK[b.category]) return RANK[a.category] - RANK[b.category];
    const ia = order.indexOf(norm(a.name)), ib = order.indexOf(norm(b.name));
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return jiraIndex.get(a.name)! - jiraIndex.get(b.name)!;
  });
  return {
    statuses,
    backlog: wf?.backlog ?? ["Backlog"],
    canceled: wf?.canceled ?? ["Canceled", "Cancelled", "Won't Do", "Rejected"],
    colors: wf?.colors ?? {},
  };
}

export async function discoverWorkflow(
  client: { request: <T = any>(m: string, p: string) => Promise<T> },
  project: string,
  extra: Record<string, string>,
  wf?: Settings["workflow"],
): Promise<WorkflowConfig> {
  let perType: any[] = [];
  try {
    perType = await client.request<any[]>("GET", `/project/${encodeURIComponent(project)}/statuses`);
  } catch { /* fall back to the statuses seen on tickets */ }
  return buildWorkflow(perType, extra, wf);
}
