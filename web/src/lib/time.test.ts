import { describe, expect, it } from "vitest";
import { timeAgo } from "./time";

const now = new Date("2026-10-15T12:00:00.000Z");
describe("timeAgo", () => {
  it.each([
    ["2026-10-15T11:59:40.000Z", "now"],
    ["2026-10-15T11:55:00.000Z", "5m"],
    ["2026-10-15T09:00:00.000Z", "3h"],
    ["2026-10-13T12:00:00.000Z", "2d"],
    ["2026-09-15T12:00:00.000Z", "Sep 15"],
    ["2025-03-02T12:00:00.000Z", "Mar 2, 2025"],
  ])("%s -> %s", (iso, out) => expect(timeAgo(iso, now)).toBe(out));
  it("understands Jira's +0000 offset format", () => {
    expect(timeAgo("2026-10-15T11:00:00.000+0000", now)).toBe("1h");
  });
  it("is stable for unparseable input", () => {
    expect(timeAgo("garbage", now)).toBe("");
  });
});
