import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createJiraClient } from "./jira.ts";
import { projectHistory } from "./history.ts";
import { FAKE_FIELDS, FakeJira } from "./testing/fake_jira.ts";

const CATEGORIES = { Backlog: "new", "Ready for Dev": "new", "In Development": "indeterminate", "Code Review": "indeterminate", Cerrada: "done" };

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

Deno.test("projectHistory reports when each ticket was created, started and completed", () =>
  setup(async ({ fake, client }) => {
    fake.seed({ key: "ABC-10", issuetype: "Epic" });
    fake.seed({ key: "ABC-11", parent: "ABC-10", status: "Cerrada", created: t("01") });
    fake.setHistory("ABC-11", [{ at: t("02"), from: "Backlog", to: "In Development" }, { at: t("10"), from: "In Development", to: "Cerrada" }]);
    fake.setResolved("ABC-11", t("10"));
    fake.seed({ key: "ABC-12", parent: "ABC-10", status: "Backlog", created: t("01") });
    const h = await projectHistory(client, CATEGORIES, "ABC-10", "ABC", FAKE_FIELDS.storyPoints);
    assertEquals(h, [
      { key: "ABC-11", created: t("01"), started: t("02"), completed: t("10"), canceled: null, points: null },
      { key: "ABC-12", created: t("01"), started: null, completed: null, canceled: null, points: null },
    ]);
  }));

Deno.test("a ticket closed straight from the backlog counts as started when it was completed", () =>
  setup(async ({ fake, client }) => {
    fake.seed({ key: "ABC-10", issuetype: "Epic" });
    fake.seed({ key: "ABC-11", parent: "ABC-10", status: "Cerrada", created: t("01") });
    fake.setHistory("ABC-11", [{ at: t("05"), from: "Backlog", to: "Cerrada" }]);
    fake.setResolved("ABC-11", t("05"));
    const [x] = await projectHistory(client, CATEGORIES, "ABC-10", "ABC", FAKE_FIELDS.storyPoints);
    assertEquals([x.started, x.completed], [t("05"), t("05")]);
  }));

Deno.test("a ticket that was reopened is started but not completed", () =>
  setup(async ({ fake, client }) => {
    fake.seed({ key: "ABC-10", issuetype: "Epic" });
    fake.seed({ key: "ABC-11", parent: "ABC-10", status: "In Development", created: t("01") });
    fake.setHistory("ABC-11", [
      { at: t("02"), from: "Backlog", to: "In Development" },
      { at: t("04"), from: "In Development", to: "Cerrada" },
      { at: t("06"), from: "Cerrada", to: "In Development" },
    ]);
    const [x] = await projectHistory(client, CATEGORIES, "ABC-10", "ABC", FAKE_FIELDS.storyPoints);
    assertEquals([x.started, x.completed], [t("02"), null]);
  }));

Deno.test("only the project's own tickets are included, however many pages it takes", () =>
  setup(async ({ fake, client }) => {
    fake.pageCap = 2;
    fake.seed({ key: "ABC-10", issuetype: "Epic" });
    fake.seed({ key: "ABC-20", issuetype: "Epic" });
    for (let i = 1; i <= 5; i++) fake.seed({ key: `ABC-${100 + i}`, parent: "ABC-10" });
    fake.seed({ key: "ABC-200", parent: "ABC-20" });
    const h = await projectHistory(client, CATEGORIES, "ABC-10", "ABC", FAKE_FIELDS.storyPoints);
    assertEquals(h.map((x) => x.key), ["ABC-101", "ABC-102", "ABC-103", "ABC-104", "ABC-105"]);
  }));

Deno.test("projectHistory only accepts a ABC key", () =>
  setup(async ({ client }) => {
    await assertRejects(() => projectHistory(client, CATEGORIES, "OTH-1", "ABC"), Error, "project key");
  }));

Deno.test("story points are carried through", () =>
  setup(async ({ fake, client }) => {
    fake.seed({ key: "ABC-10", issuetype: "Epic" });
    fake.seed({ key: "ABC-11", parent: "ABC-10", status: "Backlog", created: t("01"), points: 8 });
    const [x] = await projectHistory(client, CATEGORIES, "ABC-10", "ABC", FAKE_FIELDS.storyPoints);
    assertEquals(x.points, 8);
  }));

Deno.test("a ticket closed as Won't Do left the scope instead of being completed", () =>
  setup(async ({ fake, client }) => {
    fake.seed({ key: "ABC-10", issuetype: "Epic" });
    fake.seed({ key: "ABC-11", parent: "ABC-10", status: "Cerrada", resolution: "Won't Do", created: t("01") });
    fake.setHistory("ABC-11", [{ at: t("10"), from: "Backlog", to: "Cerrada" }]);
    fake.setResolved("ABC-11", t("10"));
    const [x] = await projectHistory(client, CATEGORIES, "ABC-10", "ABC", FAKE_FIELDS.storyPoints);
    assertEquals([x.completed, x.canceled], [null, t("10")]);
  }));

Deno.test("a done ticket with an ordinary resolution or none is completed, not canceled", () =>
  setup(async ({ fake, client }) => {
    fake.seed({ key: "ABC-10", issuetype: "Epic" });
    fake.seed({ key: "ABC-11", parent: "ABC-10", status: "Cerrada", resolution: "Solucionada", created: t("01") });
    fake.setResolved("ABC-11", t("10"));
    fake.seed({ key: "ABC-12", parent: "ABC-10", status: "Cerrada", created: t("01") });
    fake.setResolved("ABC-12", t("11"));
    const h = await projectHistory(client, CATEGORIES, "ABC-10", "ABC", FAKE_FIELDS.storyPoints);
    assertEquals(h.map((x) => [x.completed !== null, x.canceled]), [[true, null], [true, null]]);
  }));
