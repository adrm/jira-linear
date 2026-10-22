import { labelHue } from "./rowdetails";
import { BACKLOG_STATUSES, CANCELED_STATUSES, STATUS_COLORS } from "./workflow";

export type StatusKind = "backlog" | "todo" | "started" | "done" | "canceled";
export interface StatusStyle { kind: StatusKind; hue: number; chroma: number }


const DONE: [number, number] = [275, 62];
const NEUTRAL_HUE = 266;

export function statusStyle(status: string, category: string): StatusStyle {
  if (category === "done") {
    return CANCELED_STATUSES.includes(status.trim().toLowerCase())
      ? { kind: "canceled", hue: NEUTRAL_HUE, chroma: 3 }
      : { kind: "done", hue: DONE[0], chroma: DONE[1] };
  }
  if (category === "indeterminate") {
    const known = STATUS_COLORS[status];
    if (known) return { kind: "started", hue: known[0], chroma: known[1] };
    return { kind: "started", hue: 60 + (labelHue(status) % 280), chroma: 60 };
  }
  return { kind: BACKLOG_STATUSES.includes(status) ? "backlog" : "todo", hue: NEUTRAL_HUE, chroma: 4 };
}
