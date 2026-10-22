// deno-lint-ignore-file no-explicit-any
import type { Store } from "./db.ts";
import type { JiraClient } from "./jira.ts";
import { type FieldIds, issueFieldList } from "./fields.ts";
import { normalizeComment, normalizeIssue } from "./normalize.ts";

export interface SyncDeps {
  client: JiraClient;
  store: Store;
  project: string;
  fields: FieldIds;
  pageSize?: number;
}

const OVERLAP_MINUTES = 2;

/**
 * Turn a Jira timestamp into a JQL minute literal, minus an overlap.
 * Jira renders timestamps in the user's timezone and interprets JQL date literals in
 * that same timezone, so the local clock part is used as-is and the offset is ignored.
 */
export function toJqlMinute(jiraTs: string, overlapMinutes: number): string {
  const m = jiraTs.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error(`Unrecognised Jira timestamp: ${jiraTs}`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - overlapMinutes * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

async function ingest(deps: SyncDeps, raws: any[]): Promise<number> {
  let changed = 0;
  for (const raw of raws) {
    const issue = normalizeIssue(raw, deps.fields);
    if (deps.store.upsertIssue(issue)) changed++;

    const embedded = raw.fields.comment;
    let rawComments: any[] = embedded?.comments ?? [];
    if (embedded && embedded.total > rawComments.length) {
      rawComments = await deps.client.listComments(issue.key);
    }
    deps.store.replaceComments(issue.key, rawComments.map((c) => normalizeComment(issue.key, c)));
  }
  return changed;
}

export async function syncOnce(deps: SyncDeps): Promise<{ mode: "full" | "incremental"; changed: number }> {
  const cursor = deps.store.getKv("cursor");
  const mode = cursor ? "incremental" : "full";
  const jql = cursor
    ? `project = ${deps.project} AND updated >= "${toJqlMinute(cursor, OVERLAP_MINUTES)}" ORDER BY updated ASC`
    : `project = ${deps.project} ORDER BY updated ASC`;

  const raws = await deps.client.searchAll(jql, issueFieldList(deps.fields), deps.pageSize ?? 100);
  const changed = await ingest(deps, raws);

  const newest = raws.map((r) => r.fields.updated as string).sort().at(-1);
  if (newest && (!cursor || newest > cursor)) deps.store.setKv("cursor", newest);
  return { mode, changed };
}

/** Detect deletions / moves: Jira has no change feed for them, so compare full key sets. */
export async function reconcile(deps: SyncDeps): Promise<number> {
  const live = await deps.client.searchAll(`project = ${deps.project}`, ["summary"], deps.pageSize ?? 100);
  if (live.length === 0) return 0; // more likely an outage or permission problem than a mass delete
  return deps.store.tombstoneMissing(live.map((r) => r.key));
}
