import { beforeEach, describe, expect, it } from "vitest";
import { createAppStore, memoryPersistence, viewIssues } from "./store";
import { FakeServer, mkIssue } from "../test/fakeServer";

let server: FakeServer;
beforeEach(() => {
  server = new FakeServer();
  server.put(mkIssue("ABC-1"));
  server.put(mkIssue("ABC-2", { summary: "Epic", issuetype: "Epic" }));
});

const make = (persistence = memoryPersistence()) => {
  let n = 0;
  const store = createAppStore({ fetch: server.fetch, persistence, newId: () => `id${++n}` });
  return { store, persistence };
};
const keys = (s: ReturnType<typeof make>["store"]) => Object.keys(viewIssues(s.getState())).sort();

describe("sync", () => {
  it("bootstraps on the first sync and keeps live issues and comments", async () => {
    server.addComment({ id: "c1", issueKey: "ABC-1", author: null, bodyAdf: null, created: "x", updated: "x" });
    const { store } = make();
    await store.getState().sync();
    expect(keys(store)).toEqual(["ABC-1", "ABC-2"]);
    expect(store.getState().comments["ABC-1"]).toHaveLength(1);
    expect(store.getState().syncId).toBe(server.syncId);
  });

  it("applies deltas: updates rows and removes deleted ones", async () => {
    const { store } = make();
    await store.getState().sync();
    server.put(mkIssue("ABC-1", { summary: "Changed" }));
    server.remove("ABC-2");
    await store.getState().sync();
    expect(viewIssues(store.getState())["ABC-1"].summary).toBe("Changed");
    expect(keys(store)).toEqual(["ABC-1"]);
  });

  it("restores from persistence on load without any network", async () => {
    const a = make();
    await a.store.getState().sync();
    server.offline = true;
    const b = make(a.persistence);
    await b.store.getState().load();
    expect(keys(b.store)).toEqual(["ABC-1", "ABC-2"]);
    expect(b.store.getState().ready).toBe(true);
  });

  it("marks offline when sync cannot reach the server and recovers later", async () => {
    const { store } = make();
    server.offline = true;
    await store.getState().sync();
    expect(store.getState().online).toBe(false);
    server.offline = false;
    await store.getState().sync();
    expect(store.getState().online).toBe(true);
    expect(keys(store)).toHaveLength(2);
  });
});

describe("mutations", () => {
  it("shows the change immediately, before the server answers", async () => {
    const { store } = make();
    await store.getState().sync();
    let release!: () => void;
    server.gate = new Promise<void>((r) => (release = r));
    const done = store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "Optimistic" });
    expect(viewIssues(store.getState())["ABC-1"].summary).toBe("Optimistic");
    expect(store.getState().issues["ABC-1"].summary).toBe("Summary ABC-1"); // server truth untouched
    release();
    await done;
  });

  it("confirms: clears pending and holds the server value", async () => {
    const { store } = make();
    await store.getState().sync();
    await store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "Done" });
    expect(store.getState().pending).toHaveLength(0);
    expect(store.getState().issues["ABC-1"].summary).toBe("Done");
  });

  it("rolls back on a rejected mutation and records the error", async () => {
    const { store } = make();
    await store.getState().sync();
    server.failNext.push({ status: 400, error: 'No transition to "Nope"' });
    await store.getState().mutate({ op: "setStatus", key: "ABC-1", status: "Nope" });
    expect(viewIssues(store.getState())["ABC-1"].status).toBe("Backlog");
    expect(store.getState().pending).toHaveLength(0);
    expect(store.getState().failed).toHaveLength(1);
    expect(store.getState().failed[0].error).toContain("No transition");
  });

  it("keeps the mutation queued when offline, then drains in order with the same ids", async () => {
    const { store } = make();
    await store.getState().sync();
    server.offline = true;
    await store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "First" });
    await store.getState().mutate({ op: "setStatus", key: "ABC-1", status: "Code Review" });
    expect(store.getState().pending.map((p) => p.op)).toEqual(["setSummary", "setStatus"]);
    expect(store.getState().online).toBe(false);
    const ids = store.getState().pending.map((p) => p.id);

    server.offline = false;
    await store.getState().drain();
    expect(store.getState().pending).toHaveLength(0);
    expect(server.received.map((r) => r.id)).toEqual(ids);
    expect(store.getState().issues["ABC-1"]).toMatchObject({ summary: "First", status: "Code Review" });
  });

  it("sends mutations one at a time, in order", async () => {
    const { store } = make();
    await store.getState().sync();
    await Promise.all([
      store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "A" }),
      store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "B" }),
    ]);
    expect(server.received.map((r) => r.op)).toEqual(["setSummary", "setSummary"]);
    expect(store.getState().issues["ABC-1"].summary).toBe("B");
  });

  it("persists pending mutations and drains them after a reload", async () => {
    const a = make();
    await a.store.getState().sync();
    server.offline = true;
    await a.store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "Survives reload" });
    server.offline = false;
    const b = make(a.persistence);
    await b.store.getState().load();
    expect(viewIssues(b.store.getState())["ABC-1"].summary).toBe("Survives reload");
    await b.store.getState().drain();
    expect(server.rows.get("ABC-1")!.summary).toBe("Survives reload");
  });

  it("rebases: a server update to another field survives while a mutation is pending", async () => {
    const { store } = make();
    await store.getState().sync();
    server.offline = true;
    await store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "Mine" });
    server.offline = false;
    server.put(mkIssue("ABC-1", { summary: "Theirs", priority: "Highest" }));
    await store.getState().sync();
    const v = viewIssues(store.getState())["ABC-1"];
    expect(v.summary).toBe("Mine"); // pending overlay wins until confirmed
    expect(v.priority).toBe("Highest"); // server change to other fields is kept
  });

  it("createIssue shows a temporary row that is replaced by the real issue", async () => {
    const { store } = make();
    await store.getState().sync();
    server.offline = true;
    await store.getState().mutate({ op: "createIssue", summary: "Brand new", issuetype: "Task" });
    expect(keys(store).some((k) => k.startsWith("NEW-"))).toBe(true);
    server.offline = false;
    await store.getState().drain();
    expect(keys(store).some((k) => k.startsWith("NEW-"))).toBe(false);
    expect(Object.values(viewIssues(store.getState())).filter((i) => i.summary === "Brand new")).toHaveLength(1);
  });

  it("dismissFailed removes an entry from the failed list", async () => {
    const { store } = make();
    await store.getState().sync();
    server.failNext.push({ status: 400, error: "bad" });
    await store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "x" });
    store.getState().dismissFailed(store.getState().failed[0].mutation.id);
    expect(store.getState().failed).toHaveLength(0);
  });
});

