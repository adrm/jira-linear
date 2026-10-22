import { DatabaseSync } from "node:sqlite";
import type { Comment, Delta, Issue } from "../shared/types.ts";

export interface Store {
  currentSyncId(): number;
  upsertIssue(issue: Issue): boolean;
  upsertComment(comment: Comment): boolean;
  replaceComments(issueKey: string, comments: Comment[]): void;
  tombstoneMissing(liveKeys: string[]): number;
  delta(since: number): Delta;
  /** tickets marked for team review; lives only in this local database, never in Jira */
  reviewMarks(): Array<{ key: string; markedAt: string }>;
  setReviewMarks(keys: string[], marked: boolean): void;
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
`;

/** Bump when synced data gains fields, so an existing mirror is fetched again in full. */
const SCHEMA_VERSION = "3";

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
    tombstoneMissing(liveKeys) {
      return tx(() => {
        const live = new Set(liveKeys);
        const rows = db.prepare("SELECT key FROM issue WHERE deleted = 0").all() as Array<{ key: string }>;
        let n = 0;
        for (const { key } of rows) {
          if (!live.has(key)) {
            db.prepare("UPDATE issue SET deleted = 1, sync_id = ? WHERE key = ?").run(nextSyncId(), key);
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
