/**
 * Optional local settings file (`jira-linear.config.json`, or the path in JIRA_LINEAR_CONFIG).
 * Everything in it is optional: without it the app works from the environment and what Jira reports.
 */
export interface Settings {
  /** Jira site, e.g. https://your-domain.atlassian.net (the JIRA_LINEAR_BASE_URL variable wins) */
  site?: string;
  /** Project key (the JIRA_LINEAR_PROJECT variable wins) */
  project?: string;
  /** Name shown in the sidebar; defaults to the key */
  projectName?: string;
  /** Env file with JIRA_EMAIL / JIRA_API_TOKEN; relative paths are from the project folder. The ENV_FILE variable wins. */
  envFile?: string;
  /** launchd label for `service:install` */
  serviceLabel?: string;
  /** Jira field names or ids; names are looked up through Jira's field list, an id (customfield_123) is used as is */
  fields?: { storyPoints?: string; quarter?: string; initialEstimate?: string; revisedEstimate?: string };
  /** Names that depend on the Jira site and its language; each key replaces its default list */
  vocab?: {
    /** priority name -> rank 0 (lowest) to 4 (highest); unlisted priorities count as 2 */
    priorities?: Record<string, number>;
    /** issue types shown as Bug (case-insensitive) */
    bugTypes?: string[];
    /** issue types shown as Spike (case-insensitive) */
    spikeTypes?: string[];
    /** issue types that are sub-tasks, as Jira names them */
    subtaskTypes?: string[];
    /** issue types that are not tickets of their own and are left out of the type picker, as Jira names them */
    nonTicketTypes?: string[];
  };
  workflow?: {
    /** status names from least to most advanced; statuses not listed keep Jira's order within their category */
    order?: string[];
    /** statuses that mean "not planned yet" */
    backlog?: string[];
    /** statuses in Jira's done category that mean "dropped" rather than "finished" */
    canceled?: string[];
    /** [hue, chroma] per status name, overriding the generated colour */
    colors?: Record<string, [number, number]>;
  };
}

export function parseSettings(text: string): Settings {
  if (!text.trim()) return {};
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new Error(`jira-linear.config.json is not valid JSON: ${(e as Error).message}`);
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("jira-linear.config.json must contain a JSON object");
  return v as Settings;
}

export function settingsPath(root: string, env: Record<string, string | undefined>): string {
  return env.JIRA_LINEAR_CONFIG ?? `${root}jira-linear.config.json`;
}

export function readSettingsSync(root: string, env: Record<string, string | undefined>): Settings {
  try {
    return parseSettings(Deno.readTextFileSync(settingsPath(root, env)));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return {};
    throw e;
  }
}
