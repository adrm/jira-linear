/**
 * The project's workflow, as the server reports it (`/api/config`). These are shared arrays and
 * maps that `configureWorkflow` fills in place before the first render, so modules can import them
 * directly. Until configured they are empty, and statuses fall back to Jira's categories.
 */
export interface WorkflowConfig {
  statuses: Array<{ name: string; category: "new" | "indeterminate" | "done" }>;
  backlog: string[];
  canceled: string[];
  colors: Record<string, [number, number]>;
}

/** The project's statuses, least to most advanced within each category. */
export const WORKFLOW_STATUSES: WorkflowConfig["statuses"] = [];

/** Statuses from least to most advanced. Icons fill up along this order; lists put the most advanced first. */
export const STATUS_FLOW: string[] = [];

export const PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"];

/** Statuses that mean "not planned yet" (Linear's Backlog category). Jira has one "to do" category, so this is by name. */
export const BACKLOG_STATUSES: string[] = [];

/** Lower-cased statuses that mean "dropped" rather than "finished" (both are in Jira's done category). */
export const CANCELED_STATUSES: string[] = [];

/** [hue, chroma] overrides per status name. */
export const STATUS_COLORS: Record<string, [number, number]> = {};

const replace = <T>(target: T[], next: T[]) => void target.splice(0, target.length, ...next);

export function configureWorkflow(cfg: WorkflowConfig) {
  replace(WORKFLOW_STATUSES, cfg.statuses);
  replace(STATUS_FLOW, cfg.statuses.map((s) => s.name));
  replace(BACKLOG_STATUSES, cfg.backlog);
  replace(CANCELED_STATUSES, cfg.canceled.map((s) => s.trim().toLowerCase()));
  for (const k of Object.keys(STATUS_COLORS)) delete STATUS_COLORS[k];
  Object.assign(STATUS_COLORS, cfg.colors);
}
