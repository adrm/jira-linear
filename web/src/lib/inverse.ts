import type { Issue, MutationInput } from "@shared/types";
import { stripPermanent } from "./projects";
import { typeClass } from "./vocab";

export interface DescribeContext {
  users: Record<string, string>;
  issues: Record<string, Issue>;
}

/** The change that puts an issue back as it was before `m`, or null when that is not possible. */
export function inverseOf(m: MutationInput, before: Issue | undefined): MutationInput | null {
  if (!before) return null;
  switch (m.op) {
    case "setStatus": return { op: "setStatus", key: m.key, status: before.status };
    case "setAssignee": return { op: "setAssignee", key: m.key, accountId: before.assignee?.id ?? null };
    case "setPriority": return before.priority ? { op: "setPriority", key: m.key, priority: before.priority } : null; // Jira cannot clear it
    case "setLabels": return { op: "setLabels", key: m.key, labels: [...before.labels] };
    case "setType": return { op: "setType", key: m.key, issuetype: before.issuetype };
    case "unlink": {
      const l = before.links.find((x) => x.id === m.linkId);
      if (!l) return null;
      return l.direction === "outward"
        ? { op: "link", type: l.type, outwardKey: m.key, inwardKey: l.key }
        : { op: "link", type: l.type, outwardKey: l.key, inwardKey: m.key };
    }
    case "setSummary": return { op: "setSummary", key: m.key, summary: before.summary };
    case "setDueDate": return { op: "setDueDate", key: m.key, date: before.duedate };
    case "setParent": return { op: "setParent", key: m.key, parentKey: before.parentKey };
    default: return null;
  }
}

/** Short past-tense sentence for toasts. */
export function describeMutation(m: MutationInput, ctx: DescribeContext): string {
  switch (m.op) {
    case "setStatus": return `Status set to ${m.status}`;
    case "setAssignee": return m.accountId ? `Assigned to ${ctx.users[m.accountId] ?? m.accountId}` : "Unassigned";
    case "setPriority": return `Priority set to ${m.priority}`;
    case "setLabels": return "Labels updated";
    case "setType": return `Type set to ${typeClass(m.issuetype)}`;
    case "setSummary": return "Renamed";
    case "setDescription": return "Description updated";
    case "setDueDate": return m.date ? `Due date set to ${m.date}` : "Due date cleared";
    case "setParent": {
      const p = m.parentKey ? ctx.issues[m.parentKey] : undefined;
      return m.parentKey ? `Moved to ${p ? stripPermanent(p.summary) : m.parentKey}` : "Removed from project";
    }
    case "addComment": return "Comment added";
    case "createIssue": return `Created “${m.summary}”`;
    case "link": return "Relation added";
    case "addLink": return "Link added";
    case "unlink": return "Relation removed";
  }
}
