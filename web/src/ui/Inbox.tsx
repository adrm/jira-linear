import { useEffect, useMemo, useRef, useState } from "react";
import type { InboxEntry, InboxEvent } from "@shared/inbox";
import { describeEvent, inboxRows, summarizeEvents, unreadCount, unseenEvents, type InboxTab } from "../lib/inbox";
import { timeAgo } from "../lib/time";
import { isEpic } from "../lib/projects";
import { ShowSidebar } from "./Chrome";
import { IssuePage } from "./IssuePage";
import { Avatar } from "./icons";
import { useCtx, useIssueMap, useUi } from "./context";

const TABS: Array<[InboxTab, string]> = [["unread", "Unread"], ["all", "All"], ["archived", "Archived"]];

/** Marks an unread entry read the first time its ticket is opened, in the inbox or anywhere else in the app. */
export function useReadOnOpen() {
  const { inbox, inboxAct } = useCtx();
  const key = useUi((s) => (s.view === "inbox" || s.detailOpen ? s.selectedKey : null));
  const handled = useRef<string | null>(null);
  const entry = key ? inbox.find((e) => e.key === key) : undefined;
  useEffect(() => {
    if (!key) { handled.current = null; return; }
    if (!entry || handled.current === key) return;
    handled.current = key;
    if (entry.state === "unread") inboxAct([key], "read");
  }, [key, entry, inboxAct]);
}

function Row({ entry, selected, summary, onOpen }: { entry: InboxEntry; selected: boolean; summary: string; onOpen: () => void }) {
  const issues = useIssueMap();
  const unread = entry.state === "unread";
  const author = entry.events[entry.events.length - 1]?.author?.name ?? null;
  return (
    <div role="option" aria-selected={selected} data-key={entry.key} className={`inbox-row${selected ? " is-selected" : ""}${unread ? " is-unread" : ""}`} onClick={onOpen}>
      <span className="inbox-dot" aria-hidden="true" />
      <div className="inbox-row-body">
        <div className="inbox-row-top">
          <strong className="inbox-key">{entry.key}</strong>{" "}
          <span className="inbox-title">{issues[entry.key]?.summary ?? ""}</span>{" "}
          <time className="muted">{timeAgo(entry.updatedAt)}</time>
        </div>
        <div className="inbox-row-sum muted">{author && <Avatar name={author} />}{" "}<span>{summary}</span></div>
      </div>
    </div>
  );
}

function SinceLastVisit({ events }: { events: InboxEvent[] }) {
  if (!events.length) return null;
  return (
    <section role="region" aria-label="Since your last visit" className="inbox-since">
      <h2>Since your last visit</h2>
      <ul>
        {events.map((e) => (
          <li key={e.id}><span>{describeEvent(e)}</span><span className="muted">{e.author?.name ? `${e.author.name} · ` : ""}{timeAgo(e.at)}</span></li>
        ))}
      </ul>
    </section>
  );
}

/** Every ticket with changes the owner has not dealt with: the list on the left, the ticket itself on the right. */
export function Inbox() {
  const { ui, inbox } = useCtx();
  const tab = useUi((s) => s.inboxTab);
  const key = useUi((s) => s.selectedKey);
  const issues = useIssueMap();
  const rows = useMemo(() => inboxRows(inbox, tab, key), [inbox, tab, key]);
  const selected = key ? inbox.find((e) => e.key === key) : undefined;
  // What was new when the ticket was opened stays on screen after reading it has cleared the unseen mark.
  const [seen, setSeen] = useState<Record<string, InboxEvent[]>>({});
  useEffect(() => {
    if (selected?.state === "unread") setSeen((s) => ({ ...s, [selected.key]: unseenEvents(selected) }));
  }, [selected]);
  const open = key && issues[key] && !isEpic(issues[key]);
  const unread = unreadCount(inbox);
  return (
    <div className="inbox">
      <section className="inbox-list" aria-label="Notifications">
        <header className="viewhead">
          <ShowSidebar />
          <h1 className="viewtitle">Inbox{unread > 0 && <span className="count">{unread}</span>}</h1>
          <div role="tablist" aria-label="Inbox" className="seg tabs-seg">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => ui.getState().setInboxTab(id)}>{label}</button>
            ))}
          </div>
        </header>
        <div role="listbox" aria-label="Inbox" className="inbox-rows">
          {rows.map((e) => {
            const unseen = unseenEvents(e);
            return <Row key={e.key} entry={e} selected={e.key === key} summary={summarizeEvents(unseen.length ? unseen : e.events)} onOpen={() => ui.getState().select(e.key)} />;
          })}
          {rows.length === 0 && <p className="muted inbox-empty">{tab === "unread" ? "You’re all caught up." : tab === "archived" ? "Nothing archived." : "No notifications yet."}</p>}
        </div>
      </section>
      <section className="inbox-pane" aria-label="Notification">
        {open ? (
          <>
            <SinceLastVisit events={seen[key] ?? []} />
            <IssuePage embedded />
          </>
        ) : <p className="muted inbox-empty">Select a notification to see the ticket.</p>}
      </section>
    </div>
  );
}
