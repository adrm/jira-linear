import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useStore } from "zustand";
import type { Issue } from "@shared/types";
import type { AppState, AppStore, } from "../store/store";
import { viewIssues } from "../store/store";
import { targetsOf, type UiState, type UiStore } from "../store/ui";
import type { SettingsState, SettingsStore } from "../store/settings";
import { applyView, searchIssues } from "../lib/query";
import { applyFilters, type Filter } from "../lib/filters";
import { buildGroups, displayFor, type Display, type IssueGroup } from "../lib/layout";
import { buildProjectGroups, DEFAULT_PROJECTS_DISPLAY, groupProjects, listProjects, type ProjectGroup, type ProjectStats, type ProjectsDisplay } from "../lib/projects";
import { startedFractions } from "../lib/rowdetails";

export interface Ctx {
  app: AppStore;
  ui: UiStore;
  settings: SettingsStore;
  fetchFn: typeof fetch;
  /** tickets marked for team review (key -> when). Stored on this computer only, never in Jira. */
  review: Record<string, string>;
  setReview: (keys: string[], marked: boolean) => void;
  jiraUrl: string;
  openExternal: (url: string) => void;
  copyText: (text: string) => Promise<void>;
  me: { id: string; name: string } | null;
}

const C = createContext<Ctx | null>(null);

export function CtxProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useCtx(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("CtxProvider missing");
  return c;
}
export function useApp<T>(sel: (s: AppState) => T): T {
  return useStore(useCtx().app, sel);
}
export function useSettings<T>(sel: (s: SettingsState) => T): T {
  return useStore(useCtx().settings, sel);
}
export function useUi<T>(sel: (s: UiState) => T): T {
  return useStore(useCtx().ui, sel);
}

/** Server truth with pending mutations applied. */
export function useIssueMap(): Record<string, Issue> {
  const issues = useApp((s) => s.issues);
  const pending = useApp((s) => s.pending);
  return useMemo(() => viewIssues({ issues, pending }), [issues, pending]);
}

const NO_FILTERS: Filter[] = [];

export function useDisplay(): Display {
  const view = useUi((s) => s.view);
  const override = useSettings((s) => s.displayByView[view]);
  return useMemo(() => ({ ...displayFor(view), ...override }), [view, override]);
}

export function useFilters(): Filter[] {
  return useUi((s) => s.filtersByView[s.view]) ?? NO_FILTERS;
}

/** Tickets in the current view before filters, search and grouping (what the filter menu counts against). */
export function useViewIssues(): Issue[] {
  const map = useIssueMap();
  const view = useUi((s) => s.view);
  const { me, review } = useCtx();
  return useMemo(() => applyView(Object.values(map), view, { meId: me?.id ?? null, now: new Date(), review }), [map, view, me, review]);
}

export interface Visible {
  groups: IssueGroup[];
  /** keys in on-screen order, skipping folded groups, each once */
  order: string[];
  total: number;
  display: Display;
  filters: Filter[];
  /** one list of keys per group, for board navigation */
  columns: string[][];
}

export function useVisible(): Visible {
  const map = useIssueMap();
  const inView = useViewIssues();
  const view = useUi((s) => s.view);
  const search = useUi((s) => s.search);
  const collapsed = useUi((s) => s.collapsedGroups);
  const display = useDisplay();
  const filters = useFilters();
  return useMemo(() => {
    const hits = searchIssues(applyFilters(inView, filters), search);
    const effective = display.layout === "board" && display.groupBy === "none" ? { ...display, groupBy: "status" as const } : display;
    const groups = buildGroups(hits, effective, { all: Object.values(map), now: new Date() });
    const shown = display.layout === "board" ? groups : groups.filter((g) => !collapsed.includes(`${view}|${g.id}`));
    const seen = new Set<string>();
    const order = shown.flatMap((g) => g.issues.map((i) => i.key)).filter((k) => (seen.has(k) ? false : (seen.add(k), true)));
    const total = new Set(groups.flatMap((g) => g.issues.map((i) => i.key))).size;
    return { groups, order, total, display, filters, columns: groups.map((g) => g.issues.map((i) => i.key)) };
  }, [map, inView, view, search, collapsed, display, filters]);
}

/** Story points assumed for tickets without an estimate (a setting, 3 unless changed). */
export function useDefaultPoints(): number {
  return useSettings((s) => s.defaultStoryPoints);
}

export function useProjectsDisplay(): ProjectsDisplay {
  const override = useSettings((s) => s.projectsDisplay);
  return useMemo(() => ({ ...DEFAULT_PROJECTS_DISPLAY, ...override }), [override]);
}

/** The project list as the display options show it, narrowed by the search box. */
export function useProjects(): { groups: ProjectGroup[]; order: string[]; total: number; shown: ProjectStats[] } {
  const map = useIssueMap();
  const display = useProjectsDisplay();
  const defaultPoints = useDefaultPoints();
  const search = useUi((s) => (s.view === "projects" ? s.search : ""));
  return useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = listProjects(Object.values(map), new Date(), { defaultPoints }).filter((p) => !q || `${p.key} ${p.name}`.toLowerCase().includes(q));
    const groups = buildProjectGroups(all, display, new Date());
    const order = groups.flatMap((g) => g.projects.map((p) => p.key));
    const shown = [...new Map(groups.flatMap((g) => g.projects).map((p) => [p.key, p])).values()];
    return { groups, order, total: order.length, shown };
  }, [map, search, display, defaultPoints]);
}

/** The project lists the sidebar shows: in progress (top 7), ongoing [PERMANENT] ones, and every project by key for favorites. */
export function useSidebarProjects(limit = 7) {
  const map = useIssueMap();
  const defaultPoints = useDefaultPoints();
  return useMemo(() => {
    const all = listProjects(Object.values(map), new Date(), { defaultPoints });
    const groups = groupProjects(all);
    const pick = (label: string) => groups.find((g) => g.label === label)?.projects ?? [];
    return { all, active: pick("In progress").slice(0, limit), ongoing: pick("Ongoing") };
  }, [map, limit, defaultPoints]);
}

/** Keys in the order they are displayed in the current view (projects or tickets). */
export function useOrder(): string[] {
  const view = useUi((s) => s.view);
  const tickets = useVisible();
  const projects = useProjects();
  const tab = useUi((s) => s.projectTab);
  if (view.startsWith("project:") && tab === "overview") return [];
  return view === "projects" ? projects.order : tickets.order;
}

/** Keys an action applies to right now: explicit target, ticked rows, else the cursor row. */
export function useTargets(): string[] {
  const overlay = useUi((s) => s.overlay);
  const selection = useUi((s) => s.selection);
  const selectedKey = useUi((s) => s.selectedKey);
  return useMemo(() => targetsOf({ overlay, selection, selectedKey }), [overlay, selection, selectedKey]);
}

export function useTargetIssues(): Issue[] {
  const keys = useTargets();
  const map = useIssueMap();
  return useMemo(() => keys.map((k) => map[k]).filter((i): i is Issue => !!i), [keys, map]);
}

/** How full each started status icon is, for tickets and for projects (they have different workflows). */
export function useStatusFractions(): { tickets: Record<string, number>; projects: Record<string, number> } {
  const map = useIssueMap();
  return useMemo(() => {
    const all = Object.values(map);
    return { tickets: startedFractions(all), projects: startedFractions(all, true) };
  }, [map]);
}
