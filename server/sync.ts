// deno-lint-ignore-file no-explicit-any
import type { Store } from "./db.ts";
import type { JiraClient } from "./jira.ts";
import { type FieldIds, issueFieldList } from "./fields.ts";
import { normalizeComment, normalizeIssue } from "./normalize.ts";
import { detectEvents, mentionsUser } from "./inbox_detect.ts";
import { isInvolved, shouldNotify } from "./inbox_rules.ts";
import type { InboxRules } from "../shared/inbox.ts";

export interface SyncDeps {
  client: JiraClient;
  store: Store;
  project: string;
  fields: FieldIds;
  pageSize?: number;
  /** Jira account id of the owner; without it the sync leaves the inbox alone */
  meId?: string;
}

const OVERLAP_MINUTES = 2;
/** Jira returns at most this many changelog entries per issue in a search; a full list is fetched when it is reached. */
const SEARCH_CHANGELOG_CAP = 100;

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

interface InboxRun {
  meId: string;
  installedAt: string;
  rules: InboxRules;
}

/** `inbox` is set on incremental runs; `fullLoad` on the one that first mirrors the project. */
async function ingest(deps: SyncDeps, raws: any[], inbox?: InboxRun, fullLoad = false): Promise<number> {
  let changed = 0;
  for (const raw of raws) {
    const issue = normalizeIssue(raw, deps.fields);
    if (deps.store.upsertIssue(issue)) changed++;

    const embedded = raw.fields.comment;
    let rawComments: any[] = embedded?.comments ?? [];
    // The comments embedded in search results lack `parentId`, which marks replies; the comment list has it.
    if (embedded && (embedded.total > rawComments.length || rawComments.length > 0)) {
      rawComments = await deps.client.listComments(issue.key);
    }
    const comments = rawComments.map((c) => normalizeComment(issue.key, c));

    if (inbox) {
      // Compared against the mirror before it is overwritten below.
      const mirrored = deps.store.commentsOf(issue.key);
      if ((raw.changelog?.histories?.length ?? 0) >= SEARCH_CHANGELOG_CAP) {
        raw.changelog = { histories: await deps.client.getChangelog(issue.key) };
      }
      const events = detectEvents(
        { ...raw, fields: { ...raw.fields, comment: { comments: rawComments } } },
        { commentIds: new Set(mirrored.map((c) => c.id)) },
        inbox.meId,
        inbox.installedAt,
        deps.fields,
      );
      if (events.length) {
        const commented = [...mirrored, ...comments].some((c) => c.author?.id === inbox.meId || mentionsUser(c.bodyAdf, inbox.meId));
        const involved = isInvolved(issue, inbox.meId, raw.fields.watches?.isWatching === true, commented);
        // Every event is remembered as seen, delivered or not: rules and involvement change later, past events do not come back.
        deps.store.addInboxEvents(events, (e) => shouldNotify(e, issue, inbox.rules, involved, inbox.meId));
      }
    }

    // Tickets met by a full load are not announced as new when they are edited later.
    if (fullLoad && deps.meId) deps.store.markInboxSeen([`new:${issue.key}`]);

    deps.store.replaceComments(issue.key, comments);
  }
  return changed;
}

export async function syncOnce(deps: SyncDeps): Promise<{ mode: "full" | "incremental"; changed: number }> {
  const cursor = deps.store.getKv("cursor");
  const mode = cursor ? "incremental" : "full";
  const jql = cursor
    ? `project = ${deps.project} AND updated >= "${toJqlMinute(cursor, OVERLAP_MINUTES)}" ORDER BY updated ASC`
    : `project = ${deps.project} ORDER BY updated ASC`;

  let inbox: InboxRun | undefined;
  if (deps.meId) {
    const installedAt = deps.store.inboxInstalledAt();
    // A full load is not news: it only records where the inbox starts.
    if (cursor) inbox = { meId: deps.meId, installedAt, rules: deps.store.inboxRules() };
  }

  const raws = await deps.client.searchAll(jql, issueFieldList(deps.fields), deps.pageSize ?? 100, inbox ? "changelog" : undefined);
  const changed = await ingest(deps, raws, inbox, !cursor);

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
