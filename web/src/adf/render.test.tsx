import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Adf } from "./render";

const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });

describe("Adf", () => {
  it("renders paragraphs and text marks", () => {
    render(<Adf doc={doc(p(t("plain "), t("bold", [{ type: "strong" }]), t(" "), t("code", [{ type: "code" }])))} />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("code").tagName).toBe("CODE");
  });
  it("renders links that open safely in a new tab and drops javascript: urls", () => {
    render(<Adf doc={doc(p(t("ok", [{ type: "link", attrs: { href: "https://a.test" } }]), t("evil", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])))} />);
    const ok = screen.getByText("ok").closest("a")!;
    expect(ok).toHaveAttribute("href", "https://a.test");
    expect(ok).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByText("evil").closest("a")).toBeNull();
  });
  it("renders headings and lists", () => {
    render(<Adf doc={doc({ type: "heading", attrs: { level: 2 }, content: [t("Title")] }, { type: "bulletList", content: [{ type: "listItem", content: [p(t("one"))] }, { type: "listItem", content: [p(t("two"))] }] }, { type: "orderedList", content: [{ type: "listItem", content: [p(t("first"))] }] })} />);
    expect(screen.getByRole("heading", { level: 2, name: "Title" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
  it("renders code blocks, rules, mentions, inline cards and hard breaks", () => {
    const { container } = render(<Adf doc={doc({ type: "codeBlock", content: [t("let x = 1")] }, { type: "rule" }, p({ type: "mention", attrs: { text: "@Ana" } }, { type: "hardBreak" }, { type: "inlineCard", attrs: { url: "https://x.atlassian.net/browse/ABC-1" } }))} />);
    expect(container.querySelector("pre")?.textContent).toBe("let x = 1");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(screen.getByText("@Ana")).toBeInTheDocument();
    expect(container.querySelector("br")).not.toBeNull();
    expect(screen.getByRole("link", { name: "ABC-1" })).toBeInTheDocument();
  });
  it("renders tables", () => {
    const cell = (s: string) => ({ type: "tableCell", content: [p(t(s))] });
    render(<Adf doc={doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p(t("H"))] }] }, { type: "tableRow", content: [cell("v")] }] })} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "H" })).toBeInTheDocument();
  });
  it("shows unknown nodes' text content instead of failing", () => {
    render(<Adf doc={doc({ type: "somethingNew", content: [p(t("still visible"))] })} />);
    expect(screen.getByText("still visible")).toBeInTheDocument();
  });
  it("renders nothing for null", () => {
    const { container } = render(<Adf doc={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
