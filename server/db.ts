import { DatabaseSync } from "node:sqlite";
import type { Comment, Delta, Issue } from "../shared/types.ts";
import { DEFAULT_RULES, type InboxAction, type InboxEntry, type InboxEvent, type InboxRules, type InboxState } from "../shared/inbox.ts";

export interface Store {
  currentSyncId(): number;
  upsertIssue(issue: Issue): boolean;
  upsertComment(comment: Comment): boolean;
  replaceComments(issueKey: string, comments: Comment[]): void;
  /** the live comments of one issue as last synced */
  commentsOf(issueKey: string): Comment[];
  tombstoneMissing(liveKeys: string[]): number;
  delta(since: number): Delta;
  /** tickets marked for team review; lives only in this local database, never in Jira */
  reviewMarks(): Array<{ key: string; markedAt: string }>;
  setReviewMarks(keys: string[], marked: boolean): void;
  /**
   * Takes in events not seen before and applies the entry lifecycle; returns how many became part of the inbox.
   * Every new event is remembered as seen, also those `deliver` turns down, so it can never arrive later.
   */
  addInboxEvents(events: InboxEvent[], deliver?: (e: InboxEvent) => boolean): number;
  /** remembers event ids as seen without making them events */
  markInboxSeen(ids: string[]): void;
  /**
   * every entry, most recently updated first. Events are those still of interest: for an unread entry the ones detected
   * after its read mark, for a read or archived one the batch it was last unread for; older ones stay in the database.
   */
  inbox(): InboxEntry[];
  applyInboxAction(keys: string[], action: InboxAction): void;
  inboxRules(): InboxRules;
  setInboxRules(rules: InboxRules): void;
  /** when the inbox started recording; fixed by the first call */
  inboxInstalledAt(): string;
  /** status name -> category, for the live issues */
  statusCategories(): Record<string, string>;
  getKv(key: string): string | null;
  setKv(key: string, value: string): void;
  getMutationResult(id: string): string | null;
  saveMutationResult(id: string, resultJson: string): void;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS issue (
  key TEXT PRIMARY KEY, data TEXT NOT NULL, sync_id INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS issue_sync ON issue(sync_id);
CREATE TABLE IF NOT EXISTS comment (
  id TEXT PRIMARY KEY, issue_key TEXT NOT NULL, data TEXT NOT NULL, sync_id INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS comment_sync ON comment(sync_id);
CREATE INDEX IF NOT EXISTS comment_issue ON comment(issue_key);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS review_mark (issue_key TEXT PRIMARY KEY, marked_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mutation_log (id TEXT PRIMARY KEY, result TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_entry (
  key TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL, read_at TEXT, prev_read_at TEXT
);
CREATE TABLE IF NOT EXISTS inbox_event (id TEXT PRIMARY KEY, key TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS inbox_event_key ON inbox_event(key);
CREATE TABLE IF NOT EXISTS inbox_seen (id TEXT PRIMARY KEY);
`;

/** Bump when synced data gains fields, so an existing mirror is fetched again in full. */
const SCHEMA_VERSION = "6";

export function openStore(path: string): Store {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  const getKv = (key: string): string | null => {
    const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  };
  const setKv = (key: string, value: string) => {
    db.prepare(
      "INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
  };
  const storedSchema = getKv("schema");
  if (storedSchema !== SCHEMA_VERSION) {
    if (storedSchema !== null || (db.prepare("SELECT 1 FROM issue LIMIT 1").get() !== undefined)) db.prepare("DELETE FROM kv WHERE key = 'cursor'").run();
    setKv("schema", SCHEMA_VERSION);
  }
  const nextSyncId = (): number => {
    const next = Number(getKv("sync_id") ?? "0") + 1;
    setKv("sync_id", String(next));
    return next;
  };
  const currentSyncId = () => Number(getKv("sync_id") ?? "0");

  let depth = 0;
  const tx = <T>(fn: () => T): T => {
    if (depth > 0) return fn(); // already inside a transaction
    db.exec("BEGIN");
    depth++;
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      depth--;
    }
  };

  const upsertIssue = (issue: Issue): boolean =>
    tx(() => {
      const data = JSON.stringify(issue);
      const row = db.prepare("SELECT data, deleted FROM issue WHERE key = ?").get(issue.key) as
        | { data: string; deleted: number }
        | undefined;
      if (row && row.data === data && row.deleted === 0) return false;
      db.prepare(
        `INSERT INTO issue(key, data, sync_id, deleted) VALUES(?, ?, ?, 0)
         ON CONFLICT(key) DO UPDATE SET data = excluded.data, sync_id = excluded.sync_id, deleted = 0`,
      ).run(issue.key, data, nextSyncId());
      return true;
    });

  const upsertComment = (c: Comment): boolean =>
    tx(() => {
      const data = JSON.stringify(c);
      const row = db.prepare("SELECT data, deleted FROM comment WHERE id = ?").get(c.id) as
        | { data: string; deleted: number }
        | undefined;
      if (row && row.data === data && row.deleted === 0) return false;
      db.prepare(
        `INSERT INTO comment(id, issue_key, data, sync_id, deleted) VALUES(?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET issue_key = excluded.issue_key, data = excluded.data,
           sync_id = excluded.sync_id, deleted = 0`,
      ).run(c.id, c.issueKey, data, nextSyncId());
      return true;
    });

  /** Drops an entry and its events; event ids stay in inbox_seen so re-detecting them never brings it back. */
  const removeInbox = (key: string) => {
    db.prepare("DELETE FROM inbox_event WHERE key = ?").run(key);
    db.prepare("DELETE FROM inbox_entry WHERE key = ?").run(key);
  };

  const addInboxEvents = (events: InboxEvent[], deliver: (e: InboxEvent) => boolean = () => true): number =>
    tx(() => {
      const now = new Date().toISOString();
      let added = 0;
      for (const e of events) {
        if (db.prepare("SELECT 1 FROM inbox_seen WHERE id = ?").get(e.id)) continue;
        db.prepare("INSERT INTO inbox_seen(id) VALUES(?)").run(e.id);
        if (!deliver(e)) continue;
        db.prepare("INSERT INTO inbox_event(id, key, at, data) VALUES(?, ?, ?, ?)").run(e.id, e.key, e.at, JSON.stringify({ ...e, detectedAt: now }));
        const row = db.prepare("SELECT updated_at FROM inbox_entry WHERE key = ?").get(e.key) as { updated_at: string } | undefined;
        if (!row) {
          db.prepare("INSERT INTO inbox_entry(key, state, updated_at, read_at, prev_read_at) VALUES(?, 'unread', ?, NULL, NULL)").run(e.key, e.at);
        } else {
          db.prepare("UPDATE inbox_entry SET state = 'unread', updated_at = ? WHERE key = ?").run(e.at > row.updated_at ? e.at : row.updated_at, e.key);
        }
        added++;
      }
      return added;
    });

  const setInboxState = (key: string, from: InboxState[], to: InboxState, readAt?: "now" | "previous") =>
    tx(() => {
      const row = db.prepare("SELECT state, read_at, prev_read_at FROM inbox_entry WHERE key = ?").get(key) as
        | { state: InboxState; read_at: string | null; prev_read_at: string | null }
        | undefined;
      if (!row || !from.includes(row.state)) return;
      let current = row.read_at;
      let previous = row.prev_read_at;
      if (readAt === "now") {
        previous = row.read_at;
        current = new Date().toISOString();
      } else if (readAt === "previous" && row.state === "read") {
        current = row.prev_read_at;
      }
      db.prepare("UPDATE inbox_entry SET state = ?, read_at = ?, prev_read_at = ? WHERE key = ?").run(to, current, previous, key);
    });

  return {
    currentSyncId,
    upsertIssue,
    upsertComment,
    replaceComments(issueKey, comments) {
      tx(() => {
        const keep = new Set(comments.map((c) => c.id));
        const existing = db
          .prepare("SELECT id FROM comment WHERE issue_key = ? AND deleted = 0")
          .all(issueKey) as Array<{ id: string }>;
        for (const { id } of existing) {
          if (!keep.has(id)) {
            db.prepare("UPDATE comment SET deleted = 1, sync_id = ? WHERE id = ?").run(nextSyncId(), id);
          }
        }
        for (const c of comments) upsertComment(c);
      });
    },
    commentsOf(issueKey) {
      return (db.prepare("SELECT data FROM comment WHERE issue_key = ? AND deleted = 0 ORDER BY id").all(issueKey) as Array<{ data: string }>)
        .map((r) => JSON.parse(r.data) as Comment);
    },
    tombstoneMissing(liveKeys) {
      return tx(() => {
        const live = new Set(liveKeys);
        const rows = db.prepare("SELECT key FROM issue WHERE deleted = 0").all() as Array<{ key: string }>;
        let n = 0;
        for (const { key } of rows) {
          if (!live.has(key)) {
            db.prepare("UPDATE issue SET deleted = 1, sync_id = ? WHERE key = ?").run(nextSyncId(), key);
            removeInbox(key);
            n++;
          }
        }
        return n;
      });
    },
    delta(since) {
      const issues = (
        db.prepare("SELECT data, deleted FROM issue WHERE sync_id > ? ORDER BY sync_id").all(since) as Array<
          { data: string; deleted: number }
        >
      ).map((r) => ({ ...(JSON.parse(r.data) as Issue), deleted: r.deleted === 1 }));
      const comments = (
        db.prepare("SELECT data, deleted FROM comment WHERE sync_id > ? ORDER BY sync_id").all(since) as Array<
          { data: string; deleted: number }
        >
      ).map((r) => ({ ...(JSON.parse(r.data) as Comment), deleted: r.deleted === 1 }));
      return { syncId: currentSyncId(), issues, comments } satisfies Delta;
    },
    reviewMarks() {
      return (db.prepare("SELECT issue_key, marked_at FROM review_mark ORDER BY marked_at ASC, issue_key ASC").all() as Array<{ issue_key: string; marked_at: string }>)
        .map((r) => ({ key: r.issue_key, markedAt: r.marked_at }));
    },
    setReviewMarks(keys, marked) {
      const at = new Date().toISOString();
      for (const k of keys) {
        if (marked) db.prepare("INSERT OR IGNORE INTO review_mark(issue_key, marked_at) VALUES(?, ?)").run(k, at);
        else db.prepare("DELETE FROM review_mark WHERE issue_key = ?").run(k);
      }
    },
    addInboxEvents,
    inbox() {
      const entries = db.prepare("SELECT key, state, updated_at, read_at, prev_read_at FROM inbox_entry ORDER BY updated_at DESC, key ASC").all() as Array<
        { key: string; state: InboxState; updated_at: string; read_at: string | null; prev_read_at: string | null }
      >;
      const rows = db.prepare("SELECT key, data FROM inbox_event ORDER BY at ASC, id ASC").all() as Array<{ key: string; data: string }>;
      const byKey = new Map<string, InboxEvent[]>();
      for (const r of rows) {
        const list = byKey.get(r.key);
        if (list) list.push(JSON.parse(r.data) as InboxEvent);
        else byKey.set(r.key, [JSON.parse(r.data) as InboxEvent]);
      }
      return entries.map((r) => {
        const mark = r.state === "unread" ? r.read_at : r.prev_read_at;
        const events = (byKey.get(r.key) ?? []).filter((e) => !mark || Date.parse(e.detectedAt ?? e.at) > Date.parse(mark));
        return { key: r.key, state: r.state, updatedAt: r.updated_at, readAt: r.read_at, events };
      });
    },
    markInboxSeen(ids) {
      tx(() => {
        for (const id of ids) db.prepare("INSERT OR IGNORE INTO inbox_seen(id) VALUES(?)").run(id);
      });
    },
    applyInboxAction(keys, action) {
      for (const key of keys) {
        if (action === "read") setInboxState(key, ["unread"], "read", "now");
        else if (action === "unread") setInboxState(key, ["read", "archived"], "unread", "previous");
        else if (action === "archive") setInboxState(key, ["unread", "read"], "archived");
        else if (action === "unarchive") setInboxState(key, ["archived"], "read");
        else tx(() => removeInbox(key));
      }
    },
    inboxRules() {
      const raw = getKv("inbox_rules");
      return raw ? (JSON.parse(raw) as InboxRules) : structuredClone(DEFAULT_RULES);
    },
    setInboxRules: (rules) => setKv("inbox_rules", JSON.stringify(rules)),
    inboxInstalledAt() {
      const at = getKv("inbox_installed_at");
      if (at) return at;
      const now = new Date().toISOString();
      setKv("inbox_installed_at", now);
      return now;
    },
    statusCategories() {
      const out: Record<string, string> = {};
      const rows = db.prepare("SELECT data FROM issue WHERE deleted = 0").all() as Array<{ data: string }>;
      for (const r of rows) {
        const i = JSON.parse(r.data) as Issue;
        out[i.status] = i.statusCategory;
      }
      return out;
    },
    getKv,
    setKv,
    getMutationResult(id) {
      const row = db.prepare("SELECT result FROM mutation_log WHERE id = ?").get(id) as { result: string } | undefined;
      return row ? row.result : null;
    },
    saveMutationResult(id, resultJson) {
      db.prepare("INSERT OR REPLACE INTO mutation_log(id, result, created) VALUES(?, ?, ?)").run(
        id,
        resultJson,
        new Date().toISOString(),
      );
    },
    close: () => db.close(),
  };
}
