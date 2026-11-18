import { assertEquals } from "jsr:@std/assert@1";
import { detectEvents, mentionsUser } from "./inbox_detect.ts";

const ME = "me";
const INSTALLED = "2026-11-13T09:00:00.000Z";
const ANA = { accountId: "ana", displayName: "Ana" };
const none = { commentIds: new Set<string>() };

// deno-lint-ignore no-explicit-any
type Raw = any;

function raw(over: { created?: string; histories?: Raw[]; comments?: Raw[] } = {}): Raw {
  return {
    key: "ABC-1",
    fields: { created: over.created ?? "2026-11-01T00:00:00.000+0000", comment: { comments: over.comments ?? [] } },
    changelog: { histories: over.histories ?? [] },
  };
}

const history = (id: string, created: string, author: Raw, items: Raw[]) => ({ id, created, author, items });
const status = (from: string, to: string) => ({ field: "status", fromString: from, toString: to });
const text = (t: string) => ({ type: "text", text: t });
const doc = (...content: Raw[]) => ({ type: "doc", version: 1, content });
const para = (...content: Raw[]) => ({ type: "paragraph", content });
const mention = (id: string) => ({ type: "mention", attrs: { id, text: "@someone" } });
const comment = (id: string, author: Raw, body: Raw, created = "2026-11-13T10:00:00.000+0000") => ({ id, author, body, created, updated: created });

Deno.test("a status change becomes one event with the names and the author", () => {
  const events = detectEvents(raw({ histories: [history("10", "2026-11-13T10:00:00.000+0000", ANA, [status("To Do", "In Review")])] }), none, ME, INSTALLED);
  assertEquals(events, [{
    id: "h:10:0", key: "ABC-1", kind: "status", at: "2026-11-13T10:00:00.000+0000", author: { id: "ana", name: "Ana" }, from: "To Do", to: "In Review",
  }]);
});

Deno.test("QA assignee and story point changes are recognised by field id, with story points shown without the trailing .0", () => {
  const fields = { qaAssignee: "customfield_20", storyPoints: "customfield_10" };
  const qa = { field: "QA Lead", fieldId: "customfield_20", fromString: "Bo", toString: "Cy" };
  const sp = { field: "Story point estimate", fieldId: "customfield_10", fromString: "3.0", toString: "5.0" };
  const events = detectEvents(raw({ histories: [history("10", "2026-11-13T10:00:00.000+0000", ANA, [qa, sp])] }), none, ME, INSTALLED, fields);
  assertEquals(events.map((e) => [e.kind, e.from, e.to]), [["qaAssignee", "Bo", "Cy"], ["points", "3", "5"]]);
});

Deno.test("without resolved fields the usual names are still recognised, and unestimated shows as none", () => {
  const qa = { field: "QA Assignee", fromString: null, toString: "Cy" };
  const sp = { field: "Story Points", fromString: "3.0", toString: null };
  const events = detectEvents(raw({ histories: [history("10", "2026-11-13T10:00:00.000+0000", ANA, [qa, sp])] }), none, ME, INSTALLED);
  assertEquals(events.map((e) => [e.kind, e.from, e.to]), [["qaAssignee", null, "Cy"], ["points", "3", null]]);
});

Deno.test("an unrelated custom field is ignored", () => {
  const other = { field: "Sprint", fieldId: "customfield_99", fromString: "1", toString: "2" };
  assertEquals(detectEvents(raw({ histories: [history("10", "2026-11-13T10:00:00.000+0000", ANA, [other])] }), none, ME, INSTALLED, { qaAssignee: "customfield_20" }), []);
});

Deno.test("the owner's own change is dropped while a colleague's change in the same issue is kept", () => {
  const events = detectEvents(
    raw({
      histories: [
        history("10", "2026-11-13T10:00:00.000+0000", { accountId: ME, displayName: "Me" }, [status("To Do", "Doing")]),
        history("11", "2026-11-13T10:05:00.000+0000", ANA, [status("Doing", "In Review")]),
      ],
    }),
    none, ME, INSTALLED,
  );
  assertEquals(events.map((e) => e.id), ["h:11:0"]);
});

Deno.test("a history with several items gives one event per item, and unmapped fields give none", () => {
  const events = detectEvents(
    raw({ histories: [history("10", "2026-11-13T10:00:00.000+0000", ANA, [status("A", "B"), { field: "Rank", fromString: null, toString: "Ranked higher" }, { field: "priority", fromString: "Medium", toString: "High" }, { field: "Link", fromString: null, toString: "This issue blocks ABC-2" }])] }),
    none, ME, INSTALLED,
  );
  assertEquals(events.map((e) => [e.id, e.kind]), [["h:10:0", "status"], ["h:10:2", "priority"], ["h:10:3", "links"]]);
});

Deno.test("a description edit by someone else gives a description event, the owner's own gives none", () => {
  const edit = (id: string, who: typeof ANA) => history(id, "2026-11-13T10:00:00.000+0000", who, [{ field: "description", fromString: "old", toString: "new" }]);
  const events = detectEvents(raw({ histories: [edit("20", ANA), edit("21", { accountId: ME, displayName: "Me" } as typeof ANA)] }), none, ME, INSTALLED);
  assertEquals(events.map((e) => [e.id, e.kind]), [["h:20:0", "description"]]);
});

