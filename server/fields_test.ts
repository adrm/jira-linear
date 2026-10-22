import { assertEquals } from "jsr:@std/assert@1";
import { issueFieldList, resolveFields } from "./fields.ts";

const ALL = [
  { id: "summary", name: "Summary" },
  { id: "customfield_1", name: "Story Points" },
  { id: "customfield_2", name: "Quarter" },
  { id: "customfield_3", name: "Initial Estimate" },
];

Deno.test("resolveFields finds the usual names and leaves out what the site does not have", () => {
  assertEquals(resolveFields(ALL), { storyPoints: "customfield_1", quarter: "customfield_2", initialEstimate: "customfield_3" });
});

Deno.test("resolveFields prefers what the settings name, by id or by field name", () => {
  const f = resolveFields(ALL, { storyPoints: "customfield_99", quarter: "STORY POINTS", revisedEstimate: "Nope" });
  assertEquals(f, { storyPoints: "customfield_99", quarter: "customfield_1", initialEstimate: "customfield_3" });
});

Deno.test("issueFieldList always has the core fields plus the resolved ones", () => {
  const l = issueFieldList({ storyPoints: "customfield_1" });
  assertEquals(l.includes("status") && l.includes("customfield_1"), true);
  assertEquals(l.some((x) => x.startsWith("customfield_2")), false);
});
