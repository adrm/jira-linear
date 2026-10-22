// deno-lint-ignore-file no-explicit-any
import type { ActivityEntry } from "../shared/types.ts";
import type { JiraClient } from "./jira.ts";

const FIELDS: Record<string, string> = {
  status: "status", assignee: "assignee", priority: "priority", summary: "summary", labels: "labels",
  issuetype: "type", duedate: "duedate", parent: "parent",
};

/** What happened to a ticket, oldest first: the changelog reduced to the fields this app shows. */
export async function issueActivity(client: JiraClient, key: string, project: string): Promise<ActivityEntry[]> {
  if (!new RegExp(`^${project}-\\d+$`).test(key)) throw new Error(`Not a ${project} key: ${key}`);
  const histories = await client.getChangelog(key);
  const out: ActivityEntry[] = [];
  for (const h of histories) {
    (h.items ?? []).forEach((item: any, i: number) => {
      const field = FIELDS[String(item.field).toLowerCase()];
      if (!field) return;
      out.push({
        id: `${h.id}:${i}`,
        at: h.created,
        author: h.author?.accountId ? { id: h.author.accountId, name: h.author.displayName ?? h.author.accountId } : null,
        field,
        from: item.fromString || null,
        to: item.toString || null,
      });
    });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
