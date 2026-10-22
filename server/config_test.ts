import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { loadJiraConfig, parseEnv, pollIntervalMs } from "./config.ts";

Deno.test("parseEnv handles comments, blanks, quotes, export and = in values", () => {
  const env = parseEnv([
    "# comment",
    "",
    "JIRA_EMAIL=a@b.com",
    'JIRA_API_TOKEN="tok=en=="',
    "export OTHER='x y'",
    "  SPACED = val # trailing",
  ].join("\n"));
  assertEquals(env, { JIRA_EMAIL: "a@b.com", JIRA_API_TOKEN: "tok=en==", OTHER: "x y", SPACED: "val" });
});

const BASE = "JIRA_EMAIL=a@b.com\nJIRA_API_TOKEN=t\nJIRA_LINEAR_BASE_URL=https://example.atlassian.net/\nJIRA_LINEAR_PROJECT=ABC";

Deno.test("loadJiraConfig reads the env file and adds the REST path to a bare site URL", () => {
  const c = loadJiraConfig(BASE, {});
  assertEquals(c.email, "a@b.com");
  assertEquals(c.apiToken, "t");
  assertEquals(c.baseUrl, "https://example.atlassian.net/rest/api/3");
  assertEquals(c.project, "ABC");
});

Deno.test("process env overrides the file, including a sandbox base URL and project", () => {
  const c = loadJiraConfig(BASE, {
    JIRA_EMAIL: "z@b.com",
    JIRA_LINEAR_BASE_URL: "http://127.0.0.1:9999/rest/api/3",
    JIRA_LINEAR_PROJECT: "SBX",
  });
  assertEquals([c.email, c.baseUrl, c.project], ["z@b.com", "http://127.0.0.1:9999/rest/api/3", "SBX"]);
});

Deno.test("missing credentials raise an error that never contains secret values", () => {
  const e = assertThrows(() => loadJiraConfig("JIRA_EMAIL=a@b.com", {}));
  assertEquals((e as Error).message.includes("a@b.com"), false);
  assertEquals((e as Error).message.includes("JIRA_API_TOKEN"), true);
});

import { projectRoot } from "./config.ts";

Deno.test("projectRoot decodes spaces in the file URL and ends with a slash", () => {
  assertEquals(
    projectRoot("file:///Users/a/Sony%20Music%20PDE/jira-linear/server/main.ts"),
    "/Users/a/Sony Music PDE/jira-linear/",
  );
});

Deno.test("the Jira poll interval defaults to five minutes and can be set in seconds", () => {
  assertEquals(pollIntervalMs({}), 300_000);
  assertEquals(pollIntervalMs({ JIRA_LINEAR_POLL_SECONDS: "900" }), 900_000);
});

Deno.test("a poll interval that is not a sensible number falls back, and never goes below 30 seconds", () => {
  assertEquals(pollIntervalMs({ JIRA_LINEAR_POLL_SECONDS: "soon" }), 300_000);
  assertEquals(pollIntervalMs({ JIRA_LINEAR_POLL_SECONDS: "-5" }), 300_000);
  assertEquals(pollIntervalMs({ JIRA_LINEAR_POLL_SECONDS: "5" }), 30_000);
});

Deno.test("the settings file fills in the site and project when the environment does not", () => {
  const c = loadJiraConfig("JIRA_EMAIL=a@b.com\nJIRA_API_TOKEN=t", {}, { site: "https://s.atlassian.net", project: "XYZ" });
  assertEquals([c.baseUrl, c.project], ["https://s.atlassian.net/rest/api/3", "XYZ"]);
});
