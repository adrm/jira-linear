import { createStore } from "zustand/vanilla";
import type { Filter } from "../lib/filters";
import { DEFAULT_PROJECTS_DISPLAY, type ProjectsDisplay } from "../lib/projects";
import { DEFAULT_STORY_POINTS } from "../lib/points";
import { ALL_PROPS, displayFor, type Display } from "../lib/layout";

export type Theme = "system" | "light" | "dark";
export type Contrast = "normal" | "high";
export type Density = "comfortable" | "compact";

export interface SavedView {
  id: string;
  name: string;
  /** the view it was made from, e.g. "active" or "project:ABC-1" */
  view: string;
  filters: Filter[];
  display: Display;
}

const LAYOUTS = ["list", "board"];
const GROUPS = ["status", "assignee", "project", "priority", "label", "type", "none"];
const ORDERS = ["status", "priority", "updated", "created", "due"];
const WINDOWS = ["none", "week", "month", "all"];

/** Keep only the parts of a stored display object that are valid; the rest falls back to the view's defaults. */
function sanitizeDisplay(raw: unknown): Partial<Display> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<Display> = {};
  if (LAYOUTS.includes(r.layout as string)) out.layout = r.layout as Display["layout"];
  if (GROUPS.includes(r.groupBy as string)) out.groupBy = r.groupBy as Display["groupBy"];
  if (ORDERS.includes(r.orderBy as string)) out.orderBy = r.orderBy as Display["orderBy"];
  if (typeof r.reverse === "boolean") out.reverse = r.reverse;
  if (typeof r.showSubIssues === "boolean") out.showSubIssues = r.showSubIssues;
  if (typeof r.showEmptyGroups === "boolean") out.showEmptyGroups = r.showEmptyGroups;
  if (WINDOWS.includes(r.completed as string)) out.completed = r.completed as Display["completed"];
  if (Array.isArray(r.props)) out.props = (r.props as string[]).filter((p) => (ALL_PROPS as string[]).includes(p)) as Display["props"];
  return out;
}

const PROJECT_GROUPS = ["status", "lead", "quarter", "none"];
const PROJECT_ORDERS = ["updated", "name", "progress", "target"];

function sanitizeProjectsDisplay(raw: unknown): Partial<ProjectsDisplay> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<ProjectsDisplay> = {};
  if (LAYOUTS.includes(r.layout as string)) out.layout = r.layout as ProjectsDisplay["layout"];
  if (PROJECT_GROUPS.includes(r.groupBy as string)) out.groupBy = r.groupBy as ProjectsDisplay["groupBy"];
  if (PROJECT_ORDERS.includes(r.orderBy as string)) out.orderBy = r.orderBy as ProjectsDisplay["orderBy"];
  if (typeof r.reverse === "boolean") out.reverse = r.reverse;
  if (WINDOWS.includes(r.completed as string)) out.completed = r.completed as ProjectsDisplay["completed"];
  return out;
}

export interface SettingsState {
  theme: Theme;
  contrast: Contrast;
  density: Density;
  sidebarCollapsed: boolean;
  projectSidebarOpen: boolean;
  /** ids such as "project:ABC-1" or "view:<id>" */
  favorites: string[];
  /** sidebar section ids that are folded away */
  foldedSections: string[];
  /** per-view overrides of the display options */
  displayByView: Record<string, Partial<Display>>;
  savedViews: SavedView[];
  projectsDisplay: Partial<ProjectsDisplay>;
  /** story points assumed for tickets that have none */
  defaultStoryPoints: number;
  setDefaultStoryPoints(n: number): void;
  set(patch: Partial<Pick<SettingsState, "theme" | "contrast" | "density">>): void;
  toggleSidebar(): void;
  toggleProjectSidebar(): void;
  toggleFavorite(id: string): void;
  toggleSection(id: string): void;
  resolveDisplay(view: string): Display;
  resolveProjectsDisplay(): ProjectsDisplay;
  setProjectsDisplay(patch: Partial<ProjectsDisplay>): void;
  resetProjectsDisplay(): void;
  setDisplay(view: string, patch: Partial<Display>): void;
  resetDisplay(view: string): void;
  saveView(name: string, view: string, filters: Filter[], display: Display): string;
  updateView(id: string, filters: Filter[], display: Display): void;
  renameView(id: string, name: string): void;
  deleteView(id: string): void;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const KEY = "jira-linear:settings:v1";
const THEMES: Theme[] = ["system", "light", "dark"];
const CONTRASTS: Contrast[] = ["normal", "high"];
const DENSITIES: Density[] = ["comfortable", "compact"];

function read(storage: Storage): Partial<SettingsState> {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? "{}");
    return {
      theme: THEMES.includes(raw.theme) ? raw.theme : undefined,
      contrast: CONTRASTS.includes(raw.contrast) ? raw.contrast : undefined,
      density: DENSITIES.includes(raw.density) ? raw.density : undefined,
      sidebarCollapsed: typeof raw.sidebarCollapsed === "boolean" ? raw.sidebarCollapsed : undefined,
      projectSidebarOpen: typeof raw.projectSidebarOpen === "boolean" ? raw.projectSidebarOpen : undefined,
      favorites: Array.isArray(raw.favorites) ? raw.favorites.filter((f: unknown) => typeof f === "string") : undefined,
      foldedSections: Array.isArray(raw.foldedSections) ? raw.foldedSections.filter((f: unknown) => typeof f === "string") : undefined,
      displayByView: raw.displayByView && typeof raw.displayByView === "object"
        ? Object.fromEntries(Object.entries(raw.displayByView).map(([k, v]) => [k, sanitizeDisplay(v)]))
        : undefined,
      projectsDisplay: sanitizeProjectsDisplay(raw.projectsDisplay),
      defaultStoryPoints: typeof raw.defaultStoryPoints === "number" && raw.defaultStoryPoints > 0 && raw.defaultStoryPoints <= 100 ? raw.defaultStoryPoints : undefined,
      savedViews: Array.isArray(raw.savedViews)
        ? raw.savedViews.filter((v: SavedView) => v && typeof v.id === "string" && typeof v.name === "string" && typeof v.view === "string").map((v: SavedView) => ({
          id: v.id, name: v.name, view: v.view, filters: Array.isArray(v.filters) ? v.filters : [], display: { ...displayFor(v.view), ...sanitizeDisplay(v.display) },
        }))
        : undefined,
    };
  } catch {
    return {};
  }
}

