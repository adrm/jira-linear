import { describe, expect, it } from "vitest";
import { markdownToAdf } from "@shared/adf";
import { adfToMarkdown, isEditable } from "./adfMarkdown";

const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const li = (...c: unknown[]) => ({ type: "listItem", content: [p(...c)] });

describe("adfToMarkdown", () => {
  it("writes paragraphs separated by blank lines", () => {
    expect(adfToMarkdown(doc(p(t("One")), p(t("Two"))))).toBe("One\n\nTwo");
  });
  it("writes headings, bold, italic, code and links", () => {
    expect(adfToMarkdown(doc({ type: "heading", attrs: { level: 2 }, content: [t("Goal")] }))).toBe("## Goal");
    expect(adfToMarkdown(doc(p(t("a "), t("b", [{ type: "strong" }]), t(" "), t("c", [{ type: "em" }]), t(" "), t("d", [{ type: "code" }]), t(" "), t("e", [{ type: "link", attrs: { href: "https://x.test" } }]))))).toBe("a **b** *c* `d` [e](https://x.test)");
  });
  it("writes bullet and numbered lists", () => {
    expect(adfToMarkdown(doc({ type: "bulletList", content: [li(t("one")), li(t("two"))] }))).toBe("- one\n- two");
    expect(adfToMarkdown(doc({ type: "orderedList", content: [li(t("one")), li(t("two"))] }))).toBe("1. one\n2. two");
  });
  it("writes tables with a header separator", () => {
    const cell = (type: string, s: string) => ({ type, content: [p(t(s))] });
    const table = { type: "table", content: [{ type: "tableRow", content: [cell("tableHeader", "A"), cell("tableHeader", "B")] }, { type: "tableRow", content: [cell("tableCell", "1"), cell("tableCell", "2")] }] };
    expect(adfToMarkdown(doc(table))).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });
  it("an empty description is an empty string", () => {
    expect(adfToMarkdown(null)).toBe("");
  });
});

describe("isEditable", () => {
  const cases: Array<[string, unknown, boolean]> = [
    ["no description", null, true],
    ["paragraphs with marks", doc(p(t("Hello "), t("world", [{ type: "strong" }]))), true],
    ["adjacent plain text pieces", doc(p(t("Hello "), t("world"))), true],
    ["headings and lists", doc({ type: "heading", attrs: { level: 3 }, content: [t("H")] }, { type: "bulletList", content: [li(t("a"))] }, { type: "orderedList", content: [li(t("b"))] }), true],
    ["a code block", doc({ type: "codeBlock", content: [t("x")] }), false],
    ["a mention", doc(p({ type: "mention", attrs: { text: "@Ana" } })), false],
    ["a hard line break", doc(p(t("a"), { type: "hardBreak" }, t("b"))), false],
    ["a nested list", doc({ type: "bulletList", content: [{ type: "listItem", content: [p(t("a")), { type: "bulletList", content: [li(t("b"))] }] }] }), false],
    ["a rule", doc({ type: "rule" }), false],
    ["a panel", doc({ type: "panel", content: [p(t("x"))] }), false],
    ["bold link (two marks at once)", doc(p(t("x", [{ type: "strong" }, { type: "link", attrs: { href: "https://x.test" } }]))), false],
    ["underline", doc(p(t("x", [{ type: "underline" }]))), false],
    ["text that would turn into a list", doc(p(t("- not a list"))), false],
    ["text that would turn into a heading", doc(p(t("# not a heading"))), false],
  ];
  it.each(cases)("%s", (_name, d, ok) => expect(isEditable(d)).toBe(ok));

  it("a description we wrote ourselves is always editable and round-trips exactly", () => {
    const md = "## Goal\n\nBuild **the thing** with `care`.\n\n- first\n- second\n\n1. one\n2. two";
    const adf = markdownToAdf(md);
    expect(isEditable(adf)).toBe(true);
    expect(adfToMarkdown(adf)).toBe(md);
  });
});
