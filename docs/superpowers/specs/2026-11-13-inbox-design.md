# Inbox

## Why

Today the only way to know that tickets changed is Jira's email threads and Jira's own notification panel. Both split one ticket across several threads, don't say what is new since the last look, and can't be cleared once handled. The owner wants what Linear's inbox gave them: one place that always shows the latest state of every ticket that changed and hasn't been reviewed yet, so they can decide quickly whether each change matters.

## Goals

- One inbox row per ticket. New changes to a ticket update its row and move it to the top; there are never two rows for the same ticket.
- Each row says what changed since the owner last looked, not the whole history.
- Clicking a row opens the current ticket in a pane on the right, editable exactly like the existing issue page, and marks the row read.
- Rows can be marked read/unread, archived, and deleted.
- The owner chooses which kinds of changes create notifications (see Rules).
- The unread count is visible in the sidebar.
- Works while the browser is closed: events are detected by the server during its normal sync and wait in the inbox.

## Non-goals

- Email, push or desktop notifications.
- Real-time delivery. The existing sync (every 5 minutes, and immediately when the tab regains focus) is the latency.
- Snooze, per-ticket mute, assigning or delegating from the inbox.
- Reading or changing Jira's own notification settings or watcher lists.
- More than the one mirrored Jira project.
- Notifying about the owner's own changes.

## Anti-goals (a failure even if it works)

- Duplicate rows for one ticket.
- Noise: a flood of rows after first install, or after changing rules.
- Losing read/archived state on server restart.
- Any write to Jira caused by inbox actions (read, archive and delete are local only).

## Behaviour

### Entry lifecycle

An entry belongs to one ticket and has a state: unread, read or archived. It holds the events that arrived since it was last read (an event is: ticket, kind, author, time, details such as old and new value or comment excerpt).

- A matching event on a ticket with no entry creates an unread entry.
- A matching event on an unread entry adds to it and moves it up.
- A matching event on a read entry makes it unread again; its summary lists only the events since it was read.
- A matching event on an archived entry brings it back to the inbox as unread.
- Opening a row, or opening that ticket from anywhere else in the app, marks its entry read. (Owner's call to confirm: opening elsewhere counts as having seen it.)
- Archive removes the row from the inbox view; it stays under the Archived tab. Delete removes the entry and its events permanently. Both are available as keys and from a menu.
- The row summary reads like "Status In Progress → In Review · 2 comments · Assignee → Ana". The pane shows a "since your last visit" block above the ticket with the same events, each with author and time.

### Views

Sidebar item "Inbox" with the unread count, above My issues. Tabs: Unread, All (unread and read), Archived. Selecting a row opens the ticket in the right pane. Keyboard: `J`/`K` move, `Enter` opens, `E` archives, `U` toggles unread, `Delete` deletes, plus a "go to" shortcut for the view. The keys and the "go to" combination are the builder's call, consistent with the existing shortcuts (`G I` is already taken by My issues).

### Rules (what creates events)

Configured in the settings dialog and stored on the server, since the server evaluates them while syncing.

| Change | Choices | Default |
|---|---|---|
| Mention of me in a comment | on / off | on |
| Assigned to me, or unassigned from me | on / off | on |
| Status change | off / any status / only moves into the statuses I tick | any status |
| Comments | off / only where I'm mentioned / every comment (within scope) | every comment (within scope) |
| New tickets | off / assigned to me / in epics I pick / all | assigned to me |
| Priority, due date, title, labels, type, parent, links | on / off each | off |

"Involved" means the owner is assignee, reporter, QA assignee or watcher (follower) of the ticket, or has a comment or a mention of them in the local comment mirror for that ticket. The default scope is "Tickets I'm involved in".

Jira's issue payload doesn't say who watches a ticket, so the server learns the owner's watched tickets with one extra search (`watcher = currentUser()`) on each sync and keeps that set locally. A ticket the owner starts watching counts as involved from the next sync; the change of watcher itself doesn't notify.

Evaluation order for each event:

1. Mention of me and assignment to or from me: delivered when their row is on, whatever the scope.
2. New tickets: governed only by their own row, whatever the scope.
3. Everything else (status, comments, priority, due date, title, labels, type, parent, links): delivered only if the row allows it and the ticket is within the global scope, which is either "Tickets I'm involved in" or "Whole project". With the first, a status change on an uninvolved ticket is ignored even if status changes are set to "any status".

Rules are applied when an event is detected. Changing them affects future events only; existing entries are untouched.

Defaults above are the designer's proposal and are meant to be easy to change.

### Detecting events

The server's incremental sync already finds the issues that changed. For those, it also needs what changed and who did it, which the changelog gives (the history module already requests it with `expand=changelog`), and which comments are new (comment ids not seen before). Event identity is the changelog entry id or comment id, so the 2-minute overlap in the sync window and repeated syncs can't create duplicates. Edits to existing comments don't notify. Events whose author is the owner are dropped. The owner's account id comes from Jira's `myself`, which the server already uses.

The first time the feature runs, the server records the install time. Changelog entries and comments dated at or before it never produce events, so an existing install does not flood the inbox, and a full resync (for example after a schema bump) produces none either. New comments are found by comparing against the mirror before the comment rows are overwritten. Deleted or moved tickets do not notify; an existing entry whose ticket disappears is removed.

Description edits are not scanned for mentions in this version; only comments are. The owner's own edits, wherever made, create no event and leave an existing entry's state as it is.

An entry keeps its events until it is deleted, with a read-at mark separating old from new. Marking a read entry unread by hand shows the batch of events that made it unread last time.

Read, unread, archive and delete are sent to the server through a new inbox endpoint, and so are rule changes; they don't go through the ticket mutation path. Opening a ticket anywhere calls the same read endpoint. If a deleted entry's ticket changes again, a new entry is created.

Inbox state lives in the server's SQLite database next to the mirror, never in Jira. The web app reads it through the same delta mechanism the app already uses, and applies read/archive/delete to its local copy immediately and sends them in the background, as it does for ticket edits.

## Left to the builder

Table shapes, API shape, how the web store holds inbox state, how the settings dialog is laid out, the exact keys, visual styling (match the existing sidebar and issue page), and how the epic picker for new tickets is populated.

## Calls made by the designer (not yet confirmed by the owner)

- Opening a ticket anywhere marks its entry read.
- Archived entries resurface on a new matching event.
- Comment edits and description edits don't notify, and description mentions are left out of this version.
- The default rule values, and "involved" including past commenters.
- The evaluation order for scope, mentions, assignment and new tickets.
- Watchers are found with a watcher search on each sync.
- Rule changes are not retroactive.
- Empty inbox at install; no backfill.
