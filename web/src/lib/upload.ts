export interface Uploaded {
  /** the id rich text uses to refer to the file */
  id: string;
  name: string;
  mime: string;
}

export const isPicture = (mime: string) => /^image\/(png|jpe?g|gif|webp|bmp|avif)$/i.test(mime);

/** Screenshots arrive as "image.png" every time; a distinct name keeps them apart on the ticket. */
function fileName(file: File): string {
  if (file.name && file.name !== "image.png") return file.name;
  const ext = /^image\/(\w+)/.exec(file.type)?.[1] ?? "png";
  return `image-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.${ext === "jpeg" ? "jpg" : ext}`;
}

export async function uploadFile(fetchFn: typeof fetch, issueKey: string, file: File): Promise<Uploaded> {
  const res = await fetchFn(`/api/upload/${issueKey}?name=${encodeURIComponent(fileName(file))}`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Upload failed (${res.status})`);
  return body as Uploaded;
}

/** How an uploaded file is written in the editor: a picture shows in place, any other file is listed as an attachment. */
export function mediaMarkdown(u: Uploaded): string {
  const alt = u.name.replace(/[\\[\]]/g, "\\$&");
  return `![${alt}](media:${encodeURIComponent(u.id)}${isPicture(u.mime) ? "" : "?g=1"})`;
}

/** Puts `snippet` on a line of its own at the selection and returns the new text and where the cursor goes. */
export function insertBlock(value: string, start: number, end: number, snippet: string): { value: string; cursor: number } {
  const head = value.slice(0, start), tail = value.slice(end);
  const before = head === "" || head.endsWith("\n\n") ? "" : head.endsWith("\n") ? "\n" : "\n\n";
  const after = tail.startsWith("\n\n") ? "" : tail.startsWith("\n") ? "\n" : "\n\n";
  const inserted = before + snippet + after;
  return { value: head + inserted + tail, cursor: head.length + inserted.length };
}
