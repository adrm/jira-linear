import { describe, expect, it } from "vitest";
import { statusStyle } from "./statusColors";
import { STATUS_FLOW } from "./workflow";

describe("statusStyle", () => {
  it("gives every started status in the workflow its own colour", () => {
    const hues = ["In Development", "Code Review", "In Testing (QA)", "In Fix", "In Testing (UAT)", "Go-Live Ready"].map((s) => statusStyle(s, "indeterminate").hue);
    expect(new Set(hues).size).toBe(hues.length);
  });
  it("classifies statuses the way Linear's icons do", () => {
    expect(statusStyle("Backlog", "new").kind).toBe("backlog");
    expect(statusStyle("Ready for Dev", "new").kind).toBe("todo");
    expect(statusStyle("Code Review", "indeterminate").kind).toBe("started");
    expect(statusStyle("Cerrada", "done").kind).toBe("done");
    expect(statusStyle("No en progreso", "done").kind).toBe("canceled");
  });
  it("done has its own colour, distinct from every started status", () => {
    const done = statusStyle("Cerrada", "done").hue;
    for (const s of ["In Development", "Code Review", "In Testing (QA)"]) expect(statusStyle(s, "indeterminate").hue).not.toBe(done);
  });
  it("unknown started statuses still get a colour, stable between calls", () => {
    expect(statusStyle("Something New", "indeterminate")).toEqual(statusStyle("Something New", "indeterminate"));
    expect(Number.isFinite(statusStyle("Something New", "indeterminate").hue)).toBe(true);
  });
  it("backlog, todo and canceled are neutral (no chroma)", () => {
    for (const [s, c] of [["Backlog", "new"], ["Ready for Dev", "new"], ["No en progreso", "done"]] as const) expect(statusStyle(s, c).chroma).toBeLessThan(10);
  });
});

describe("STATUS_FLOW", () => {
  it("lists statuses from least to most advanced, started ones in workflow order", () => {
    const i = (s: string) => STATUS_FLOW.indexOf(s);
    expect(i("Backlog")).toBeLessThan(i("Ready for Dev"));
    expect(i("Ready for Dev")).toBeLessThan(i("In Development"));
    expect(i("In Development")).toBeLessThan(i("Code Review"));
    expect(i("Code Review")).toBeLessThan(i("In Testing (QA)"));
    expect(i("In Testing (QA)")).toBeLessThan(i("In Testing (UAT)"));
    expect(i("In Testing (UAT)")).toBeLessThan(i("Go-Live Ready"));
    expect(i("Go-Live Ready")).toBeLessThan(i("Cerrada"));
  });
});
