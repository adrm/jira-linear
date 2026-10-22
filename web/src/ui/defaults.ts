import type { CreateDefaults, View } from "../store/ui";

/** What a new issue should start with, given where you pressed C. */
export function contextDefaults(view: View, me: { id: string } | null): CreateDefaults {
  if (view.startsWith("project:")) return { parentKey: view.slice(8) };
  if (view === "mine" && me) return { assigneeId: me.id };
  return {};
}
