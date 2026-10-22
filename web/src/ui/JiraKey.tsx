import { Copy } from "lucide-react";
import { useCtx } from "./context";

/**
 * A Jira key as a small chip. Click copies the link to the clipboard; ctrl/⌘-click or middle-click opens it in Jira in a new tab.
 * It is a real link underneath, so the address shows on hover.
 */
export function JiraKey({ issueKey, current }: { issueKey: string; current?: boolean }) {
  const { app, jiraUrl, openExternal, copyText } = useCtx();
  const url = `${jiraUrl}/browse/${issueKey}`;
  return (
    <a
      className="key-chip" href={url} target="_blank" rel="noopener noreferrer" aria-current={current ? "page" : undefined}
      title="Click to copy the link · ⌘-click or middle-click to open in Jira"
      onClick={(e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) { openExternal(url); return; }
        void copyText(url);
        app.getState().notify("Link copied");
      }}
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        openExternal(url);
      }}
    >
      {issueKey}<Copy size={11} aria-hidden="true" />
    </a>
  );
}