Deno.test("history dated at or before the install time gives no events, whatever offset it is written in", () => {
  const before = history("10", "2026-11-13T04:59:59.000-0400", ANA, [status("A", "B")]); // 08:59:59Z
  const at = history("11", "2026-11-13T05:00:00.000-0400", ANA, [status("B", "C")]); // 09:00:00Z
  const after = history("12", "2026-11-13T05:00:01.000-0400", ANA, [status("C", "D")]); // 09:00:01Z
  assertEquals(detectEvents(raw({ histories: [before, at, after] }), none, ME, INSTALLED).map((e) => e.id), ["h:12:0"]);
});

Deno.test("a created event appears only for tickets created after the install time", () => {
  assertEquals(detectEvents(raw({ created: "2026-11-01T00:00:00.000+0000" }), none, ME, INSTALLED), []);
  const events = detectEvents(raw({ created: "2026-11-13T10:00:00.000+0000" }), none, ME, INSTALLED);
  assertEquals(events.map((e) => [e.id, e.kind, e.from, e.to]), [["new:ABC-1", "created", null, null]]);
});

Deno.test("a ticket the owner created gives no created event, whoever the Jira field names as its author", () => {
  const mine = (field: string) => {
    const r = raw({ created: "2026-11-13T10:00:00.000+0000" });
    r.fields[field] = { accountId: ME, displayName: "Me" };
    return r;
  };
  assertEquals(detectEvents(mine("creator"), none, ME, INSTALLED), []);
  assertEquals(detectEvents(mine("reporter"), none, ME, INSTALLED), []);
  const theirs = raw({ created: "2026-11-13T10:00:00.000+0000" });
  theirs.fields.reporter = ANA;
  assertEquals(detectEvents(theirs, none, ME, INSTALLED).map((e) => e.author), [{ id: "ana", name: "Ana" }]);
});

Deno.test("assignee changes say whether they point to the owner or away from them", () => {
  const toMe = { field: "assignee", from: null, to: ME, fromString: null, toString: "Me" };
  const fromMe = { field: "assignee", from: ME, to: "ana", fromString: "Me", toString: "Ana" };
  const other = { field: "assignee", from: "ana", to: "bob", fromString: "Ana", toString: "Bob" };
  const events = detectEvents(raw({ histories: [history("10", "2026-11-13T10:00:00.000+0000", ANA, [toMe, fromMe, other])] }), none, ME, INSTALLED);
  assertEquals(events.map((e) => e.assignment), ["to-me", "from-me", undefined]);
});

Deno.test("a new comment from someone else is an event with an excerpt, and the owner's own comment is not", () => {
  const events = detectEvents(
    raw({ comments: [comment("c1", ANA, doc(para(text("Please look at this"))))] .concat([comment("c2", { accountId: ME, displayName: "Me" }, doc(para(text("on it"))))]) }),
    none, ME, INSTALLED,
  );
  assertEquals(events.map((e) => [e.id, e.kind, e.excerpt, e.mentionsMe]), [["c:c1", "comment", "Please look at this", false]]);
});

Deno.test("a comment already in the mirror, and an edited old comment, give no event", () => {
  const old = comment("c1", ANA, doc(para(text("hi"))), "2026-11-12T10:00:00.000+0000");
  assertEquals(detectEvents(raw({ comments: [old] }), none, ME, INSTALLED), []);
  const fresh = comment("c2", ANA, doc(para(text("hi"))));
  assertEquals(detectEvents(raw({ comments: [fresh] }), { commentIds: new Set(["c2"]) }, ME, INSTALLED), []);
});

Deno.test("a mention of the owner inside a bullet list item or a quote counts, a mention of someone else does not", () => {
  const nested = doc({ type: "bulletList", content: [{ type: "listItem", content: [para(text("ping "), mention(ME))] }] });
  const quoted = doc({ type: "blockquote", content: [para(mention(ME))] });
  const other = doc(para(mention("bob")));
  assertEquals(mentionsUser(nested, ME), true);
  assertEquals(mentionsUser(quoted, ME), true);
  assertEquals(mentionsUser(other, ME), false);
  assertEquals(mentionsUser(null, ME), false);
  const events = detectEvents(raw({ comments: [comment("c1", ANA, nested), comment("c2", ANA, other)] }), none, ME, INSTALLED);
  assertEquals(events.map((e) => [e.id, e.mentionsMe]), [["c:c1", true], ["c:c2", false]]);
});

Deno.test("events come back oldest first and a long comment is cut to 160 characters", () => {
  const long = "x".repeat(300);
  const events = detectEvents(
    raw({ histories: [history("10", "2026-11-13T12:00:00.000+0000", ANA, [status("A", "B")])], comments: [comment("c1", ANA, doc(para(text(long))), "2026-11-13T11:00:00.000+0000")] }),
    none, ME, INSTALLED,
  );
  assertEquals(events.map((e) => e.id), ["c:c1", "h:10:0"]);
  assertEquals(events[0].excerpt, "x".repeat(160));
});
