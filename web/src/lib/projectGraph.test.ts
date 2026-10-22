import { describe, expect, it } from "vitest";
import type { TicketHistory } from "@shared/types";
import { buildGraph, forecast, progressBy } from "./projectGraph";
import { mkIssue } from "../test/fakeServer";

const DAY = 86_400_000;
const now = new Date("2026-10-15T12:00:00.000Z");
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY).toISOString();
const tk = (key: string, created: number, started: number | null, completed: number | null): TicketHistory => ({
  key, created: at(created), started: started === null ? null : at(started), completed: completed === null ? null : at(completed), canceled: null, points: null,
});

describe("buildGraph", () => {
  const tickets = [tk("ABC-1", 28, 27, 14), tk("ABC-2", 28, 20, null), tk("ABC-3", 14, null, null), tk("ABC-4", 7, 3, 1)];
  it("samples weekly from the first ticket to now, ending exactly at now", () => {
    const g = buildGraph(tickets, { targetDate: null, now })!;
    expect(g.points[0].at).toBe(new Date(at(28)).getTime());
    expect(g.points.at(-1)!.at).toBe(now.getTime());
    for (let i = 1; i < g.points.length - 1; i++) expect(g.points[i].at - g.points[i - 1].at).toBe(7 * DAY);
  });
  it("counts scope, started and completed cumulatively at each point", () => {
    const g = buildGraph(tickets, { targetDate: null, now })!;
    const last = g.points.at(-1)!;
    expect([last.scope, last.started, last.completed]).toEqual([12, 9, 6]); // 4, 3 and 2 tickets at 3 points each
    const first = g.points[0];
    expect([first.scope, first.started, first.completed]).toEqual([6, 0, 0]);
  });
  it("never lets completed exceed started or started exceed scope", () => {
    const g = buildGraph(tickets, { targetDate: null, now })!;
    for (const p of g.points) {
      expect(p.completed).toBeLessThanOrEqual(p.started);
      expect(p.started).toBeLessThanOrEqual(p.scope);
    }
  });
  it("marks the target date and stretches the axis to it when it is in the future", () => {
    const g = buildGraph(tickets, { targetDate: "2026-11-15", now })!;
    expect(g.target).toBe(new Date("2026-11-15T00:00:00.000Z").getTime());
    expect(g.to).toBe(g.target);
    expect(buildGraph(tickets, { targetDate: "2026-09-20", now })!.to).toBe(now.getTime());
  });
  it("counts what was completed in each period, for the bars", () => {
    const g = buildGraph(tickets, { targetDate: null, now })!;
    expect(g.points.reduce((n, p) => n + p.doneInPeriod, 0)).toBe(6);
    expect(g.points.at(-1)!.doneInPeriod).toBe(g.points.at(-1)!.completed - g.points.at(-2)!.completed);
  });
  it("adds markers for the initial estimate and the revised date, and stretches the axis to the later one", () => {
    const g = buildGraph(tickets, { targetDate: "2026-12-01", initialDate: "2026-11-01", revisedDate: "2026-12-01", now })!;
    expect(g.markers).toEqual([
      { kind: "initial", at: Date.parse("2026-11-01T00:00:00.000Z") },
      { kind: "revised", at: Date.parse("2026-12-01T00:00:00.000Z") },
    ]);
    expect(g.to).toBe(Date.parse("2026-12-01T00:00:00.000Z"));
  });
  it("has no markers when those dates are not set", () => {
    expect(buildGraph(tickets, { targetDate: null, now })!.markers).toEqual([]);
  });
  it("stretches the axis to the late end of the forecast so the range can be drawn", () => {
    const fc = { at: now.getTime() + 20 * DAY, early: now.getTime() + 12 * DAY, late: now.getTime() + 28 * DAY, velocity: 5, remaining: 10 };
    expect(buildGraph(tickets, { targetDate: null, forecast: fc, now })!.to).toBe(fc.late);
  });
  it("is null when there are no tickets", () => {
    expect(buildGraph([], { targetDate: null, now })).toBeNull();
  });
  it("max is the largest scope in points, so the chart can be scaled", () => {
    expect(buildGraph(tickets, { targetDate: null, now })!.max).toBe(12);
  });
});

