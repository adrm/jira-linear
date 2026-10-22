/** Which Jira project this is, as the server reports it (`/api/config`); set once before the first render. */
export const site = { project: "", name: "", jiraUrl: "" };

export function configureSite(cfg: { project: string; projectName?: string; siteUrl?: string }) {
  site.project = cfg.project;
  site.name = cfg.projectName ?? cfg.project;
  site.jiraUrl = cfg.siteUrl ?? "";
}