describe("batches, undo and toasts", () => {
  it("a reversible change leaves a toast with an undo entry", async () => {
    const { store } = make();
    await store.getState().sync();
    await store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "Changed" });
    const s = store.getState();
    expect(s.toasts.map((t) => [t.text, !!t.entryId])).toEqual([["Renamed", true]]);
    expect(s.undoStack).toHaveLength(1);
  });

  it("undo puts the previous value back through the normal queue", async () => {
    const { store } = make();
    await store.getState().sync();
    await store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "Changed" });
    await store.getState().undo();
    expect(server.rows.get("ABC-1")!.summary).toBe("Summary ABC-1");
    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().toasts.at(-1)!.text).toBe("Undid: Renamed");
    expect(store.getState().toasts.at(-1)!.entryId).toBeUndefined(); // undoing is not itself undoable
  });

  it("mutateMany applies a whole selection as one undoable step with one toast", async () => {
    const { store } = make();
    await store.getState().sync();
    await store.getState().mutateMany([
      { op: "setSummary", key: "ABC-1", summary: "A" },
      { op: "setSummary", key: "ABC-2", summary: "B" },
    ]);
    expect(server.received.map((r) => r.op)).toEqual(["setSummary", "setSummary"]);
    expect(store.getState().toasts.map((t) => t.text)).toEqual(["2 issues updated"]);
    expect(store.getState().undoStack).toHaveLength(1);
    await store.getState().undo();
    expect([server.rows.get("ABC-1")!.summary, server.rows.get("ABC-2")!.summary]).toEqual(["Summary ABC-1", "Epic"]);
  });

  it("undoes several steps in reverse order", async () => {
    const { store } = make();
    await store.getState().sync();
    await store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "One" });
    await store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "Two" });
    await store.getState().undo();
    expect(server.rows.get("ABC-1")!.summary).toBe("One");
    await store.getState().undo();
    expect(server.rows.get("ABC-1")!.summary).toBe("Summary ABC-1");
  });

  it("changes that cannot be reversed still toast, but add no undo entry", async () => {
    const { store } = make();
    await store.getState().sync();
    await store.getState().mutate({ op: "addComment", key: "ABC-1", markdown: "hi" });
    expect(store.getState().toasts.map((t) => [t.text, !!t.entryId])).toEqual([["Comment added", false]]);
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it("a rejected change removes its toast and undo entry", async () => {
    const { store } = make();
    await store.getState().sync();
    server.failNext.push({ status: 400, error: "nope" });
    await store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "x" });
    expect(store.getState().toasts).toHaveLength(0);
    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().failed).toHaveLength(1);
  });

  it("undo with nothing to undo does nothing", async () => {
    const { store } = make();
    await store.getState().undo();
    expect(server.received).toHaveLength(0);
  });

  it("dismissToast removes it", async () => {
    const { store } = make();
    await store.getState().sync();
    await store.getState().mutate({ op: "setSummary", key: "ABC-1", summary: "x" });
    store.getState().dismissToast(store.getState().toasts[0].id);
    expect(store.getState().toasts).toHaveLength(0);
  });
});

describe("notify", () => {
  it("adds a plain toast with no undo", () => {
    const { store } = make();
    store.getState().notify("Link copied");
    expect(store.getState().toasts.map((t) => [t.text, t.entryId])).toEqual([["Link copied", undefined]]);
  });
});

describe("warnings from the server", () => {
  it("shows a toast when a change was applied only in part", async () => {
    const { store } = make();
    await store.getState().sync();
    await store.getState().mutate({ op: "createIssue", summary: "Half done", issuetype: "Task", status: "Nonexistent" });
    const texts = store.getState().toasts.map((t) => t.text);
    expect(texts.some((t) => t.includes("couldn't set its status"))).toBe(true);
  });
});
