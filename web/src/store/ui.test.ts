import { beforeEach, describe, expect, it } from "vitest";
import { createUiStore } from "./ui";

const order = ["ABC-1", "ABC-2", "ABC-3"];
let ui: ReturnType<typeof createUiStore>;
beforeEach(() => (ui = createUiStore()));

describe("selection", () => {
  it("move selects the first item when nothing is selected", () => {
    ui.getState().move(order, 1);
    expect(ui.getState().selectedKey).toBe("ABC-1");
  });
  it("moves down and up and clamps at both ends", () => {
    ui.getState().select("ABC-1");
    ui.getState().move(order, 1);
    ui.getState().move(order, 1);
    ui.getState().move(order, 1);
    expect(ui.getState().selectedKey).toBe("ABC-3");
    ui.getState().move(order, -5);
    expect(ui.getState().selectedKey).toBe("ABC-1");
  });
  it("recovers when the selected issue is no longer in the list", () => {
    ui.getState().select("ABC-9");
    ui.getState().move(order, 1);
    expect(ui.getState().selectedKey).toBe("ABC-1");
  });
  it("move on an empty list clears the selection", () => {
    ui.getState().select("ABC-1");
    ui.getState().move([], 1);
    expect(ui.getState().selectedKey).toBeNull();
  });
});

describe("detail panel and overlays", () => {
  it("openDetail needs a selection; closeDetail hides it", () => {
    ui.getState().openDetail();
    expect(ui.getState().detailOpen).toBe(false);
    ui.getState().select("ABC-2");
    ui.getState().openDetail();
    expect(ui.getState().detailOpen).toBe(true);
    ui.getState().closeDetail();
    expect(ui.getState().detailOpen).toBe(false);
  });
  it("only one overlay at a time; escape closes the top-most thing", () => {
    ui.getState().select("ABC-1");
    ui.getState().openDetail();
    ui.getState().openPicker("status");
    expect(ui.getState().overlay).toEqual({ kind: "picker", picker: "status" });
    ui.getState().escape();
    expect(ui.getState().overlay).toBeNull();
    expect(ui.getState().detailOpen).toBe(true);
    ui.getState().escape();
    expect(ui.getState().detailOpen).toBe(false);
  });
  it("pickers need a selected issue", () => {
    ui.getState().openPicker("status");
    expect(ui.getState().overlay).toBeNull();
  });
  it("palette, create and help open without a selection", () => {
    ui.getState().openOverlay("palette");
    expect(ui.getState().overlay).toEqual({ kind: "palette" });
    ui.getState().openCreate();
    expect(ui.getState().overlay).toEqual({ kind: "create", defaults: undefined });
  });
});

describe("views and search", () => {
  it("changing the view resets the search and keeps the selection only if still valid", () => {
    ui.getState().setSearch("chart");
    ui.getState().setView("mine");
    expect(ui.getState().search).toBe("");
    expect(ui.getState().view).toBe("mine");
  });
  it("defaults to the active view", () => {
    expect(ui.getState().view).toBe("active");
  });
});

describe("projects", () => {
  it("a picker can target a project explicitly, even with nothing selected", () => {
    ui.getState().openPicker("status", "ABC-9");
    expect(ui.getState().overlay).toEqual({ kind: "picker", picker: "status", targetKey: "ABC-9" });
  });
  it("without an explicit target a picker uses the selection (no targetKey stored)", () => {
    ui.getState().select("ABC-2");
    ui.getState().openPicker("status");
    expect(ui.getState().overlay).toEqual({ kind: "picker", picker: "status" });
  });
  it("rename needs a target: explicit or the selection", () => {
    ui.getState().openRename();
    expect(ui.getState().overlay).toBeNull();
    ui.getState().openRename("ABC-9");
    expect(ui.getState().overlay).toEqual({ kind: "rename", targetKey: "ABC-9" });
    ui.getState().closeOverlay();
    ui.getState().select("ABC-2");
    ui.getState().openRename();
    expect(ui.getState().overlay).toEqual({ kind: "rename", targetKey: "ABC-2" });
  });
  it("createProject opens like any other overlay", () => {
    ui.getState().openOverlay("createProject");
    expect(ui.getState().overlay).toEqual({ kind: "createProject" });
  });
  it("views can be the projects list or a single project, and clear the selection", () => {
    ui.getState().select("ABC-2");
    ui.getState().setView("projects");
    expect(ui.getState().view).toBe("projects");
    expect(ui.getState().selectedKey).toBeNull();
    ui.getState().setView("project:ABC-9");
    expect(ui.getState().view).toBe("project:ABC-9");
  });
  it("closing the detail panel is separate from leaving a project", () => {
    ui.getState().setView("project:ABC-9");
    ui.getState().select("ABC-2");
    ui.getState().openDetail();
    ui.getState().escape();
    expect(ui.getState().detailOpen).toBe(false);
    expect(ui.getState().view).toBe("project:ABC-9");
  });
});

