import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, createSettingsStore } from "./settings";

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
let storage: MemStorage;
beforeEach(() => (storage = new MemStorage()));

describe("settings store", () => {
  it("starts with sensible defaults", () => {
    const s = createSettingsStore(storage);
    expect(s.getState()).toMatchObject({ theme: "system", contrast: "normal", density: "comfortable", sidebarCollapsed: false, favorites: [] });
  });
  it("persists changes and restores them in a new store", () => {
    const a = createSettingsStore(storage);
    a.getState().set({ theme: "dark", contrast: "high" });
    a.getState().toggleSidebar();
    const b = createSettingsStore(storage);
    expect(b.getState()).toMatchObject({ theme: "dark", contrast: "high", sidebarCollapsed: true });
  });
  it("remembers whether the project details sidebar is open (open by default)", () => {
    const a = createSettingsStore(storage);
    expect(a.getState().projectSidebarOpen).toBe(true);
    a.getState().toggleProjectSidebar();
    expect(createSettingsStore(storage).getState().projectSidebarOpen).toBe(false);
  });
  it("toggles favourites on and off", () => {
    const s = createSettingsStore(storage);
    s.getState().toggleFavorite("project:ABC-1");
    s.getState().toggleFavorite("view:abc");
    s.getState().toggleFavorite("project:ABC-1");
    expect(s.getState().favorites).toEqual(["view:abc"]);
  });
  it("remembers which sidebar sections are folded away", () => {
    const a = createSettingsStore(storage);
    a.getState().toggleSection("team");
    a.getState().toggleSection("favorites");
    a.getState().toggleSection("team");
    expect(createSettingsStore(storage).getState().foldedSections).toEqual(["favorites"]);
  });
  it("ignores corrupt or unknown stored values", () => {
    storage.setItem("jira-linear:settings:v1", "{not json");
    expect(createSettingsStore(storage).getState().theme).toBe("system");
    storage.setItem("jira-linear:settings:v1", JSON.stringify({ theme: "neon", contrast: 5 }));
    expect(createSettingsStore(storage).getState()).toMatchObject({ theme: "system", contrast: "normal" });
  });
});

describe("default story points", () => {
  it("is 3 until you change it, and is remembered", () => {
    const a = createSettingsStore(storage);
    expect(a.getState().defaultStoryPoints).toBe(3);
    a.getState().setDefaultStoryPoints(5);
    expect(createSettingsStore(storage).getState().defaultStoryPoints).toBe(5);
  });
  it("ignores values that are not a positive number", () => {
    const a = createSettingsStore(storage);
    a.getState().setDefaultStoryPoints(0);
    a.getState().setDefaultStoryPoints(-2);
    a.getState().setDefaultStoryPoints(Number.NaN);
    expect(a.getState().defaultStoryPoints).toBe(3);
    storage.setItem("jira-linear:settings:v1", JSON.stringify({ defaultStoryPoints: "lots" }));
    expect(createSettingsStore(storage).getState().defaultStoryPoints).toBe(3);
  });
});

describe("display options and saved views", () => {
  it("remembers display options per view, on top of each view's own defaults", () => {
    const a = createSettingsStore(storage);
    a.getState().setDisplay("active", { groupBy: "assignee", reverse: true });
    const b = createSettingsStore(storage);
    expect(b.getState().resolveDisplay("active")).toMatchObject({ groupBy: "assignee", reverse: true, orderBy: "updated" });
    expect(b.getState().resolveDisplay("backlog").groupBy).toBe("status");
    expect(b.getState().resolveDisplay("all").completed).toBe("month"); // the view's own default survives
  });
  it("resets a view to its defaults", () => {
    const s = createSettingsStore(storage);
    s.getState().setDisplay("active", { groupBy: "priority" });
    s.getState().resetDisplay("active");
    expect(s.getState().resolveDisplay("active").groupBy).toBe("status");
  });
  it("keeps successive changes to the same view", () => {
    const s = createSettingsStore(storage);
    s.getState().setDisplay("active", { groupBy: "priority" });
    s.getState().setDisplay("active", { orderBy: "due" });
    expect(s.getState().resolveDisplay("active")).toMatchObject({ groupBy: "priority", orderBy: "due" });
  });
  it("ignores stored display values it does not recognise", () => {
    storage.setItem("jira-linear:settings:v1", JSON.stringify({ displayByView: { active: { groupBy: "colour", orderBy: "due", layout: "cube", props: ["id", "nonsense"], completed: "decade" } } }));
    const d = createSettingsStore(storage).getState().resolveDisplay("active");
    expect(d).toMatchObject({ groupBy: "status", orderBy: "due", layout: "list", completed: "all" });
    expect(d.props).toEqual(["id"]);
  });
  it("saves a view with its filters and display, lists it and deletes it", () => {
    let n = 0;
    const s = createSettingsStore(storage, () => `v${++n}`);
    const id = s.getState().saveView("Bugs in review", "active", [{ field: "type", not: false, values: ["Bug"] }], { ...s.getState().resolveDisplay("active"), groupBy: "assignee" });
    expect(id).toBe("v1");
    const again = createSettingsStore(storage);
    expect(again.getState().savedViews).toEqual([
      expect.objectContaining({ id: "v1", name: "Bugs in review", view: "active", filters: [{ field: "type", not: false, values: ["Bug"] }] }),
    ]);
    expect(again.getState().savedViews[0].display.groupBy).toBe("assignee");
    again.getState().deleteView("v1");
    expect(createSettingsStore(storage).getState().savedViews).toEqual([]);
  });
  it("renames a saved view and can replace what it holds", () => {
    const s = createSettingsStore(storage, () => "v1");
    s.getState().saveView("One", "all", [], s.getState().resolveDisplay("all"));
    s.getState().renameView("v1", "Two");
    s.getState().updateView("v1", [{ field: "status", not: true, values: ["Backlog"] }], { ...s.getState().resolveDisplay("all"), reverse: true });
    const v = s.getState().savedViews[0];
    expect([v.name, v.filters.length, v.display.reverse]).toEqual(["Two", 1, true]);
  });
});

describe("project list display options", () => {
  it("start from the defaults and are remembered", () => {
    const a = createSettingsStore(storage);
    expect(a.getState().resolveProjectsDisplay()).toEqual({ layout: "list", groupBy: "status", orderBy: "updated", reverse: false, completed: "month" });
    a.getState().setProjectsDisplay({ groupBy: "lead", completed: "all" });
    expect(createSettingsStore(storage).getState().resolveProjectsDisplay()).toMatchObject({ groupBy: "lead", completed: "all", orderBy: "updated" });
    a.getState().resetProjectsDisplay();
    expect(a.getState().resolveProjectsDisplay().groupBy).toBe("status");
  });
  it("ignore stored values they do not recognise", () => {
    storage.setItem("jira-linear:settings:v1", JSON.stringify({ projectsDisplay: { groupBy: "colour", orderBy: "name", completed: 7 } }));
    expect(createSettingsStore(storage).getState().resolveProjectsDisplay()).toMatchObject({ groupBy: "status", orderBy: "name", completed: "month" });
  });
});

describe("applyTheme", () => {
  it("writes the choice onto the root element for CSS to read", () => {
    const attrs: Record<string, string> = {};
    const root = { setAttribute: (k: string, v: string) => (attrs[k] = v) } as unknown as HTMLElement;
    applyTheme(root, { theme: "light", contrast: "high", density: "compact" });
    expect(attrs).toEqual({ "data-theme": "light", "data-contrast": "high", "data-density": "compact" });
  });
});