describe("forecast", () => {
  // 2 tickets finished in each of the last four weeks, 4 not started yet
  const steady = [
    ...[3, 10, 17, 24].flatMap((d, i) => [tk(`ABC-${i * 2 + 1}`, 40, 38, d), tk(`ABC-${i * 2 + 2}`, 40, 38, d + 1)]),
    ...[20, 21, 22, 23].map((n) => tk(`ABC-${n}`, 5, null, null)),
  ];
  it("projects the finish date from recent velocity, with an early and a late estimate", () => {
    const f = forecast(steady, now)!;
    expect(f.at).toBeCloseTo(now.getTime() + 14 * DAY, -5); // 4 left at 2 a week
    expect(f.early).toBeCloseTo(now.getTime() + 14 * DAY * 0.6, -5);
    expect(f.late).toBeCloseTo(now.getTime() + 14 * DAY * 1.4, -5);
  });
  it("counts work in progress as a quarter of a ticket still to do", () => {
    const wip = [...steady.slice(0, 8), ...[20, 21, 22, 23].map((n) => tk(`ABC-${n}`, 5, 2, null))];
    const f = forecast(wip, now)!;
    expect(f.at).toBeCloseTo(now.getTime() + 7 * DAY * (4 * 0.25) / 2, -5);
  });
  it("reports the velocity and the remaining work it used, so they can be explained", () => {
    const f = forecast(steady, now)!;
    expect(f.velocity).toBeCloseTo(6, 5); // 2 tickets (6 points) every week
    expect(f.remaining).toBe(12); // 4 tickets not started, 3 points each
  });
  it("needs at least a week of history and some completed work", () => {
    expect(forecast([tk("ABC-1", 3, 2, 1), tk("ABC-2", 3, null, null)], now)).toBeNull();
    expect(forecast([tk("ABC-1", 30, 20, null), tk("ABC-2", 30, null, null)], now)).toBeNull();
  });
  it("has nothing to forecast once everything is done", () => {
    expect(forecast([tk("ABC-1", 30, 20, 10), tk("ABC-2", 30, 20, 3)], now)).toBeNull();
  });
});

describe("story points and dropped scope in the graph", () => {
  const pts = (t: TicketHistory, points: number | null, canceledDaysAgo?: number): TicketHistory => ({ ...t, points, canceled: canceledDaysAgo === undefined ? null : at(canceledDaysAgo) });

  it("measures scope, started and completed in story points, counting unestimated tickets as 3", () => {
    const g = buildGraph([pts(tk("ABC-1", 14, 12, 2), 8), tk("ABC-2", 14, null, null)], { targetDate: null, now })!;
    const last = g.points.at(-1)!;
    expect([last.scope, last.started, last.completed]).toEqual([11, 8, 8]);
  });
  it("uses the default you pass for unestimated tickets", () => {
    const g = buildGraph([tk("ABC-1", 14, null, null)], { targetDate: null, defaultPoints: 5, now })!;
    expect(g.points.at(-1)!.scope).toBe(5);
  });
  it("takes a canceled ticket out of the scope from the day it was canceled", () => {
    const g = buildGraph([tk("ABC-1", 28, null, null), pts(tk("ABC-2", 28, null, null), 5, 10)], { targetDate: null, now })!;
    const before = g.points.find((p) => p.at < now.getTime() - 10 * DAY && p.at > now.getTime() - 20 * DAY)!;
    expect(before.scope).toBe(8); // 3 + 5 while it was still planned
    expect(g.points.at(-1)!.scope).toBe(3); // the dropped 5 are gone
  });
  it("shows how much scope was dropped, for the tooltip", () => {
    const g = buildGraph([tk("ABC-1", 28, null, null), pts(tk("ABC-2", 28, null, null), 5, 10)], { targetDate: null, now })!;
    expect(g.points.at(-1)!.dropped).toBe(5);
  });
  it("forecasts from points: velocity in points a week, remaining excludes canceled work", () => {
    const history = [
      pts(tk("ABC-1", 40, 38, 3), 8), pts(tk("ABC-2", 40, 38, 10), 8), pts(tk("ABC-3", 40, 38, 17), 8), pts(tk("ABC-4", 40, 38, 24), 8),
      pts(tk("ABC-5", 40, null, null), 16), pts(tk("ABC-6", 40, null, null), 13, 5),
    ];
    const f = forecast(history, now)!;
    // weighted velocity = (8*4 + 8*3 + 8*2 + 8*1)/10 = 8 a week; 16 points left
    expect(f.at).toBeCloseTo(now.getTime() + 2 * 7 * DAY, -5);
  });
});

describe("progressBy", () => {
  const issues = [
    mkIssue("ABC-1", { assignee: { id: "u1", name: "Ana" }, statusCategory: "done", labels: ["CA:backend"] }),
    mkIssue("ABC-2", { assignee: { id: "u1", name: "Ana" }, statusCategory: "new", labels: ["CA:backend", "CA:design"] }),
    mkIssue("ABC-3", { assignee: { id: "u2", name: "Raul" }, statusCategory: "done", labels: [] }),
    mkIssue("ABC-4", { assignee: null, statusCategory: "indeterminate", labels: ["CA:design"] }),
  ];
  it("breaks completion down by assignee in story points, largest group first", () => {
    expect(progressBy(issues, "assignee")).toEqual([
      { name: "Ana", total: 6, done: 3, pct: 50 },
      { name: "No assignee", total: 3, done: 0, pct: 0 },
      { name: "Raul", total: 3, done: 3, pct: 100 },
    ]);
  });
  it("breaks completion down by label, skipping tickets without labels", () => {
    expect(progressBy(issues, "label")).toEqual([
      { name: "CA:backend", total: 6, done: 3, pct: 50 },
      { name: "CA:design", total: 6, done: 0, pct: 0 },
    ]);
  });
});