describe("multi-select", () => {
  const six = ["A", "B", "C", "D", "E", "F"];
  it("toggleSelect adds and removes the cursor row and keeps an anchor", () => {
    ui.getState().select("B");
    ui.getState().toggleSelect();
    expect(ui.getState().selection).toEqual(["B"]);
    ui.getState().toggleSelect();
    expect(ui.getState().selection).toEqual([]);
  });
  it("toggleSelect can target an explicit key (checkbox / cmd-click)", () => {
    ui.getState().toggleSelect("C");
    ui.getState().toggleSelect("E");
    expect(ui.getState().selection).toEqual(["C", "E"]);
  });
  it("extendSelection selects from the anchor to the moving cursor, in either direction", () => {
    ui.getState().select("B");
    ui.getState().extendSelection(six, 1);
    ui.getState().extendSelection(six, 1);
    expect(ui.getState().selectedKey).toBe("D");
    expect(ui.getState().selection).toEqual(["B", "C", "D"]);
    ui.getState().extendSelection(six, -1);
    expect(ui.getState().selection).toEqual(["B", "C"]);
    ui.getState().extendSelection(six, -1);
    ui.getState().extendSelection(six, -1);
    expect(ui.getState().selection).toEqual(["A", "B"]);
  });
  it("extendSelection clamps at the ends", () => {
    ui.getState().select("F");
    ui.getState().extendSelection(six, 1);
    expect(ui.getState().selection).toEqual(["F"]);
  });
  it("selectRange (shift-click) selects between the anchor and the clicked row", () => {
    ui.getState().select("B");
    ui.getState().toggleSelect();
    ui.getState().selectRange(six, "E");
    expect(ui.getState().selection).toEqual(["B", "C", "D", "E"]);
    expect(ui.getState().selectedKey).toBe("E");
  });
  it("selectAll selects everything shown; clearSelection empties it", () => {
    ui.getState().selectAll(six);
    expect(ui.getState().selection).toEqual(six);
    ui.getState().clearSelection();
    expect(ui.getState().selection).toEqual([]);
  });
  it("jump moves to the first or last row", () => {
    ui.getState().select("C");
    ui.getState().jump(six, "last");
    expect(ui.getState().selectedKey).toBe("F");
    ui.getState().jump(six, "first");
    expect(ui.getState().selectedKey).toBe("A");
  });
  it("targets are the selection when there is one, otherwise the cursor row", () => {
    expect(ui.getState().targets()).toEqual([]);
    ui.getState().select("B");
    expect(ui.getState().targets()).toEqual(["B"]);
    ui.getState().toggleSelect("C");
    ui.getState().toggleSelect("D");
    expect(ui.getState().targets()).toEqual(["C", "D"]);
  });
  it("an explicit picker target wins over the selection", () => {
    ui.getState().toggleSelect("C");
    ui.getState().openPicker("status", "ABC-9");
    expect(ui.getState().targets()).toEqual(["ABC-9"]);
  });
  it("escape clears the selection after closing overlays and before closing the detail", () => {
    ui.getState().select("B");
    ui.getState().openDetail();
    ui.getState().toggleSelect();
    ui.getState().escape();
    expect(ui.getState().selection).toEqual([]);
    expect(ui.getState().detailOpen).toBe(true);
    ui.getState().escape();
    expect(ui.getState().detailOpen).toBe(false);
  });
  it("changing view clears the selection", () => {
    ui.getState().toggleSelect("C");
    ui.getState().setView("backlog");
    expect(ui.getState().selection).toEqual([]);
  });
});

describe("context menu", () => {
  it("opens at a point and closes with the overlay", () => {
    ui.getState().openContext(120, 80);
    expect(ui.getState().overlay).toEqual({ kind: "context", x: 120, y: 80 });
    ui.getState().escape();
    expect(ui.getState().overlay).toBeNull();
  });
});

describe("collapsible groups", () => {
  it("toggleGroup folds a group away and opens it again, per view", () => {
    ui.getState().toggleGroup("In Development");
    expect(ui.getState().collapsedGroups).toEqual(["active|In Development"]);
    ui.getState().setView("backlog");
    expect(ui.getState().collapsedGroups).toEqual(["active|In Development"]); // remembered
    expect(ui.getState().isCollapsed("In Development")).toBe(false); // but only for the view it was set in
    ui.getState().setView("active");
    expect(ui.getState().isCollapsed("In Development")).toBe(true);
    ui.getState().toggleGroup("In Development");
    expect(ui.getState().collapsedGroups).toEqual([]);
  });
});

