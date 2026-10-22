export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.replace(/^export\s+/, "").match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.lastIndexOf(q) > 0) {
      v = v.slice(1, v.lastIndexOf(q));
    } else {
      v = v.replace(/\s+#.*$/, "");
    }
    out[m[1]] = v;
  }
  return out;
}

export interface JiraConfig {
  email: string;
  apiToken: string;
  baseUrl: string;
  project: string;
}


export function loadJiraConfig(
  envFileText: string,
  processEnv: Record<string, string | undefined>,
  settings: { site?: string; project?: string } = {},
): JiraConfig {
  const file = parseEnv(envFileText);
  const get = (k: string) => processEnv[k] ?? file[k];
  const email = get("JIRA_EMAIL");
  const apiToken = get("JIRA_API_TOKEN");
  const site = get("JIRA_LINEAR_BASE_URL") ?? settings.site;
  const project = get("JIRA_LINEAR_PROJECT") ?? settings.project;
  const missing = [!email && "JIRA_EMAIL", !apiToken && "JIRA_API_TOKEN", !site && "JIRA_LINEAR_BASE_URL", !project && "JIRA_LINEAR_PROJECT"].filter(Boolean);
  if (missing.length) throw new Error(`Missing required settings: ${missing.join(", ")}`);
  return {
    email: email!,
    apiToken: apiToken!,
    baseUrl: /\/rest\/api\//.test(site!) ? site! : `${site!.replace(/\/+$/, "")}/rest/api/3`,
    project: project!,
  };
}

/** Project root (the folder above server/) from an `import.meta.url`, with %20 etc. decoded. */
export function projectRoot(importMetaUrl: string): string {
  const dir = decodeURIComponent(new URL("..", importMetaUrl).pathname);
  return dir.endsWith("/") ? dir : dir + "/";
}

/** How often to ask Jira for changes: five minutes unless JIRA_LINEAR_POLL_SECONDS says otherwise (minimum 30 s). */
export function pollIntervalMs(env: Record<string, string | undefined>): number {
  const n = Number(env.JIRA_LINEAR_POLL_SECONDS);
  if (!Number.isFinite(n) || n <= 0) return 300_000;
  return Math.max(30, n) * 1000;
}
