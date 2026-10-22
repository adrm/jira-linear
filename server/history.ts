// deno-lint-ignore-file no-explicit-any
import type { JiraClient } from "./jira.ts";
import { isDroppedResolution } from "../shared/resolution.ts";

export interface TicketHistory {
  key: string;
  created: string;
  /** first time the ticket reached a started (or done) status */
  started: string | null;
  /** when it was finished; null if it is open, including after being reopened */
  completed: string | null;
  /** when it left the scope without being done; null otherwise */
  canceled: string | null;
  /** Story Points, null when unestimated */
  points: number | null;
}

const numeric = (key: string) => Number(key.split("-")[1]);

/**
 * When each ticket of a project was created, started and completed, for the progress graph.
 * One paged search with the changelog expanded; `categories` maps a status name to its category.
 */
export async function projectHistory(
  client: JiraClient,
  categories: Record<string, string>,
  projectKey: string,
  project: string,
  storyPointsField?: string,
): Promise<TicketHistory[]> {
  if (!new RegExp(`^${project}-\\d+$`).test(projectKey)) throw new Error(`Not a ${project} project key: ${projectKey}`);
  const raws = await client.searchAll(`parent = ${projectKey}`, ["created", "resolutiondate", "status", "resolution", ...(storyPointsField ? [storyPointsField] : [])], 100, "changelog");
  const out: TicketHistory[] = raws.map((raw: any) => {
    const moves = (raw.changelog?.histories ?? [])
      .flatMap((h: any) => (h.items ?? []).filter((i: any) => i.field === "status").map((i: any) => ({ at: h.created as string, to: i.toString as string })))
      .sort((a: { at: string }, b: { at: string }) => (a.at < b.at ? -1 : 1));
    const doneNow = raw.fields.status?.statusCategory?.key === "done";
    const lastDone = [...moves].reverse().find((m) => categories[m.to] === "done")?.at ?? null;
    const finishedAt: string | null = doneNow ? raw.fields.resolutiondate ?? lastDone : null;
    const dropped = doneNow && isDroppedResolution(raw.fields.resolution?.name);
    const completed = dropped ? null : finishedAt;
    const canceled = dropped ? finishedAt : null;
    const firstStarted = moves.find((m: { to: string }) => categories[m.to] === "indeterminate" || categories[m.to] === "done")?.at ?? null;
    return {
      key: raw.key, created: raw.fields.created, started: dropped ? null : firstStarted ?? completed, completed, canceled,
      points: storyPointsField && typeof raw.fields[storyPointsField] === "number" ? raw.fields[storyPointsField] : null,
    };
  });
  return out.sort((a, b) => numeric(a.key) - numeric(b.key));
}
