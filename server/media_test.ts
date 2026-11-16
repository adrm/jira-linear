import { assert, assertEquals } from "jsr:@std/assert@1";
import { createMediaResolver } from "./media.ts";
import { createJiraClient } from "./jira.ts";
import { FakeJira } from "./testing/fake_jira.ts";

const TOKEN = "t0ken-value";

async function setup(fn: (c: { fake: FakeJira; client: ReturnType<typeof createJiraClient> }) => Promise<void>) {
  const fake = new FakeJira("test@example.com", TOKEN).start();
  const client = createJiraClient({ baseUrl: fake.baseUrl, email: "test@example.com", apiToken: TOKEN, sleep: () => Promise.resolve() });
  try {
    await fn({ fake, client });
  } finally {
    await fake.stop();
  }
}

Deno.test("an attachment is found by the media id of its content address", () =>
  setup(async ({ fake, client }) => {
    fake.seed({ key: "ABC-1" });
    const a = fake.attach("ABC-1", { filename: "a.png" });
    const b = fake.attach("ABC-1", { filename: "b.png" });
    const media = createMediaResolver(client);
    assertEquals((await media.resolve("ABC-1", b.mediaId))?.id, b.id);
    assertEquals((await media.resolve("ABC-1", a.mediaId.toUpperCase()))?.id, a.id);
    assertEquals(await media.resolve("ABC-1", crypto.randomUUID()), null);
  }));

Deno.test("each attachment is looked up once", () =>
  setup(async ({ fake, client }) => {
    fake.seed({ key: "ABC-1" });
    const a = fake.attach("ABC-1", { filename: "a.png" });
    const media = createMediaResolver(client);
    await media.resolve("ABC-1", a.mediaId);
    await media.resolve("ABC-1", a.mediaId);
    assertEquals(fake.requests.filter((r) => r.path.startsWith("/attachment/content/")).length, 1);
  }));

Deno.test("migrated content names the file instead of a media id", () =>
  setup(async ({ fake, client }) => {
    fake.seed({ key: "ABC-1" });
    const a = fake.attach("ABC-1", { filename: "Screenshot 1.png" });
    const media = createMediaResolver(client);
    assertEquals((await media.resolve("ABC-1", "UNKNOWN_MEDIA_Screenshot 1.png"))?.id, a.id);
    assertEquals(await media.resolve("ABC-1", "UNKNOWN_MEDIA_other.png"), null);
  }));

Deno.test("falls back to the alt text as file name when the media id cannot be read", () =>
  setup(async ({ fake, client }) => {
    fake.hideMediaIds = true;
    fake.seed({ key: "ABC-1" });
    const a = fake.attach("ABC-1", { filename: "shot.png" });
    const media = createMediaResolver(client);
    assertEquals(await media.resolve("ABC-1", crypto.randomUUID()), null);
    assertEquals((await media.resolve("ABC-1", crypto.randomUUID(), "shot.png"))?.id, a.id);
  }));

Deno.test("a file attached a moment ago is found after the list is refreshed", () =>
  setup(async ({ fake, client }) => {
    fake.seed({ key: "ABC-1" });
    let t = 0;
    const media = createMediaResolver(client, () => t);
    assertEquals(await media.resolve("ABC-1", crypto.randomUUID()), null);
    const late = fake.attach("ABC-1", { filename: "late.png" });
    t = 10_000;
    assert((await media.resolve("ABC-1", late.mediaId))?.id === late.id);
  }));
