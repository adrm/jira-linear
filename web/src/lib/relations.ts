import type { Issue } from "@shared/types";

export type BlockState = "blocked" | "blocking" | null;

/**
 * Linear-style badge state for an issue. Only unresolved relations count: a blocker that is
 * done no longer blocks, and a done issue shows no badge. Blocked wins over blocking.
 */
export function blockState(issue: Issue, byKey: Record<string, Issue>): BlockState {
  if (issue.statusCategory === "done") return null;
  let blocking = false;
  for (const l of issue.links) {
    if (l.type !== "Blocks") continue;
    const open = byKey[l.key]?.statusCategory !== "done"; // unknown issues count as unresolved
    if (!open) continue;
    if (l.direction === "inward") return "blocked";
    blocking = true;
  }
  return blocking ? "blocking" : null;
}
