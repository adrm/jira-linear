import { useCallback, useEffect, useRef, useState } from "react";
import type { InboxAction, InboxEntry, InboxState } from "@shared/inbox";

const VERB: Record<InboxAction, string> = { read: "mark as read", unread: "mark as unread", archive: "archive", unarchive: "unarchive", delete: "delete" };

/** The state an entry ends in, or null when the action does not apply to it (the server ignores those too). */
function afterAction(entry: InboxEntry, action: InboxAction): InboxState | null {
  if (action === "read") return entry.state === "unread" ? "read" : null;
  if (action === "unread") return entry.state === "unread" ? null : "unread";
  if (action === "archive") return entry.state === "archived" ? null : "archived";
  if (action === "unarchive") return entry.state === "archived" ? "read" : null;
  return entry.state;
}

/**
 * The inbox as the server holds it, with actions applied here at once and sent in the background; a refusal
 * puts the entries back and says so. Nothing in it touches Jira.
 */
export function useInbox(fetchFn: typeof fetch, notify: (text: string) => void) {
  const [inbox, setInbox] = useState<InboxEntry[]>([]);
  const current = useRef(inbox);
  current.current = inbox;
  // Callers pass new function objects on every render; the callbacks below must stay the same ones.
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const refreshInbox = useCallback(() => {
    fetchRef.current("/api/inbox").then((r) => (r.ok ? r.json() : null)).then((rows: InboxEntry[] | null) => { if (rows) setInbox(rows); }).catch(() => {});
  }, []);

  useEffect(() => refreshInbox(), [refreshInbox]);

  const inboxAct = useCallback((keys: string[], action: InboxAction) => {
    const before = current.current;
    const changed = keys.filter((k) => { const e = before.find((x) => x.key === k); return e && afterAction(e, action) !== null; });
    if (!changed.length) return;
    setInbox(before.flatMap((e) => {
      if (!changed.includes(e.key)) return [e];
      if (action === "delete") return [];
      return [{ ...e, state: afterAction(e, action)!, readAt: action === "read" ? new Date().toISOString() : e.readAt }];
    }));
    const noun = changed.length === 1 ? changed[0] : `${changed.length} tickets`;
    fetchRef.current("/api/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys: changed, action }) })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
      .then(refreshInbox)
      .catch(() => {
        setInbox(before);
        notifyRef.current(`Couldn’t ${VERB[action]} ${noun}`);
      });
  }, [refreshInbox]);

  return { inbox, inboxAct, refreshInbox };
}
