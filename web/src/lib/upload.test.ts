import { describe, expect, it, vi } from "vitest";
import { insertBlock, mediaMarkdown, uploadFile } from "./upload";

describe("mediaMarkdown", () => {
  it("writes a picture to show in place and any other file as an attachment", () => {
    expect(mediaMarkdown({ id: "u-1", name: "a.png", mime: "image/png" })).toBe("![a.png](media:u-1)");
    expect(mediaMarkdown({ id: "u-2", name: "r [v2].pdf", mime: "application/pdf" })).toBe("![r \\[v2\\].pdf](media:u-2?g=1)");
  });
  it("treats pictures that can carry script as plain attachments", () => {
    expect(mediaMarkdown({ id: "u-3", name: "x.svg", mime: "image/svg+xml" })).toContain("g=1");
  });
});

describe("insertBlock", () => {
  it("puts the snippet on its own lines and the cursor after it", () => {
    expect(insertBlock("Hello world", 5, 5, "![x](media:1)")).toEqual({ value: "Hello\n\n![x](media:1)\n\n world", cursor: 5 + 2 + 13 + 2 });
  });
  it("adds nothing extra at the start, after a blank line or at the end", () => {
    expect(insertBlock("", 0, 0, "S").value).toBe("S\n\n");
    expect(insertBlock("a\n\n", 3, 3, "S").value).toBe("a\n\nS\n\n");
    expect(insertBlock("a\n", 2, 2, "S").value).toBe("a\n\nS\n\n");
  });
  it("replaces a selection", () => {
    expect(insertBlock("abcdef", 2, 4, "S").value).toBe("ab\n\nS\n\nef");
  });
});

describe("uploadFile", () => {
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)));
  it("posts the file to the ticket and gives back what to reference it by", async () => {
    const fetchFn = ok({ id: "u-1", name: "a.png", mime: "image/png" });
    const r = await uploadFile(fetchFn as never, "ABC-1", new File(["x"], "a b.png", { type: "image/png" }));
    expect(r.id).toBe("u-1");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/upload/ABC-1?name=a%20b.png");
    expect(init.method).toBe("POST");
  });
  it("gives pasted screenshots a name of their own", async () => {
    const fetchFn = ok({ id: "u", name: "n", mime: "image/png" });
    await uploadFile(fetchFn as never, "ABC-1", new File(["x"], "image.png", { type: "image/png" }));
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toMatch(/name=image-\d{14}\.png$/);
  });
  it("reports why the server refused", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: "File is larger than 25 MB" }), { status: 413 }));
    await expect(uploadFile(fetchFn as never, "ABC-1", new File(["x"], "a.zip"))).rejects.toThrow("File is larger than 25 MB");
  });
});