export function createSettingsStore(storage: Storage = localStorage, newId: () => string = () => crypto.randomUUID()) {
  const saved = read(storage);
  return createStore<SettingsState>((set, get) => {
    const save = () => {
      const { theme, contrast, density, sidebarCollapsed, projectSidebarOpen, favorites, foldedSections, displayByView, savedViews, projectsDisplay, defaultStoryPoints } = get();
      storage.setItem(KEY, JSON.stringify({ theme, contrast, density, sidebarCollapsed, projectSidebarOpen, favorites, foldedSections, displayByView, savedViews, projectsDisplay, defaultStoryPoints }));
    };
    return {
      theme: saved.theme ?? "system",
      contrast: saved.contrast ?? "normal",
      density: saved.density ?? "comfortable",
      sidebarCollapsed: saved.sidebarCollapsed ?? false,
      projectSidebarOpen: saved.projectSidebarOpen ?? true,
      favorites: saved.favorites ?? [],
      foldedSections: saved.foldedSections ?? [],
      displayByView: saved.displayByView ?? {},
      savedViews: saved.savedViews ?? [],
      projectsDisplay: saved.projectsDisplay ?? {},
      defaultStoryPoints: saved.defaultStoryPoints ?? DEFAULT_STORY_POINTS,
      setDefaultStoryPoints(n) { if (Number.isFinite(n) && n > 0 && n <= 100) { set({ defaultStoryPoints: n }); save(); } },
      set(patch) { set(patch); save(); },
      toggleSidebar() { set({ sidebarCollapsed: !get().sidebarCollapsed }); save(); },
      toggleProjectSidebar() { set({ projectSidebarOpen: !get().projectSidebarOpen }); save(); },
      resolveProjectsDisplay: () => ({ ...DEFAULT_PROJECTS_DISPLAY, ...get().projectsDisplay }),
      setProjectsDisplay(patch) { set({ projectsDisplay: { ...get().projectsDisplay, ...patch } }); save(); },
      resetProjectsDisplay() { set({ projectsDisplay: {} }); save(); },
      resolveDisplay: (view) => ({ ...displayFor(view), ...get().displayByView[view] }),
      setDisplay(view, patch) {
        set({ displayByView: { ...get().displayByView, [view]: { ...get().displayByView[view], ...patch } } });
        save();
      },
      resetDisplay(view) {
        const { [view]: _gone, ...rest } = get().displayByView;
        set({ displayByView: rest });
        save();
      },
      saveView(name, view, filters, display) {
        const id = newId();
        set({ savedViews: [...get().savedViews, { id, name, view, filters, display }] });
        save();
        return id;
      },
      updateView(id, filters, display) {
        set({ savedViews: get().savedViews.map((v) => (v.id === id ? { ...v, filters, display } : v)) });
        save();
      },
      renameView(id, name) {
        set({ savedViews: get().savedViews.map((v) => (v.id === id ? { ...v, name } : v)) });
        save();
      },
      deleteView(id) {
        set({ savedViews: get().savedViews.filter((v) => v.id !== id) });
        save();
      },
      toggleSection(id) {
        const f = get().foldedSections;
        set({ foldedSections: f.includes(id) ? f.filter((x) => x !== id) : [...f, id] });
        save();
      },
      toggleFavorite(id) {
        const f = get().favorites;
        set({ favorites: f.includes(id) ? f.filter((x) => x !== id) : [...f, id] });
        save();
      },
    };
  });
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;

export function applyTheme(root: HTMLElement, s: Pick<SettingsState, "theme" | "contrast" | "density">) {
  root.setAttribute("data-theme", s.theme);
  root.setAttribute("data-contrast", s.contrast);
  root.setAttribute("data-density", s.density);
}
