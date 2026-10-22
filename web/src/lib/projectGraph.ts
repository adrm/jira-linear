import type { Issue, TicketHistory } from "@shared/types";
import { parseJiraDate } from "./time";
import { DEFAULT_STORY_POINTS, isDropped, pointsOf } from "./points";

const DAY = 86_400_000;
const ms = (iso: string) => parseJiraDate(iso).getTime();

/** All counts are story points; tickets without an estimate count as the configured default. `dropped` is scope removed so far. */
export interface GraphPoint { at: number; scope: number; started: number; completed: number; doneInPeriod: number; dropped: number }
export interface Graph {
  points: GraphPoint[];
  from: number;
  /** right edge of the chart: now, or the target date when that is later */
  to: number;
  target: number | null;
  /** the original and revised planning dates, when set */
  markers: Array<{ kind: "initial" | "revised"; at: number }>;
  max: number;
}

/** Weekly scope / started / completed counts for a project, plus the target date marker. */
export function buildGraph(tickets: TicketHistory[], opts: { targetDate: string | null; initialDate?: string | null; revisedDate?: string | null; forecast?: Forecast | null; defaultPoints?: number; now: Date }): Graph | null {
  if (!tickets.length) return null;
  const now = opts.now.getTime();
  const created = tickets.map((t) => ms(t.created));
  const from = Math.min(...created);
  const times = [from];
  while (times.at(-1)! + 7 * DAY < now) times.push(times.at(-1)! + 7 * DAY);
  if (times.at(-1)! < now) times.push(now);

  const def = opts.defaultPoints ?? DEFAULT_STORY_POINTS;
  const weight = tickets.map((t) => t.points ?? def);
  const started = tickets.map((t) => (t.started ? ms(t.started) : Infinity));
  const completed = tickets.map((t) => (t.completed ? ms(t.completed) : Infinity));
  const canceled = tickets.map((t) => (t.canceled ? ms(t.canceled) : Infinity));
  const total = (pred: (i: number) => boolean) => weight.reduce((n, w, i) => (pred(i) ? n + w : n), 0);
  const counted = times.map((at) => ({
    at,
    scope: total((i) => created[i] <= at && canceled[i] > at),
    started: total((i) => started[i] <= at && canceled[i] > at),
    completed: total((i) => completed[i] <= at),
    dropped: total((i) => canceled[i] <= at),
  }));
  const points = counted.map((p, i) => ({ ...p, doneInPeriod: p.completed - (counted[i - 1]?.completed ?? 0) }));
  const day = (d?: string | null) => (d ? Date.parse(`${d}T00:00:00.000Z`) : null);
  const target = day(opts.targetDate);
  const markers = ([["initial", day(opts.initialDate)], ["revised", day(opts.revisedDate)]] as const)
    .flatMap(([kind, at]) => (at === null ? [] : [{ kind, at }]));
  const to = Math.max(now, target ?? 0, ...markers.map((m) => m.at), opts.forecast?.late ?? 0);
  return { points, from, to, target, markers, max: Math.max(...points.map((p) => p.scope)) };
}

export interface Forecast {
  at: number; early: number; late: number;
  /** story points finished per week (recent weeks weighted more) */
  velocity: number;
  /** story points still to do: unstarted in full, in progress as a quarter */
  remaining: number;
}

/**
 * Linear's method: velocity from the last four weeks with recent weeks counting more; unfinished work
 * counts in full, work in progress as a quarter; early/late are about ±40% of the time left.
 */
export function forecast(tickets: TicketHistory[], now: Date, opts: { defaultPoints?: number } = {}): Forecast | null {
  const t = now.getTime();
  if (!tickets.length || t - Math.min(...tickets.map((x) => ms(x.created))) < 7 * DAY) return null;
  const def = opts.defaultPoints ?? DEFAULT_STORY_POINTS;
  const w = (x: TicketHistory) => x.points ?? def;
  const done = tickets.filter((x) => x.completed).map((x) => ({ at: ms(x.completed!), pts: w(x) }));
  let weighted = 0;
  let weights = 0;
  for (let k = 0; k < 4; k++) {
    const inWeek = done.filter((d) => d.at <= t - k * 7 * DAY && d.at > t - (k + 1) * 7 * DAY).reduce((n, d) => n + d.pts, 0);
    const weight = 4 - k;
    weighted += inWeek * weight;
    weights += weight;
  }
  const velocity = weighted / weights;
  const open = tickets.filter((x) => !x.canceled);
  const notStarted = open.filter((x) => !x.started && !x.completed).reduce((n, x) => n + w(x), 0);
  const inProgress = open.filter((x) => x.started && !x.completed).reduce((n, x) => n + w(x), 0);
  const remaining = notStarted + inProgress * 0.25;
  if (velocity <= 0 || remaining <= 0) return null;
  const weeks = remaining / velocity;
  return { at: t + weeks * 7 * DAY, early: t + weeks * 0.6 * 7 * DAY, late: t + weeks * 1.4 * 7 * DAY, velocity, remaining };
}

export interface Breakdown { name: string; total: number; done: number; pct: number }

/** Completion in story points per assignee or per label across a project's tickets (dropped tickets excluded). */
export function progressBy(issues: Issue[], kind: "assignee" | "label", defaultPoints: number = DEFAULT_STORY_POINTS): Breakdown[] {
  const groups = new Map<string, { total: number; done: number }>();
  const add = (name: string, i: Issue) => {
    const g = groups.get(name) ?? { total: 0, done: 0 };
    const pts = pointsOf(i, defaultPoints);
    g.total += pts;
    if (i.statusCategory === "done") g.done += pts;
    groups.set(name, g);
  };
  for (const i of issues.filter((x) => !isDropped(x))) {
    if (kind === "assignee") add(i.assignee?.name ?? "No assignee", i);
    else for (const l of i.labels) add(l, i);
  }
  return [...groups]
    .map(([name, g]) => ({ name, ...g, pct: Math.round((g.done / g.total) * 100) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
