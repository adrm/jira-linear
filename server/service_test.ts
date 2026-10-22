import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { LABEL, renderPlist } from "./service.ts";

const opts = { deno: "/Users/me/.deno/bin/deno", root: "/Users/me/Documents/Sony Music PDE/jira-linear/" };

Deno.test("the launch agent starts the server at login and keeps it running", () => {
  const xml = renderPlist(opts);
  assertStringIncludes(xml, `<key>Label</key>\n\t<string>${LABEL}</string>`);
  assertStringIncludes(xml, "<key>RunAtLoad</key>\n\t<true/>");
  assertStringIncludes(xml, "<key>KeepAlive</key>\n\t<true/>");
  assertStringIncludes(xml, "<string>/Users/me/.deno/bin/deno</string>");
  assertStringIncludes(xml, "<string>server/main.ts</string>");
  assertStringIncludes(xml, "<key>WorkingDirectory</key>\n\t<string>/Users/me/Documents/Sony Music PDE/jira-linear</string>");
  assertStringIncludes(xml, "<string>/Users/me/Documents/Sony Music PDE/jira-linear/data/service.log</string>");
});

Deno.test("paths with XML characters are escaped", () => {
  const xml = renderPlist({ deno: "/a&b/deno", root: "/x<y>/" });
  assertStringIncludes(xml, "/a&amp;b/deno");
  assertStringIncludes(xml, "/x&lt;y&gt;");
});

Deno.test("the plist carries no credentials", () => {
  const xml = renderPlist(opts);
  assertEquals(/token|password|secret|EnvironmentVariables/i.test(xml), false);
});

Deno.test({ name: "the generated plist passes plutil -lint", ignore: Deno.build.os !== "darwin" }, async () => {
  const dir = await Deno.makeTempDir();
  const file = `${dir}/t.plist`;
  await Deno.writeTextFile(file, renderPlist(opts));
  const out = await new Deno.Command("plutil", { args: ["-lint", file] }).output();
  assertEquals(out.success, true, new TextDecoder().decode(out.stdout));
  await Deno.remove(dir, { recursive: true });
});
