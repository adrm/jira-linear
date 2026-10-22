import type { Issue, Mutation } from "@shared/types";
import { markdownToAdf } from "@shared/adf";
import { site } from "./site";
import { WORKFLOW_STATUSES } from "./workflow";

export type IssueMap = Record<string, Issue>;

export interface LocalContext {
  /** status name -> status category, learned from synced issues */
  statuses: Record<string, string>;
  /** accountId -> display name, learned from synced issues */
  users: Record<string, string>;
}

/** Apply a mutation to a copy of the issue map, mirroring what Jira will do. */
export function applyLocal(issues: IssueMap, m: Mutation, ctx: LocalContext): IssueMap {
  const patch = (key: string, fn: (i: Issue) => Partial<Issue>): IssueMap => {
    const cur = issues[key];
    return cur ? { ...issues, [key]: { ...cur, ...fn(cur) } } : issues;
  };

  switch (m.op) {
    case "setStatus":
      return patch(m.key, () => ({ status: m.status, statusCategory: ctx.statuses[m.status] ?? "indeterminate" }));
    case "setAssignee":
      return patch(m.key, () => ({
        assignee: m.accountId ? { id: m.accountId, name: ctx.users[m.accountId] ?? m.accountId } : null,
      }));
    case "setPriority":
      return patch(m.key, () => ({ priority: m.priority }));
    case "setLabels":
      return patch(m.key, () => ({ labels: [...m.labels] }));
    case "setType":
      return patch(m.key, () => ({ issuetype: m.issuetype }));
    case "setSummary":
      return patch(m.key, () => ({ summary: m.summary }));
    case "setDueDate":
      return patch(m.key, () => ({ duedate: m.date }));
    case "setParent":
      return patch(m.key, () => ({
        parentKey: m.parentKey,
        parentSummary: m.parentKey ? issues[m.parentKey]?.summary ?? null : null,
      }));
    case "setDescription":
      return patch(m.key, () => ({ descriptionAdf: m.markdown.trim() ? markdownToAdf(m.markdown) : null }));
    case "addComment":
    case "addLink":
      return issues; // rendered from server data; shown once confirmed
    case "createIssue": {
      const now = new Date().toISOString();
      const temp: Issue = {
        key: `NEW-${m.id}`, id: `new-${m.id}`, project: site.project, summary: m.summary, descriptionAdf: null,
        status: m.status ?? WORKFLOW_STATUSES.find((s) => s.category === "new")?.name ?? "To Do", statusCategory: m.status ? ctx.statuses[m.status] ?? "indeterminate" : "new",
        issuetype: m.issuetype, priority: m.priority ?? null,
        assignee: m.assigneeId ? { id: m.assigneeId, name: ctx.users[m.assigneeId] ?? m.assigneeId } : null,
        reporter: null, parentKey: m.parentKey ?? null,
        parentSummary: m.parentKey ? issues[m.parentKey]?.summary ?? null : null,
        labels: m.labels ?? [], duedate: m.duedate ?? null, created: now, updated: now, links: [],
        quarter: null, initialEstimate: null, revisedEstimate: null, statusChanged: null, storyPoints: null, resolution: null,
      };
      return { ...issues, [temp.key]: temp };
    }
    case "unlink": {
      const a = issues[m.key];
      const b = issues[m.otherKey];
      const out = { ...issues };
      if (a) out[a.key] = { ...a, links: a.links.filter((l) => l.id !== m.linkId) };
      if (b) out[b.key] = { ...b, links: b.links.filter((l) => l.id !== m.linkId) };
      return out;
    }
    case "link": {
      const out = issues[m.outwardKey];
      const inn = issues[m.inwardKey];
      if (!out || !inn) return issues;
      const phrases: Record<string, [string, string]> = { Blocks: ["is blocked by", "blocks"], Relates: ["relates to", "relates to"] };
      const [inward, outward] = phrases[m.type] ?? [m.type, m.type];
      return {
        ...issues,
        [out.key]: { ...out, links: [...out.links, { id: `tmp-${m.id}`, type: m.type, direction: "outward", phrase: outward, key: inn.key, summary: inn.summary }] },
        [inn.key]: { ...inn, links: [...inn.links, { id: `tmp-${m.id}`, type: m.type, direction: "inward", phrase: inward, key: out.key, summary: out.summary }] },
      };
    }
  }
}
