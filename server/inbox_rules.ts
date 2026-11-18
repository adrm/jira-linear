import type { InboxEvent, InboxRules } from "../shared/inbox.ts";
import type { Issue } from "../shared/types.ts";

const FIELD_KINDS = ["priority", "duedate", "summary", "description", "labels", "type", "parent", "links"] as const;

/** The owner is on the ticket (assignee, reporter, QA assignee, watcher) or has commented on it or been mentioned on it. */
export function isInvolved(issue: Issue, meId: string, watching: boolean, commented: boolean): boolean {
  return issue.assignee?.id === meId || issue.reporter?.id === meId || issue.qaAssignees.some((u) => u.id === meId) || watching || commented;
}

/**
 * Whether an event becomes a notification. Mentions and assignment to or from the owner go through whatever the
 * scope; new tickets depend on their own rule only; everything else needs its rule and, with scope "involved", involvement.
 */
export function shouldNotify(ev: InboxEvent, issue: Issue, rules: InboxRules, involved: boolean, meId: string): boolean {
  if (ev.kind === "comment" && ev.mentionsMe && rules.mentions) return true;
  if (ev.kind === "assignee") return !!ev.assignment && rules.assigned;
  if (ev.kind === "created") {
    const n = rules.newTickets;
    if (n.mode === "all") return true;
    if (n.mode === "assigned") return issue.assignee?.id === meId;
    if (n.mode === "epics") return issue.parentKey !== null && n.epics.includes(issue.parentKey);
    return false;
  }
  if (rules.scope === "involved" && !involved) return false;
  if (ev.kind === "status") {
    const s = rules.status;
    return s.mode === "any" || (s.mode === "into" && ev.to !== null && s.statuses.includes(ev.to));
  }
  if (ev.kind === "comment") return rules.comments === "all" || (rules.comments === "mentions" && !!ev.mentionsMe);
  return rules.fields[ev.kind];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** The rules as sent by a client, or null when any part of them is malformed. Nothing is filled in. */
export function validateRules(input: unknown): InboxRules | null {
  if (!isObj(input)) return null;
  const { scope, mentions, assigned, status, comments, newTickets, fields } = input;
  if (scope !== "involved" && scope !== "project") return null;
  if (typeof mentions !== "boolean" || typeof assigned !== "boolean") return null;
  if (!isObj(status)) return null;
  let checkedStatus: InboxRules["status"];
  if (status.mode === "off" || status.mode === "any") checkedStatus = { mode: status.mode };
  else if (status.mode === "into" && isStrings(status.statuses) && status.statuses.length > 0) checkedStatus = { mode: "into", statuses: [...status.statuses] };
  else return null;
  if (comments !== "off" && comments !== "mentions" && comments !== "all") return null;
  if (!isObj(newTickets) || !isStrings(newTickets.epics)) return null;
  const mode = newTickets.mode;
  if (mode !== "off" && mode !== "assigned" && mode !== "all" && mode !== "epics") return null;
  if (!isObj(fields) || FIELD_KINDS.some((k) => typeof fields[k] !== "boolean")) return null;
  return {
    scope, mentions, assigned, status: checkedStatus, comments,
    newTickets: { mode, epics: [...newTickets.epics] },
    fields: Object.fromEntries(FIELD_KINDS.map((k) => [k, fields[k] as boolean])) as InboxRules["fields"],
  };
}
