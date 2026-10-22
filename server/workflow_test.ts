import { assertEquals } from "jsr:@std/assert@1";
import { buildWorkflow } from "./workflow.ts";

const s = (name: string, key: string) => ({ name, statusCategory: { key } });

Deno.test("buildWorkflow unions issue types and orders by category, then Jira's order", () => {
  const w = buildWorkflow([
    { statuses: [s("Done", "done"), s("In Progress", "indeterminate"), s("To Do", "new")] },
    { statuses: [s("Review", "indeterminate"), s("To Do", "new")] },
  ]);
  assertEquals(w.statuses.map((x) => x.name), ["To Do", "In Progress", "Review", "Done"]);
});

Deno.test("buildWorkflow applies the configured order and adds statuses seen on tickets", () => {
  const w = buildWorkflow([{ statuses: [s("A", "indeterminate"), s("B", "indeterminate")] }], { Legacy: "done" }, { order: ["b", "a"] });
  assertEquals(w.statuses.map((x) => x.name), ["B", "A", "Legacy"]);
});

Deno.test("buildWorkflow has generic backlog/canceled defaults that settings override", () => {
  assertEquals(buildWorkflow([]).backlog, ["Backlog"]);
  assertEquals(buildWorkflow([], {}, { backlog: ["Icebox"], canceled: ["Dropped"] }).canceled, ["Dropped"]);
});