describe("create dialog defaults", () => {
  it("openCreate opens the dialog with where-you-are defaults", () => {
    ui.getState().openCreate({ status: "In Development", assigneeId: "u1" });
    expect(ui.getState().overlay).toEqual({ kind: "create", defaults: { status: "In Development", assigneeId: "u1" } });
  });
  it("openCreate with nothing opens a plain dialog", () => {
    ui.getState().openCreate();
    expect(ui.getState().overlay).toEqual({ kind: "create", defaults: undefined });
  });
});

describe("filters", () => {
  const status = { field: "status" as const, not: false, values: ["Backlog"] };
  it("are kept per view, so switching views does not lose them", () => {
    ui.getState().setFilters([status]);
    ui.getState().setView("backlog");
    expect(ui.getState().filters()).toEqual([]);
    ui.getState().setFilters([{ field: "type", not: false, values: ["Bug"] }]);
    ui.getState().setView("active");
    expect(ui.getState().filters()).toEqual([status]);
  });
  it("clearFilters empties only the current view", () => {
    ui.getState().setFilters([status]);
    ui.getState().setView("all");
    ui.getState().setFilters([status]);
    ui.getState().clearFilters();
    expect(ui.getState().filters()).toEqual([]);
    ui.getState().setView("active");
    expect(ui.getState().filters()).toEqual([status]);
  });
  it("opening a saved view switches to its base view with its filters", () => {
    ui.getState().openSavedView({ id: "v1", name: "Bugs", view: "backlog", filters: [status], display: {} as never });
    expect(ui.getState().view).toBe("backlog");
    expect(ui.getState().filters()).toEqual([status]);
    expect(ui.getState().activeSavedView).toBe("v1");
  });
  it("changing views or clearing filters leaves a saved view", () => {
    ui.getState().openSavedView({ id: "v1", name: "Bugs", view: "backlog", filters: [status], display: {} as never });
    ui.getState().setView("active");
    expect(ui.getState().activeSavedView).toBeNull();
  });
  it("the filter menu is an overlay", () => {
    ui.getState().openOverlay("filter");
    expect(ui.getState().overlay).toEqual({ kind: "filter" });
    ui.getState().openOverlay("display");
    expect(ui.getState().overlay).toEqual({ kind: "display" });
  });
});

describe("board navigation", () => {
  const cols = [["A1", "A2", "A3"], ["B1"], [], ["D1", "D2"]];
  it("starts at the first card when nothing is highlighted", () => {
    ui.getState().boardMove(cols, 1, 0);
    expect(ui.getState().selectedKey).toBe("A1");
  });
  it("moves between columns keeping the row, clamped to the shorter column", () => {
    ui.getState().select("A3");
    ui.getState().boardMove(cols, 1, 0);
    expect(ui.getState().selectedKey).toBe("B1");
  });
  it("skips empty columns", () => {
    ui.getState().select("B1");
    ui.getState().boardMove(cols, 1, 0);
    expect(ui.getState().selectedKey).toBe("D1");
    ui.getState().boardMove(cols, -1, 0);
    expect(ui.getState().selectedKey).toBe("B1");
  });
  it("moves up and down inside a column and stops at the ends", () => {
    ui.getState().select("A1");
    ui.getState().boardMove(cols, 0, 1);
    ui.getState().boardMove(cols, 0, 1);
    ui.getState().boardMove(cols, 0, 1);
    expect(ui.getState().selectedKey).toBe("A3");
    ui.getState().boardMove(cols, 0, -5);
    expect(ui.getState().selectedKey).toBe("A1");
  });
  it("does not move past the first or last column", () => {
    ui.getState().select("A1");
    ui.getState().boardMove(cols, -1, 0);
    expect(ui.getState().selectedKey).toBe("A1");
    ui.getState().select("D2");
    ui.getState().boardMove(cols, 1, 0);
    expect(ui.getState().selectedKey).toBe("D2");
  });
});

describe("openIssue", () => {
  it("highlights the issue and opens its page in one step", () => {
    ui.getState().openIssue("ABC-7");
    expect(ui.getState().selectedKey).toBe("ABC-7");
    expect(ui.getState().detailOpen).toBe(true);
  });
});

describe("relation picker", () => {
  it("opens for a ticket and a kind of relation", () => {
    ui.getState().openRelation("blockedBy", "ABC-3");
    expect(ui.getState().overlay).toEqual({ kind: "relation", relation: "blockedBy", key: "ABC-3" });
  });
});
