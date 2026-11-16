import { describe, expect, it } from "vitest";
import { collectEmoji, markdownToAdf } from "@shared/adf";
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
    ["a code block", doc({ type: "codeBlock", content: [t("x")] }), true],
    ["a mention", doc(p({ type: "mention", attrs: { id: "abc", text: "@Ana" } })), true],
    ["a mention without an account id", doc(p({ type: "mention", attrs: { text: "@Ana" } })), false],
    ["a hard line break", doc(p(t("a"), { type: "hardBreak" }, t("b"))), true],
    ["a nested list", doc({ type: "bulletList", content: [{ type: "listItem", content: [p(t("a")), { type: "bulletList", content: [li(t("b"))] }] }] }), true],
    ["a rule", doc({ type: "rule" }), true],
    ["a panel", doc({ type: "panel", attrs: { panelType: "info" }, content: [p(t("x"))] }), true],
    ["bold link (two marks at once)", doc(p(t("x", [{ type: "strong" }, { type: "link", attrs: { href: "https://x.test" } }]))), true],
    ["bold italic underline strike", doc(p(t("x", [{ type: "strong" }, { type: "em" }, { type: "underline" }, { type: "strike" }]))), true],
    ["a link with parentheses in the address", doc(p(t("x", [{ type: "link", attrs: { href: "https://x.test/a_(b)" } }]))), true],
    ["text with markup characters", doc(p(t("a * b _c_ [d] <e> `f` \\g ~~h~~ :smile: 1. no"))), true],
    ["text that would turn into a list", doc(p(t("- not a list"))), true],
    ["text that would turn into a heading", doc(p(t("# not a heading"))), true],
    ["an emoji and a smart link", doc(p({ type: "emoji", attrs: { shortName: ":smile:", text: "😄" } }, t(" "), { type: "inlineCard", attrs: { url: "https://x.test/browse/A-1" } })), true],
    ["a task list", doc({ type: "taskList", attrs: { localId: "1" }, content: [{ type: "taskItem", attrs: { localId: "2", state: "DONE" }, content: [t("done")] }] }), true],
    ["an image from Jira", doc({ type: "mediaSingle", attrs: { layout: "center", width: 50 }, content: [{ type: "media", attrs: { type: "file", id: "u-1", collection: "", width: 10, height: 20, alt: "shot.png" } }] }), true],
    ["an attachment name with spaces as its id", doc({ type: "mediaSingle", attrs: { layout: "center" }, content: [{ type: "media", attrs: { type: "file", id: "UNKNOWN_MEDIA_a b (1).png", collection: "" } }] }), true],
    ["a table with a header row", doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p(t("H | 1"))] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [p(t("v"))] }] }] }), true],
    ["a table cell holding a list (kept as it is)", doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "bulletList", content: [li(t("a"))] }] }] }] }), true],
    ["a node nobody knows (kept as it is)", doc({ type: "bodiedExtension", attrs: { extensionKey: "x" }, content: [p(t("x"))] }), true],
    ["an inline node nobody knows", doc(p(t("a"), { type: "status", attrs: { text: "Done", color: "green" } })), false],
    ["empty paragraphs between blocks", doc(p(t("a")), { type: "paragraph" }, p(t("b"))), true],
  ];
  it.each(cases)("%s", (_name, d, ok) => expect(isEditable(d)).toBe(ok));

  it("a description we wrote ourselves is always editable and round-trips exactly", () => {
    const md = "## Goal\n\nBuild **the thing** with `care`.\n\n- first\n- second\n\n1. one\n2. two";
    const adf = markdownToAdf(md);
    expect(isEditable(adf)).toBe(true);
    expect(adfToMarkdown(adf)).toBe(md);
  });
});

describe("markdown round trips", () => {
  const rt = (md: string) => adfToMarkdown(markdownToAdf(md));
  it.each([
    ["nested lists", "- a\n  - b\n    - c\n- d"],
    ["a list under a numbered item", "1. one\n   - sub\n2. two"],
    ["several paragraphs in an item", "- first\n\n  second"],
    ["a code block with a language", "```ts\nconst a = 1;\n\n  indented\n```"],
    ["a quote", "> quoted\n>\n> - item"],
    ["a panel", ":::warning\ncareful\n:::"],
    ["an expand", ":::expand More\ninside\n:::"],
    ["a task list", "- [ ] todo\n- [x] done"],
    ["marks", "**bold** *it* ~~gone~~ <u>under</u> `code` **_both_**"],
    ["a mention", "ping @[Ana](mention:abc123) now"],
    ["a hard break", "line one\\\nline two"],
    ["an image", "![shot.png](media:u-1?w=10&h=20)"],
    ["an attachment group", "![a.pdf](media:u-1?g=1)\n![b.pdf](media:u-2?g=1)"],
    ["an external image", "![logo](https://x.test/a.png)"],
    ["a block card", "<<https://x.test/browse/A-1>>"],
  ])("%s", (_n, md) => expect(rt(md)).toBe(md));

  it("keeps a task list after a bullet list as a list of its own", () => {
    const adf = markdownToAdf("- a\n\n- [x] b");
    expect(adf.content.map((n: { type: string }) => n.type)).toEqual(["bulletList", "taskList"]);
  });
  it("turns an image line into a media node that keeps its size", () => {
    const adf = markdownToAdf("![shot.png](media:u-1?sw=40&w=10&h=20)");
    expect(adf.content[0]).toEqual({ type: "mediaSingle", attrs: { layout: "center", width: 40 }, content: [{ type: "media", attrs: { type: "file", id: "u-1", collection: "", alt: "shot.png", width: 10, height: 20 } }] });
  });
  it("keeps a single newline as a space and two trailing spaces as a break", () => {
    expect(markdownToAdf("a\nb").content[0].content).toEqual([{ type: "text", text: "a b" }]);
    expect(markdownToAdf("a  \nb").content[0].content.map((n: { type: string }) => n.type)).toEqual(["text", "hardBreak", "text"]);
  });
  it("gives an emoji its picture back from what the document already knew", () => {
    const known = collectEmoji(doc(p({ type: "emoji", attrs: { shortName: ":smile:", id: "1f604", text: "😄" } })));
    expect(markdownToAdf("hi :smile: :wave:", { emoji: known }).content[0].content.filter((n: { type: string }) => n.type === "emoji").map((n: { attrs: unknown }) => n.attrs))
      .toEqual([{ shortName: ":smile:", id: "1f604", text: "😄" }, { shortName: ":wave:" }]);
  });
  it("does not let the code mark be combined with others", () => {
    expect(markdownToAdf("**`x`**").content[0].content[0].marks).toEqual([{ type: "code" }]);
  });
});
