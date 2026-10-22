import { describe, expect, it } from "vitest";
import type { Issue, IssueLink } from "@shared/types";
import { blockState } from "./relations";
import { mkIssue } from "../test/fakeServer";

const link = (direction: "inward" | "outward", key: string, type = "Blocks"): IssueLink => ({ id: `${direction}${key}`, type, direction, phrase: "", key, summary: key });
const open = (key: string, links: IssueLink[] = []) => mkIssue(key, { links, statusCategory: "indeterminate" });
const done = (key: string, links: IssueLink[] = []) => mkIssue(key, { links, statusCategory: "done", status: "Cerrada" });
const world = (...issues: Issue[]) => Object.fromEntries(issues.map((i) => [i.key, i]));

describe("blockState", () => {
  it("is blocked when an open issue blocks it", () => {
    const w = world(open("A", [link("inward", "B")]), open("B", [link("outward", "A")]));
    expect(blockState(w.A, w)).toBe("blocked");
  });
  it("is blocking when it blocks an open issue", () => {
    const w = world(open("A", [link("inward", "B")]), open("B", [link("outward", "A")]));
    expect(blockState(w.B, w)).toBe("blocking");
  });
  it("blocked wins when an issue is both blocked and blocking", () => {
    const w = world(open("A", [link("inward", "B"), link("outward", "C")]), open("B"), open("C"));
    expect(blockState(w.A, w)).toBe("blocked");
  });
  it("is not blocked once the blocker is done", () => {
    const w = world(open("A", [link("inward", "B")]), done("B", [link("outward", "A")]));
    expect(blockState(w.A, w)).toBeNull();
  });
  it("is not blocking when the blocked issue is already done", () => {
    const w = world(open("B", [link("outward", "A")]), done("A", [link("inward", "B")]));
    expect(blockState(w.B, w)).toBeNull();
  });
  it("a done issue shows no badge at all", () => {
    const w = world(done("A", [link("inward", "B")]), open("B"));
    expect(blockState(w.A, w)).toBeNull();
  });
  it("only Blocks links count, not Relates", () => {
    const w = world(open("A", [link("inward", "B", "Relates")]), open("B"));
    expect(blockState(w.A, w)).toBeNull();
  });
  it("treats a blocker that is not synced as still blocking", () => {
    const w = world(open("A", [link("inward", "GONE-1")]));
    expect(blockState(w.A, w)).toBe("blocked");
  });
  it("is null with no links", () => {
    const w = world(open("A"));
    expect(blockState(w.A, w)).toBeNull();
  });
});
