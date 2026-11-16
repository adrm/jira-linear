import { useRef, useState, type ClipboardEvent, type DragEvent, type RefObject } from "react";
import { Paperclip } from "lucide-react";
import { insertBlock, mediaMarkdown, uploadFile } from "../lib/upload";
import { useCtx } from "./context";

/**
 * Adds files to the ticket from a text box: pasted pictures, dropped files, or the attach button. Each file is stored
 * on the ticket and written into the text at the cursor, where it shows as a picture or an attachment.
 */
export function useAttach(issueKey: string, box: RefObject<HTMLTextAreaElement | null>, setValue: (f: (prev: string) => string) => void) {
  const { fetchFn } = useCtx();
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const attach = async (files: File[]) => {
    if (!files.length) return;
    setError(null);
    setBusy((n) => n + files.length);
    let pos = box.current?.selectionStart ?? Infinity;
    for (const file of files) {
      try {
        const snippet = mediaMarkdown(await uploadFile(fetchFn, issueKey, file));
        setValue((prev) => {
          const at = Math.min(pos, prev.length);
          const r = insertBlock(prev, at, at, snippet);
          pos = r.cursor;
          return r.value;
        });
      } catch (e) {
        setError(`${file.name || "File"}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  return {
    busy,
    error,
    attach,
    handlers: {
      onPaste: (e: ClipboardEvent) => {
        const files = [...(e.clipboardData?.files ?? [])];
        // Copying cells from a spreadsheet puts a picture and the text on the clipboard: keep the text.
        if (files.length && !e.clipboardData.getData?.("text/plain")) { e.preventDefault(); void attach(files); }
      },
      onDragOver: (e: DragEvent) => { if ([...e.dataTransfer.types].includes("Files")) e.preventDefault(); },
      onDrop: (e: DragEvent) => {
        const files = [...e.dataTransfer.files];
        if (files.length) { e.preventDefault(); void attach(files); }
      },
    },
  };
}

/** The attach button and the upload status that go under a text box. */
export function AttachBar({ attach, busy, error }: { attach: (files: File[]) => void; busy: number; error: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="attach-bar">
      <button type="button" className="icon-btn" aria-label="Attach files" title="Attach files (or paste or drop a picture)" onClick={() => input.current?.click()}>
        <Paperclip size={14} />
      </button>
      <input ref={input} type="file" multiple hidden aria-hidden="true" tabIndex={-1} onChange={(e) => { void attach([...(e.target.files ?? [])]); e.target.value = ""; }} />
      {busy > 0 && <span className="muted" role="status">Uploading…</span>}
      {error && <span className="attach-error" role="alert">{error}</span>}
    </span>
  );
}
