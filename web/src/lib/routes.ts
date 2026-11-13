import type { View } from "../store/ui";

/** Where the app is, as far as the address bar is concerned. */
export interface Route {
  view: View;
  tab: "overview" | "issues";
  issue: string | null;
  savedView: string | null;
}

const LISTS = ["inbox", "backlog", "mine", "created", "review", "all", "projects"] as const;
const HOME: Route = { view: "active", tab: "overview", issue: null, savedView: null };

/** `/`, `/backlog`, `/projects/KEY`, `/projects/KEY/issues`, `/issue/KEY`, `/views/ID`; anything else is home. */
export function parsePath(pathname: string): Route {
  let seg: string[];
  try {
    seg = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return HOME;
  }
  const [a, b, c] = seg;
  if (!a) return HOME;
  if (seg.length === 1 && (LISTS as readonly string[]).includes(a)) return { ...HOME, view: a as View };
  if (seg.length === 1 && a === "active") return HOME;
  if (a === "projects" && b && seg.length <= 3 && (c === undefined || c === "issues")) {
    return { ...HOME, view: `project:${b}`, tab: c ? "issues" : "overview" };
  }
  if (a === "issue" && b && seg.length === 2) return { ...HOME, issue: b };
  if (a === "views" && b && seg.length === 2) return { ...HOME, savedView: b };
  return HOME;
}

export function formatPath(r: Route): string {
  if (r.issue) return `/issue/${encodeURIComponent(r.issue)}`;
  if (r.savedView) return `/views/${encodeURIComponent(r.savedView)}`;
  if (r.view === "active") return "/";
  if (r.view.startsWith("project:")) {
    const key = encodeURIComponent(r.view.slice(8));
    return r.tab === "issues" ? `/projects/${key}/issues` : `/projects/${key}`;
  }
  return `/${r.view}`;
}
