import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
  describe("pictures and attachments", () => {
    const file = (attrs: Record<string, unknown>) => ({ type: "media", attrs: { type: "file", collection: "", ...attrs } });
    it("shows a picture from the ticket through the server, linked to the full size", () => {
      render(<Adf issueKey="ABC-1" doc={doc({ type: "mediaSingle", attrs: { layout: "center", width: 40 }, content: [file({ id: "m 1", alt: "shot.png" })] })} />);
      const img = screen.getByRole("img", { name: "shot.png" });
      expect(img).toHaveAttribute("src", "/api/media/ABC-1/m%201?name=shot.png");
      expect(img.closest("a")).toHaveAttribute("target", "_blank");
      expect(img.closest("figure")).toHaveStyle({ width: "40%" });
    });
    it("falls back to a link with the file name when the picture cannot be loaded", () => {
      render(<Adf issueKey="ABC-1" doc={doc({ type: "mediaSingle", content: [file({ id: "m1", alt: "doc.pdf" })] })} />);
      fireEvent.error(screen.getByRole("img", { name: "doc.pdf" }));
      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.getByRole("link", { name: "doc.pdf" })).toHaveAttribute("href", "/api/media/ABC-1/m1?name=doc.pdf");
    });
    it("lists attachment groups and inline files as links", () => {
      render(<Adf issueKey="ABC-1" doc={doc({ type: "mediaGroup", content: [file({ id: "a", alt: "a.pdf" }), file({ id: "b" })] }, p({ type: "mediaInline", attrs: { type: "file", id: "c", collection: "" } }))} />);
      expect(screen.getByRole("link", { name: "a.pdf" })).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: "Attachment" })).toHaveLength(2);
      expect(screen.queryByRole("img")).toBeNull();
    });
    it("shows only the name when the ticket is not known, and never loads unsafe addresses", () => {
      render(<Adf doc={doc({ type: "mediaSingle", content: [file({ id: "m1", alt: "shot.png" })] }, { type: "mediaSingle", content: [{ type: "media", attrs: { type: "external", url: "blob:https://x.test/1", alt: "blob" } }] }, { type: "mediaSingle", content: [{ type: "media", attrs: { type: "external", url: "https://x.test/a.png", alt: "ext" } }] })} />);
      expect(screen.getByText("shot.png")).toBeInTheDocument();
      expect(screen.getByText("blob")).toBeInTheDocument();
      expect(screen.getAllByRole("img")).toHaveLength(1);
      expect(screen.getByRole("img", { name: "ext" })).toHaveAttribute("src", "https://x.test/a.png");
    });
  });
  it("renders task lists, expands, coloured text and panel types", () => {
    const { container } = render(<Adf doc={doc(
      { type: "taskList", content: [{ type: "taskItem", attrs: { state: "DONE" }, content: [t("done")] }, { type: "taskItem", attrs: { state: "TODO" }, content: [t("todo")] }] },
      { type: "expand", attrs: { title: "More" }, content: [p(t("inside"))] },
      { type: "panel", attrs: { panelType: "warning" }, content: [p(t("careful"))] },
      p(t("red", [{ type: "textColor", attrs: { color: "#ff0000" } }]), t("bad", [{ type: "textColor", attrs: { color: "url(x)" } }])),
    )} />);
    expect(screen.getByRole("checkbox", { name: "Done" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "To do" })).not.toBeChecked();
    expect(container.querySelector("details summary")?.textContent).toBe("More");
    expect(container.querySelector(".adf-panel-warning")).not.toBeNull();
    expect(screen.getByText("red")).toHaveStyle({ color: "#ff0000" });
    expect(screen.getByText("bad").tagName).not.toBe("SPAN");
  });
});
