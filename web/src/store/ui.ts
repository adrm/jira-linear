import { createStore } from "zustand/vanilla";
import type { Filter, FilterField } from "../lib/filters";
import type { SavedView } from "./settings";

export type View = "active" | "backlog" | "mine" | "created" | "review" | "all" | "projects" | `project:${string}`;
export type PickerKind = "status" | "assignee" | "priority" | "labels" | "epic" | "duedate";
export interface CreateDefaults {
  status?: string;
  type?: "Bug" | "Spike" | "Task";
  labels?: string[];
  assigneeId?: string;
  parentKey?: string;
  priority?: string;
}

export type Overlay =
  | { kind: "picker"; picker: PickerKind; targetKey?: string }
  | { kind: "rename"; targetKey: string }
  | { kind: "palette" }
  | { kind: "create"; defaults?: CreateDefaults }
  | { kind: "createProject" }
  | { kind: "help" }
  | { kind: "settings" }
  | { kind: "comment" }
  | { kind: "filter"; field?: FilterField }
  | { kind: "saveView" }
  | { kind: "relation"; relation: "blockedBy" | "blocks" | "relates"; key: string }
  | { kind: "display" }
  | { kind: "context"; x: number; y: number }
  | null;

export interface UiState {
  view: View;
  search: string;
  /** the highlighted row (keyboard cursor) */
  selectedKey: string | null;
  /** rows ticked for bulk actions, in list order */
  selection: string[];
  /** where a Shift-range started */
  anchor: string | null;
  /** folded-away groups, as "view|group" */
  collapsedGroups: string[];
  /** active filters, by view */
  filtersByView: Record<string, Filter[]>;
  /** the saved view being looked at, if any */
  activeSavedView: string | null;
  detailOpen: boolean;
  overlay: Overlay;
  select(key: string | null): void;
  move(order: string[], delta: number): void;
  jump(order: string[], where: "first" | "last"): void;
  toggleSelect(key?: string): void;
  extendSelection(order: string[], delta: number): void;
  selectRange(order: string[], to: string): void;
  selectAll(order: string[]): void;
  clearSelection(): void;
  filters(): Filter[];
  setFilters(filters: Filter[]): void;
  clearFilters(): void;
  openSavedView(v: SavedView): void;
  /** move on a board: across columns (keeping the row) and/or within a column */
  boardMove(columns: string[][], dCol: number, dRow: number): void;
  toggleGroup(group: string): void;
  isCollapsed(group: string): boolean;
  /** what an action applies to: an explicit target, else the ticked rows, else the cursor row */
  targets(): string[];
  openDetail(): void;
  openIssue(key: string): void;
  closeDetail(): void;
  openPicker(picker: PickerKind, targetKey?: string): void;
  openRename(targetKey?: string): void;
  openContext(x: number, y: number): void;
  openCreate(defaults?: CreateDefaults): void;
  openOverlay(kind: "palette" | "createProject" | "help" | "settings" | "comment" | "filter" | "display" | "saveView"): void;
  openFilter(field?: FilterField): void;
  openRelation(relation: "blockedBy" | "blocks" | "relates", key: string): void;
  closeOverlay(): void;
  escape(): void;
  /** which tab of a project page is showing */
  projectTab: "overview" | "issues";
  setProjectTab(tab: "overview" | "issues"): void;
  setView(view: View): void;
  setSearch(q: string): void;
}

/** What an action applies to: an explicit target, else the ticked rows, else the cursor row. */
export function targetsOf(s: Pick<UiState, "overlay" | "selection" | "selectedKey">): string[] {
  if (s.overlay && "targetKey" in s.overlay && s.overlay.targetKey) return [s.overlay.targetKey];
  if (s.selection.length) return s.selection;
  return s.selectedKey ? [s.selectedKey] : [];
}

