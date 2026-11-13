import { describe, expect, it } from "vitest";
import { formatPath, parsePath, type Route } from "./routes";

const route = (r: Partial<Route>): Route => ({ view: "active", tab: "overview", issue: null, savedView: null, ...r });

describe("routes", () => {
  it.each([
    ["/", route({})],
    ["/backlog", route({ view: "backlog" })],
    ["/mine", route({ view: "mine" })],
    ["/created", route({ view: "created" })],
    ["/review", route({ view: "review" })],
    ["/inbox", route({ view: "inbox" })],
    ["/all", route({ view: "all" })],
    ["/projects", route({ view: "projects" })],
    ["/projects/ABC-9", route({ view: "project:ABC-9" })],
    ["/projects/ABC-9/issues", route({ view: "project:ABC-9", tab: "issues" })],
    ["/issue/ABC-1", route({ issue: "ABC-1" })],
    ["/views/v1", route({ savedView: "v1" })],
  ])("%s round-trips", (path, r) => {
    expect(parsePath(path)).toEqual(r);
    expect(formatPath(r)).toBe(path);
  });

  it("treats /active, trailing slashes and unknown paths as home", () => {
    expect(parsePath("/active")).toEqual(route({}));
    expect(parsePath("/backlog/")).toEqual(route({ view: "backlog" }));
    expect(parsePath("/nope")).toEqual(route({}));
    expect(parsePath("/issue")).toEqual(route({}));
    expect(parsePath("/projects/A/other")).toEqual(route({}));
    expect(parsePath("/%E0%A4%A")).toEqual(route({}));
  });

  it("encodes ids", () => {
    expect(formatPath(route({ savedView: "a b/c" }))).toBe("/views/a%20b%2Fc");
    expect(parsePath("/views/a%20b%2Fc").savedView).toBe("a b/c");
  });
});
