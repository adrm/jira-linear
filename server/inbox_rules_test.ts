import { assertEquals } from "jsr:@std/assert@1";
import { DEFAULT_RULES, type InboxEvent, type InboxRules } from "../shared/inbox.ts";
import type { Issue } from "../shared/types.ts";
import { isInvolved, shouldNotify, validateRules } from "./inbox_rules.ts";

const ME = "me";

function issue(over: Partial<Issue> = {}): Issue {
  return {
    key: "ABC-1", id: "1", project: "ABC", summary: "S", descriptionAdf: null, status: "Backlog", statusCategory: "new",
    issuetype: "Task", priority: "Medium", assignee: null, qaAssignees: [], reporter: null, parentKey: null, parentSummary: null,
    labels: [], duedate: null, created: "2026-11-01T00:00:00.000+0000", updated: "2026-11-01T00:00:00.000+0000", links: [],
    quarter: null, initialEstimate: null, revisedEstimate: null, statusChanged: null, storyPoints: null, resolution: null, ...over,
  };
}

function event(over: Partial<InboxEvent> = {}): InboxEvent {
  return { id: "e1", key: "ABC-1", kind: "status", at: "2026-11-13T10:00:00.000+0000", author: { id: "ana", name: "Ana" }, from: "To Do", to: "In Review", ...over };
}

const rules = (over: Partial<InboxRules> = {}): InboxRules => ({ ...structuredClone(DEFAULT_RULES), ...over });
const notify = (ev: InboxEvent, r: InboxRules, involved: boolean, i: Issue = issue()) => shouldNotify(ev, i, r, involved, ME);

Deno.test("a comment that mentions me is delivered on a ticket I am not involved in", () => {
  assertEquals(notify(event({ kind: "comment", mentionsMe: true }), rules(), false), true);
  assertEquals(notify(event({ kind: "comment", mentionsMe: true }), rules({ mentions: false, comments: "off" }), false), false);
});

Deno.test("assignment to me and from me is delivered whatever the scope, and other assignee changes are not", () => {
  assertEquals(notify(event({ kind: "assignee", assignment: "to-me" }), rules(), false), true);
  assertEquals(notify(event({ kind: "assignee", assignment: "from-me" }), rules(), false), true);
  assertEquals(notify(event({ kind: "assignee", assignment: "to-me" }), rules({ assigned: false }), true), false);
  assertEquals(notify(event({ kind: "assignee" }), rules({ scope: "project" }), true), false);
});

Deno.test("a status change on a ticket I am not involved in follows the scope", () => {
  assertEquals(notify(event(), rules({ scope: "involved" }), false), false);
  assertEquals(notify(event(), rules({ scope: "involved" }), true), true);
  assertEquals(notify(event(), rules({ scope: "project" }), false), true);
});

Deno.test("status rule: off drops everything, into delivers only the ticked statuses", () => {
  assertEquals(notify(event(), rules({ status: { mode: "off" } }), true), false);
  const into = rules({ status: { mode: "into", statuses: ["In Review"] } });
  assertEquals(notify(event({ to: "In Review" }), into, true), true);
  assertEquals(notify(event({ to: "Done" }), into, true), false);
});

Deno.test("comments rule: all follows the scope, mentions delivers only mentions, off delivers none", () => {
  const plain = event({ kind: "comment" });
  assertEquals(notify(plain, rules({ comments: "all" }), true), true);
  assertEquals(notify(plain, rules({ comments: "all" }), false), false);
  assertEquals(notify(plain, rules({ comments: "mentions", scope: "project" }), true), false);
  assertEquals(notify(event({ kind: "comment", mentionsMe: true }), rules({ mentions: false, comments: "mentions" }), true), true);
  assertEquals(notify(plain, rules({ comments: "off" }), true), false);
});

Deno.test("new tickets follow their own rule and ignore the scope", () => {
  const created = event({ kind: "created", from: null, to: null });
  const epics = rules({ scope: "involved", newTickets: { mode: "epics", epics: ["ABC-9"] } });
  assertEquals(notify(created, epics, false, issue({ parentKey: "ABC-9" })), true);
  assertEquals(notify(created, epics, false, issue({ parentKey: "ABC-8" })), false);
  assertEquals(notify(created, epics, false, issue({ parentKey: null })), false);
  const assigned = rules({ newTickets: { mode: "assigned", epics: [] } });
  assertEquals(notify(created, assigned, false, issue({ assignee: { id: ME, name: "Me" } })), true);
  assertEquals(notify(created, assigned, false, issue({ assignee: { id: "ana", name: "Ana" } })), false);
  assertEquals(notify(created, rules({ newTickets: { mode: "all", epics: [] } }), false), true);
  assertEquals(notify(created, rules({ newTickets: { mode: "off", epics: [] } }), true), false);
});

Deno.test("field changes are dropped by default and delivered when their flag is on", () => {
  const ev = event({ kind: "priority", from: "Medium", to: "High" });
  assertEquals(notify(ev, rules(), true), false);
  assertEquals(notify(ev, rules({ fields: { ...DEFAULT_RULES.fields, priority: true } }), true), true);
  assertEquals(notify(ev, rules({ scope: "involved", fields: { ...DEFAULT_RULES.fields, priority: true } }), false), false);
});

Deno.test("isInvolved is true for assignee, reporter, QA assignee, watching and commented, and false otherwise", () => {
  assertEquals(isInvolved(issue(), ME, false, false), false);
  assertEquals(isInvolved(issue({ assignee: { id: ME, name: "Me" } }), ME, false, false), true);
  assertEquals(isInvolved(issue({ reporter: { id: ME, name: "Me" } }), ME, false, false), true);
  assertEquals(isInvolved(issue({ qaAssignees: [{ id: "x", name: "X" }, { id: ME, name: "Me" }] }), ME, false, false), true);
  assertEquals(isInvolved(issue(), ME, true, false), true);
  assertEquals(isInvolved(issue(), ME, false, true), true);
  assertEquals(isInvolved(issue({ assignee: { id: "ana", name: "Ana" } }), ME, false, false), false);
});

Deno.test("validateRules accepts the defaults and rejects malformed rules", () => {
  assertEquals(validateRules(DEFAULT_RULES), DEFAULT_RULES);
  const bad = (patch: Record<string, unknown>) => validateRules({ ...structuredClone(DEFAULT_RULES), ...patch });
  assertEquals(validateRules(null), null);
  assertEquals(validateRules("rules"), null);
  assertEquals(bad({ scope: "everything" }), null);
  assertEquals(bad({ mentions: "yes" }), null);
  assertEquals(bad({ status: { mode: "into", statuses: [] } }), null);
  assertEquals(bad({ status: { mode: "into", statuses: [3] } }), null);
  assertEquals(bad({ status: { mode: "sometimes" } }), null);
  assertEquals(bad({ comments: "some" }), null);
  assertEquals(bad({ newTickets: { mode: "epics", epics: "ABC-1" } }), null);
  assertEquals(bad({ newTickets: { mode: "everything", epics: [] } }), null);
  assertEquals(bad({ fields: { ...DEFAULT_RULES.fields, priority: "on" } }), null);
  assertEquals(bad({ fields: { priority: true } }), null);
  const withoutScope: Record<string, unknown> = structuredClone(DEFAULT_RULES) as unknown as Record<string, unknown>;
  delete withoutScope.scope;
  assertEquals(validateRules(withoutScope), null);
});
