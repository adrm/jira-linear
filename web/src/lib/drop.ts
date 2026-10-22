import type { Issue, MutationInput } from "@shared/types";
import type { IssueGroup } from "./layout";
import { jiraTypeFor, typeClass, type TypeGroup } from "./vocab";

/** The changes that dropping tickets onto a board column means. Tickets that already match are left alone. */
export function dropChanges(target: IssueGroup, issues: Issue[], all: Issue[]): MutationInput[] {
  switch (target.kind) {
    case "status":
      return issues.filter((i) => target.status && i.status !== target.status).map((i) => ({ op: "setStatus", key: i.key, status: target.status! }));
    case "assignee":
      return issues.filter((i) => (i.assignee?.id ?? null) !== target.value).map((i) => ({ op: "setAssignee", key: i.key, accountId: target.value }));
    case "project":
      return issues.filter((i) => (i.parentKey ?? null) !== target.value).map((i) => ({ op: "setParent", key: i.key, parentKey: target.value }));
    case "priority":
      if (!target.value) return []; // Jira cannot clear a priority
      return issues.filter((i) => i.priority !== target.value).map((i) => ({ op: "setPriority", key: i.key, priority: target.value! }));
    case "type": {
      const name = jiraTypeFor(target.value as TypeGroup, all);
      return issues.filter((i) => typeClass(i.issuetype) !== target.value).map((i) => ({ op: "setType", key: i.key, issuetype: name }));
    }
    case "label":
      if (!target.value) return [];
      return issues.filter((i) => !i.labels.includes(target.value!)).map((i) => ({ op: "setLabels", key: i.key, labels: [...i.labels, target.value!] }));
    default:
      return [];
  }
}
