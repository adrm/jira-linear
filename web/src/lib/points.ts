import type { Issue } from "@shared/types";
import { isDroppedResolution } from "@shared/resolution";

/** What a ticket without story points counts as, unless the setting says otherwise. */
export const DEFAULT_STORY_POINTS = 3;

export const pointsOf = (i: Pick<Issue, "storyPoints">, fallback: number = DEFAULT_STORY_POINTS): number => i.storyPoints ?? fallback;

/** Closed as Won't Do, Duplicate and the like: it leaves the project's scope instead of counting as done. */
export const isDropped = (i: Pick<Issue, "statusCategory" | "resolution">): boolean => i.statusCategory === "done" && isDroppedResolution(i.resolution);
