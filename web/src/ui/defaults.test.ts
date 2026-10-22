import { describe, expect, it } from "vitest";
import { contextDefaults } from "./defaults";

const me = { id: "u1", name: "Ana" };
describe("contextDefaults", () => {
  it("a new issue made inside a project belongs to that project", () => {
    expect(contextDefaults("project:ABC-10", me)).toEqual({ parentKey: "ABC-10" });
  });
  it("a new issue made in My issues is yours", () => {
    expect(contextDefaults("mine", me)).toEqual({ assigneeId: "u1" });
    expect(contextDefaults("mine", null)).toEqual({});
  });
  it("other views add nothing", () => {
    for (const v of ["active", "backlog", "all", "projects"] as const) expect(contextDefaults(v, me)).toEqual({});
  });
});
