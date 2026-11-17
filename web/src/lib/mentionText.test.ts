import { describe, expect, it } from "vitest";
import { activeMention, fromDisplay, toDisplay, uniqueLabel } from "./mentionText";

describe("toDisplay", () => {
  it("shows a mention as @Name and remembers who it is", () => {
    expect(toDisplay("Hi @[Ana López](mention:u1), please look")).toEqual({ text: "Hi @Ana López, please look", people: { "Ana López": "u1" } });
  });
  it("leaves text without mentions alone", () => {
    expect(toDisplay("plain [link](https://x.test) text")).toEqual({ text: "plain [link](https://x.test) text", people: {} });
  });
  it("unescapes brackets in names", () => {
    expect(toDisplay("@[A \\[B\\]](mention:u1)")).toEqual({ text: "@A [B]", people: { "A [B]": "u1" } });
  });
  it("keeps a second person with the same name as written Markdown, so nobody is mixed up", () => {
    const d = toDisplay("@[Ana](mention:u1) and @[Ana](mention:u2)");
    expect(d.people).toEqual({ Ana: "u1" });
    expect(d.text).toBe("@Ana and @[Ana](mention:u2)");
  });
});

describe("fromDisplay", () => {
  const people = { "Ana López": "u1", Ana: "u2" };
  it("turns @Name back into a mention", () => {
    expect(fromDisplay("Hi @Ana López, ok", people)).toBe("Hi @[Ana López](mention:u1), ok");
  });
  it("prefers the longest name", () => {
    expect(fromDisplay("@Ana López and @Ana.", people)).toBe("@[Ana López](mention:u1) and @[Ana](mention:u2).");
  });
  it("does not touch @Name inside another word or an email", () => {
    expect(fromDisplay("write to bob@Ana now, @Anabel too", people)).toBe("write to bob@Ana now, @Anabel too");
  });
  it("leaves a name that was edited by hand as plain text", () => {
    expect(fromDisplay("@Ana Lóp", people)).toBe("@[Ana](mention:u2) Lóp");
    expect(fromDisplay("@Anita", people)).toBe("@Anita");
  });
  it("escapes brackets in names", () => {
    expect(fromDisplay("@A [B]", { "A [B]": "u1" })).toBe("@[A \\[B\\]](mention:u1)");
  });
  it("round-trips", () => {
    const md = "x @[Ana López](mention:u1) y @[Bo](mention:u3)";
    const d = toDisplay(md);
    expect(fromDisplay(d.text, d.people)).toBe(md);
  });
  it("does nothing when there are no mentions", () => {
    expect(fromDisplay("a @b c", {})).toBe("a @b c");
  });
});

describe("activeMention", () => {
  it("finds the @query before the caret", () => {
    expect(activeMention("Hi @an", 6, {})).toEqual({ start: 3, query: "an" });
    expect(activeMention("@", 1, {})).toEqual({ start: 0, query: "" });
    expect(activeMention("a\n@x", 4, {})).toEqual({ start: 2, query: "x" });
  });
  it("allows spaces so full names can be typed", () => {
    expect(activeMention("@Ana Ló", 7, {})).toEqual({ start: 0, query: "Ana Ló" });
  });
  it("ignores @ inside a word, such as an email", () => {
    expect(activeMention("mail bob@ex", 11, {})).toBeNull();
  });
  it("only looks before the caret", () => {
    expect(activeMention("hi @an later", 6, {})).toEqual({ start: 3, query: "an" });
  });
  it("closes once the text after @ is a name already mentioned", () => {
    expect(activeMention("@Ana López ", 11, { "Ana López": "u1" })).toBeNull();
  });
  it("closes when the query gets too long or crosses a new @", () => {
    expect(activeMention("@" + "x".repeat(40), 41, {})).toBeNull();
    expect(activeMention("@a @b", 5, {})).toEqual({ start: 3, query: "b" });
  });
});

describe("uniqueLabel", () => {
  it("keeps the name when it is free or already means the same person", () => {
    expect(uniqueLabel("Ana", "u1", {})).toBe("Ana");
    expect(uniqueLabel("Ana", "u1", { Ana: "u1" })).toBe("Ana");
  });
  it("tells two people with one name apart", () => {
    expect(uniqueLabel("Ana", "u2abcd", { Ana: "u1" })).toBe("Ana (abcd)");
  });
});
