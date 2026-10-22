import type { PickerKind } from "../store/ui";
import type { Ctx } from "./context";

export type ActionId = "status" | "assignee" | "me" | "priority" | "labels" | "project" | "due" | "rename" | "copy" | "open" | "relBlockedBy" | "relBlocks" | "relRelates" | "review";

export interface ActionDef {
  id: ActionId;
  /** short name for menus and the bulk bar */
  label: string;
  /** wording in the command palette */
  palette: string;
  keys: string;
  picker?: PickerKind;
}

export const ACTIONS: ActionDef[] = [
  { id: "status", label: "Status", palette: "Change status…", keys: "S", picker: "status" },
  { id: "assignee", label: "Assignee", palette: "Assign to…", keys: "A", picker: "assignee" },
  { id: "me", label: "Assign to me", palette: "Assign to me", keys: "I" },
  { id: "priority", label: "Priority", palette: "Set priority…", keys: "P", picker: "priority" },
  { id: "labels", label: "Labels", palette: "Change labels…", keys: "L", picker: "labels" },
  { id: "project", label: "Project", palette: "Set project…", keys: "⇧ P", picker: "epic" },
  { id: "due", label: "Due date", palette: "Set due date…", keys: "⇧ D", picker: "duedate" },
  { id: "rename", label: "Rename", palette: "Rename…", keys: "R" },
  { id: "relBlockedBy", label: "Blocked by…", palette: "Add relation: Blocked by…", keys: "" },
  { id: "relBlocks", label: "Blocking…", palette: "Add relation: Blocking…", keys: "" },
  { id: "relRelates", label: "Related to…", palette: "Add relation: Related to…", keys: "" },
  { id: "review", label: "For team review", palette: "Mark for review", keys: "T" },
  { id: "copy", label: "Copy link", palette: "Copy link", keys: "Y" },
  { id: "open", label: "Open in Jira", palette: "Open in Jira", keys: "O" },
];

/** Run an action on the current targets. Shared by hotkeys, the palette, the context menu and the bulk bar. */
export function runAction(ctx: Ctx, id: ActionId): void {
  const ui = ctx.ui.getState();
  // On a project page with no ticket highlighted, the page itself is the thing to open, copy or rename.
  const onProjectPage = ui.view.startsWith("project:") && (id === "open" || id === "copy" || id === "rename");
  const keys = ui.targets().length ? ui.targets() : onProjectPage ? [ui.view.slice(8)] : [];
  if (!keys.length) return;
  const url = (k: string) => `${ctx.jiraUrl}/browse/${k}`;
  switch (id) {
    case "me":
      if (ctx.me) void ctx.app.getState().mutateMany(keys.map((key) => ({ op: "setAssignee" as const, key, accountId: ctx.me!.id })));
      ui.closeOverlay();
      return;
    case "rename":
      ui.openRename(keys[0]);
      return;
    case "relBlockedBy":
    case "relBlocks":
    case "relRelates":
      ui.openRelation(id === "relBlockedBy" ? "blockedBy" : id === "relBlocks" ? "blocks" : "relates", keys[0]);
      return;
    case "review": {
      // one press marks them all; when every target is already marked it clears them instead
      const allMarked = keys.every((k) => ctx.review[k]);
      ctx.setReview(keys, !allMarked);
      ui.closeOverlay();
      return;
    }
    case "copy":
      void ctx.copyText(keys.map(url).join("\n"));
      ctx.app.getState().notify(keys.length > 1 ? "Links copied" : "Link copied");
      ui.closeOverlay();
      return;
    case "open":
      ctx.openExternal(url(keys[0]));
      ui.closeOverlay();
      return;
    default: {
      const def = ACTIONS.find((a) => a.id === id)!;
      if (def.picker) ui.openPicker(def.picker);
    }
  }
}

/** Wording for the review toggle follows what pressing it would do. */
export function reviewText(allMarked: boolean, form: "label" | "palette"): string {
  if (form === "palette") return allMarked ? "Remove from review" : "Mark for review";
  return allMarked ? "Remove from review" : "For team review";
}
