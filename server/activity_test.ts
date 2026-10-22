import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { issueActivity } from "./activity.ts";
import { createJiraClient } from "./jira.ts";
import { FakeJira } from "./testing/fake_jira.ts";

async function setup(fn: (c: { fake: FakeJira; client: ReturnType<typeof createJiraClient> }) => Promise<void>) {
  const fake = new FakeJira().start();
  const client = createJiraClient({ baseUrl: fake.baseUrl, email: "test@example.com", apiToken: "test-token", sleep: () => Promise.resolve() });
  try {
    await fn({ fake, client });
  } finally {
    await fake.stop();
  }
}
const t = (d: string) => `2026-09-${d}T10:00:00.000+0000`;
const ana = { accountId: "u1", displayName: "Ana" };

Deno.test("issueActivity returns the changes people care about, oldest first, with who made them", () =>
  setup(async ({ fake, client }) => {
    fake.seed({ key: "ABC-1" });
    fake.setHistory("ABC-1", [
      { at: t("05"), field: "assignee", from: "", to: "Ana", author: ana },
      { at: t("02"), field: "status", from: "Backlog", to: "In Development", author: ana },
      { at: t("03"), field: "resolution", from: "", to: "Done", author: ana }, // not interesting
    ]);
    const a = await issueActivity(client, "ABC-1", "ABC");
    assertEquals(a.map((e) => [e.field, e.from, e.to, e.author?.name]), [
      ["status", "Backlog", "In Development", "Ana"],
      ["assignee", null, "Ana", "Ana"],
    ]);
    assertEquals(a[0].at, t("02"));
  }));

Deno.test("issueActivity follows the changelog across pages", () =>
  setup(async ({ fake, client }) => {
    fake.pageCap = 2;
    fake.seed({ key: "ABC-1" });
    fake.setHistory("ABC-1", [1, 2, 3, 4, 5].map((n) => ({ at: t(`0${n}`), field: "priority", from: `P${n}`, to: `P${n + 1}`, author: ana })));
    const a = await issueActivity(client, "ABC-1", "ABC");
    assertEquals(a.length, 5);
    assertEquals(a.map((e) => e.from), ["P1", "P2", "P3", "P4", "P5"]);
  }));

Deno.test("issueActivity gives every entry a stable id", () =>
  setup(async ({ fake, client }) => {
    fake.seed({ key: "ABC-1" });
    fake.setHistory("ABC-1", [{ at: t("02"), field: "status", from: "A", to: "B" }, { at: t("03"), field: "status", from: "B", to: "C" }]);
    const a = await issueActivity(client, "ABC-1", "ABC");
    assertEquals(new Set(a.map((e) => e.id)).size, 2);
    assertEquals(a[0].author, null);
  }));

Deno.test("issueActivity only accepts a ABC key", () =>
  setup(async ({ client }) => {
    await assertRejects(() => issueActivity(client, "OTH-1", "ABC"), Error, "key");
  }));
