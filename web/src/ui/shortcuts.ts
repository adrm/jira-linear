export interface Shortcut {
  keys: string;
  label: string;
  group: "Navigate" | "Select" | "Issue" | "General";
}

export const SHORTCUTS: Shortcut[] = [
  { keys: "J / K", label: "Move down / up", group: "Navigate" },
  { keys: "↓ / ↑", label: "Move down / up", group: "Navigate" },
  { keys: "⌘ ↓ / ⌘ ↑", label: "Jump to last / first", group: "Navigate" },
  { keys: "Enter", label: "Open issue", group: "Navigate" },
  { keys: "] / [", label: "Next / previous issue", group: "Navigate" },
  { keys: "G then I", label: "Go to my issues", group: "Navigate" },
  { keys: "G then A", label: "Go to active issues", group: "Navigate" },
  { keys: "G then B", label: "Go to backlog", group: "Navigate" },
  { keys: "G then T", label: "Go to all issues", group: "Navigate" },
  { keys: "G then R", label: "Go to tickets marked for review", group: "Navigate" },
  { keys: "G then P", label: "Go to projects", group: "Navigate" },
  { keys: "X", label: "Select issue", group: "Select" },
  { keys: "⇧ ↓ / ⇧ ↑", label: "Extend selection", group: "Select" },
  { keys: "⇧ click", label: "Select a range", group: "Select" },
  { keys: "⌘ A", label: "Select all", group: "Select" },
  { keys: "Esc", label: "Clear selection", group: "Select" },
  { keys: "S", label: "Set status", group: "Issue" },
  { keys: "A", label: "Set assignee", group: "Issue" },
  { keys: "I", label: "Assign to me", group: "Issue" },
  { keys: "P", label: "Set priority", group: "Issue" },
  { keys: "L", label: "Set labels", group: "Issue" },
  { keys: "⇧ P", label: "Set project", group: "Issue" },
  { keys: "⇧ D", label: "Set due date", group: "Issue" },
  { keys: "R", label: "Rename", group: "Issue" },
  { keys: "M", label: "Comment", group: "Issue" },
  { keys: "T", label: "Mark for team review (local)", group: "Issue" },
  { keys: "O", label: "Open in Jira", group: "Issue" },
  { keys: "Y", label: "Copy link", group: "Issue" },
  { keys: "⌘ Z", label: "Undo", group: "General" },
  { keys: "C", label: "Create issue", group: "General" },
  { keys: "/", label: "Search", group: "General" },
  { keys: "⌘ K", label: "Command menu", group: "General" },
  { keys: "?", label: "Keyboard shortcuts", group: "General" },
  { keys: "F1", label: "Keyboard shortcuts (any layout)", group: "General" },
];
