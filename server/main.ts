import { createApp } from "./app.ts";
import { loadJiraConfig, pollIntervalMs, projectRoot } from "./config.ts";
import { openStore } from "./db.ts";
import { discoverFields, type FieldIds } from "./fields.ts";
import { createJiraClient } from "./jira.ts";
import { readSettingsSync } from "./settings.ts";

const ROOT = projectRoot(import.meta.url);
const settings = readSettingsSync(ROOT, Deno.env.toObject());
const resolvePath = (p: string) => (p.startsWith("/") ? p : `${ROOT}${p}`);
const ENV_FILE = Deno.env.get("ENV_FILE") ?? resolvePath(settings.envFile ?? ".env");
const PORT = Number(Deno.env.get("PORT") ?? 8766);
const POLL_MS = pollIntervalMs(Deno.env.toObject());
const RECONCILE_MS = 6 * 60 * 60 * 1000;

const envText = await Deno.readTextFile(ENV_FILE).catch(() => {
  console.warn(`Could not read ${ENV_FILE}; relying on environment variables only.`);
  return "";
});
const cfg = loadJiraConfig(envText, Deno.env.toObject(), settings);
const client = createJiraClient({ baseUrl: cfg.baseUrl, email: cfg.email, apiToken: cfg.apiToken });

await Deno.mkdir(`${ROOT}data`, { recursive: true });
const store = openStore(`${ROOT}data/mirror.db`);
const fields: FieldIds = {};
Object.assign(fields, await discoverFields(client, settings.fields).catch((e) => {
  console.warn(`Could not look up Jira fields (${e.message}); story points, quarter and estimates stay hidden until restart.`);
  return {};
}));
const app = createApp({
  store, project: cfg.project, projectName: settings.projectName, siteUrl: new URL(cfg.baseUrl).origin, client, fields,
  workflow: settings.workflow, vocab: settings.vocab, staticDir: `${ROOT}web/dist`,
});

Deno.serve({ hostname: "127.0.0.1", port: PORT }, (req) => app.handler(req));
console.log(`jira-linear: http://localhost:${PORT}  (project ${cfg.project}, ${new URL(cfg.baseUrl).host}, checking Jira every ${POLL_MS / 1000}s)`);

await app.tick();
setInterval(() => void app.tick(), POLL_MS);
setInterval(() => void app.reconcile().catch((e) => console.error("reconcile failed:", e.message)), RECONCILE_MS);