export function createUiStore() {
  return createStore<UiState>((set, get) => ({
    view: "active",
    projectTab: "overview",
    search: "",
    selectedKey: null,
    selection: [],
    anchor: null,
    collapsedGroups: [],
    filtersByView: {},
    activeSavedView: null,
    detailOpen: false,
    overlay: null,
    select: (key) => set({ selectedKey: key, anchor: null }),
    jump(order, where) {
      if (order.length) set({ selectedKey: where === "first" ? order[0] : order[order.length - 1], anchor: null });
    },
    toggleSelect(key) {
      const k = key ?? get().selectedKey;
      if (!k) return;
      const sel = get().selection;
      set(sel.includes(k)
        ? { selection: sel.filter((x) => x !== k) }
        : { selection: [...sel, k], anchor: k, selectedKey: key ?? get().selectedKey });
    },
    extendSelection(order, delta) {
      const cur = get().selectedKey;
      if (!order.length || !cur) return;
      const anchor = get().anchor ?? cur;
      const ci = order.indexOf(cur);
      const next = Math.max(0, Math.min(order.length - 1, (ci === -1 ? 0 : ci) + delta));
      const ai = order.indexOf(anchor);
      const [lo, hi] = ai <= next ? [ai, next] : [next, ai];
      set({ anchor, selectedKey: order[next], selection: order.slice(Math.max(lo, 0), hi + 1) });
    },
    selectRange(order, to) {
      const anchor = get().anchor ?? get().selectedKey ?? to;
      const ai = order.indexOf(anchor);
      const ti = order.indexOf(to);
      if (ti === -1) return;
      const [lo, hi] = ai === -1 || ai <= ti ? [Math.max(ai, 0), ti] : [ti, ai];
      set({ anchor, selectedKey: to, selection: order.slice(lo, hi + 1) });
    },
    selectAll: (order) => set({ selection: [...order] }),
    clearSelection: () => set({ selection: [], anchor: null }),
    filters: () => get().filtersByView[get().view] ?? [],
    setFilters: (filters) => set({ filtersByView: { ...get().filtersByView, [get().view]: filters } }),
    clearFilters: () => set({ filtersByView: { ...get().filtersByView, [get().view]: [] } }),
    openSavedView(v) {
      set({
        view: v.view as View, search: "", selectedKey: null, selection: [], anchor: null,
        filtersByView: { ...get().filtersByView, [v.view]: v.filters }, activeSavedView: v.id,
      });
    },
    boardMove(columns, dCol, dRow) {
      const cur = get().selectedKey;
      let c = columns.findIndex((col) => cur !== null && col.includes(cur));
      if (c === -1) {
        const first = columns.findIndex((col) => col.length);
        if (first !== -1) set({ selectedKey: columns[first][0], anchor: null });
        return;
      }
      let r = columns[c].indexOf(cur!);
      if (dCol) {
        let n = c;
        do { n += dCol; } while (n >= 0 && n < columns.length && columns[n].length === 0);
        if (n < 0 || n >= columns.length) return;
        c = n;
        r = Math.min(r, columns[c].length - 1);
      }
      if (dRow) r = Math.max(0, Math.min(columns[c].length - 1, r + dRow));
      set({ selectedKey: columns[c][r], anchor: null });
    },
    toggleGroup(group) {
      const id = `${get().view}|${group}`;
      const c = get().collapsedGroups;
      set({ collapsedGroups: c.includes(id) ? c.filter((x) => x !== id) : [...c, id] });
    },
    isCollapsed: (group) => get().collapsedGroups.includes(`${get().view}|${group}`),
    targets: () => targetsOf(get()),
    move(order, delta) {
      if (!order.length) return set({ selectedKey: null });
      const i = order.indexOf(get().selectedKey ?? "");
      const next = i === -1 ? 0 : Math.max(0, Math.min(order.length - 1, i + delta));
      set({ selectedKey: order[next] });
    },
    openIssue: (key) => set({ selectedKey: key, anchor: null, detailOpen: true }),
    openDetail() {
      if (get().selectedKey) set({ detailOpen: true });
    },
    closeDetail: () => set({ detailOpen: false }),
    openPicker(picker, targetKey) {
      if (targetKey) set({ overlay: { kind: "picker", picker, targetKey } });
      else if (get().selectedKey) set({ overlay: { kind: "picker", picker } });
    },
    openCreate: (defaults) => set({ overlay: { kind: "create", defaults } }),
    openRelation: (relation, key) => set({ overlay: { kind: "relation", relation, key } }),
    openFilter: (field) => set({ overlay: field ? { kind: "filter", field } : { kind: "filter" } }),
    openContext: (x, y) => set({ overlay: { kind: "context", x, y } }),
    openRename(targetKey) {
      const key = targetKey ?? get().selectedKey;
      if (key) set({ overlay: { kind: "rename", targetKey: key } });
    },
    openOverlay: (kind) => set({ overlay: { kind } }),
    closeOverlay: () => set({ overlay: null }),
    escape() {
      if (get().overlay) set({ overlay: null });
      else if (get().selection.length) set({ selection: [], anchor: null });
      else if (get().detailOpen) set({ detailOpen: false });
      else if (get().search) set({ search: "" });
    },
    setProjectTab: (projectTab) => set({ projectTab, selectedKey: null, selection: [], anchor: null }),
    setView: (view) => set({ view, projectTab: "overview", search: "", selectedKey: null, selection: [], anchor: null, activeSavedView: null }),
    setSearch: (search) => set({ search }),
  }));
}

export type UiStore = ReturnType<typeof createUiStore>;
