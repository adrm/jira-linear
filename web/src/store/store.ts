import { createStore } from "zustand/vanilla";
import { del, get, set } from "idb-keyval";
import type { Comment, Delta, Mutation, MutationInput } from "@shared/types";
import { applyLocal, type IssueMap, type LocalContext } from "../lib/optimistic";
import { describeMutation, inverseOf } from "../lib/inverse";

export interface Persisted {
  syncId: number;
  issues: IssueMap;
  comments: Record<string, Comment[]>;
  pending: Mutation[];
}

export interface Persistence {
  load(): Promise<Persisted | null>;
  save(p: Persisted): Promise<void>;
  clear(): Promise<void>;
}

export function memoryPersistence(): Persistence {
  let data: Persisted | null = null;
  return {
    load: async () => (data ? structuredClone(data) : null),
    save: async (p) => void (data = structuredClone(p)),
    clear: async () => void (data = null),
  };
}

export function idbPersistence(key = "jira-linear:state:v1"): Persistence {
  return {
    load: async () => (await get<Persisted>(key)) ?? null,
    save: (p) => set(key, p),
    clear: () => del(key),
  };
}

export interface FailedMutation {
  mutation: Mutation;
  error: string;
}

export interface Toast {
  id: string;
  text: string;
  /** set when the change can be undone */
  entryId?: string;
}

export interface UndoEntry {
  id: string;
  label: string;
  /** inverse changes, already in the order to apply them */
  inverses: MutationInput[];
  mutationIds: string[];
  /** for changes that are not Jira mutations (local marks): how to take them back */
  onUndo?: () => void | Promise<void>;
}

export interface AppState {
  ready: boolean;
  online: boolean;
  syncId: number;
  issues: IssueMap;
  comments: Record<string, Comment[]>;
  pending: Mutation[];
  failed: FailedMutation[];
  toasts: Toast[];
  undoStack: UndoEntry[];
  load(): Promise<void>;
  sync(): Promise<void>;
  mutate(body: MutationInput): Promise<void>;
  /** several changes as one step: one toast, one undo */
  mutateMany(bodies: MutationInput[], opts?: { undoable?: boolean; label?: string }): Promise<void>;
  undo(entryId?: string): Promise<void>;
  /** a toast with Undo for a change made outside the mutation queue */
  notifyUndoable(text: string, onUndo: () => void | Promise<void>): void;
  dismissToast(id: string): void;
  notify(text: string): void;
  drain(): Promise<void>;
  dismissFailed(mutationId: string): void;
}

export interface StoreDeps {
  fetch: typeof fetch;
  persistence: Persistence;
  newId?: () => string;
}

const RETRYABLE = (status: number) => status === 429 || (status >= 500 && status !== 502);

export function createAppStore(deps: StoreDeps) {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  let syncing: Promise<void> | null = null;
  let draining: Promise<void> | null = null;

  const store = createStore<AppState>((setState, getState) => {
    const persist = () => {
      const { syncId, issues, comments, pending } = getState();
      return deps.persistence.save({ syncId, issues, comments, pending });
    };

    const applyDelta = (d: Delta) => {
      const issues = { ...getState().issues };
      for (const { deleted, ...issue } of d.issues) {
        if (deleted) delete issues[issue.key];
        else issues[issue.key] = issue;
      }
      const comments = { ...getState().comments };
      for (const { deleted, ...c } of d.comments) {
        const rest = (comments[c.issueKey] ?? []).filter((x) => x.id !== c.id);
        comments[c.issueKey] = deleted ? rest : [...rest, c];
      }
      setState({ issues, comments, syncId: d.syncId, online: true });
    };

    const doSync = async () => {
      try {
        const { syncId } = getState();
        const res = await deps.fetch(syncId === 0 ? "/api/bootstrap" : `/api/delta?since=${syncId}`);
        if (!res.ok) throw new Error(`sync failed: ${res.status}`);
        applyDelta((await res.json()) as Delta);
        await persist();
      } catch {
        setState({ online: false });
      }
    };

    const doDrain = async () => {
      while (getState().pending.length) {
        const m = getState().pending[0];
        let res: Response;
        try {
          res = await deps.fetch("/api/mutate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(m),
          });
        } catch {
          setState({ online: false });
          return;
        }
        if (res.ok) {
          const result = (await res.json().catch(() => null)) as { warning?: string } | null;
          if (result?.warning) setState({ toasts: [...getState().toasts, { id: newId(), text: result.warning }] });
          await doSync(); // pull the confirmed server state before dropping the overlay
          setState({ pending: getState().pending.filter((p) => p.id !== m.id), online: true });
          await persist();
          continue;
        }
        if (RETRYABLE(res.status)) {
          await res.body?.cancel();
          setState({ online: false });
          return;
        }
        const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
        const dropped = getState().undoStack.filter((u) => u.mutationIds.includes(m.id)).map((u) => u.id);
        setState({
          pending: getState().pending.filter((p) => p.id !== m.id),
          failed: [...getState().failed, { mutation: m, error }],
          undoStack: getState().undoStack.filter((u) => !dropped.includes(u.id)),
          toasts: getState().toasts.filter((t) => !t.entryId || !dropped.includes(t.entryId)),
        });
        await persist();
      }
    };

    return {
      ready: false,
      online: true,
      syncId: 0,
      issues: {},
      comments: {},
      pending: [],
      failed: [],
      toasts: [],
      undoStack: [],
      async load() {
        const p = await deps.persistence.load();
        if (p) setState({ syncId: p.syncId, issues: p.issues, comments: p.comments, pending: p.pending });
        setState({ ready: true });
      },
      sync() {
        syncing ??= doSync().finally(() => (syncing = null));
        return syncing;
      },
      mutate(body) {
        return getState().mutateMany([body]);
      },
      async mutateMany(bodies, opts = {}) {
        if (!bodies.length) return;
        const issues = getState().issues;
        const ctx = localContext(issues);
        let working = viewIssues(getState());
        const mutations: Mutation[] = [];
        const inverses: MutationInput[] = [];
        for (const body of bodies) {
          const m = { id: newId(), ...body } as Mutation;
          const inv = "key" in body ? inverseOf(body, working[body.key]) : null;
          if (inv) inverses.push(inv);
          working = applyLocal(working, m, ctx);
          mutations.push(m);
        }
        const keys = new Set(bodies.map((b) => ("key" in b ? b.key : b.op)));
        const label = opts.label ?? (bodies.length === 1 || keys.size === 1
          ? describeMutation(bodies[0], { users: ctx.users, issues: viewIssues(getState()) })
          : `${keys.size} issues updated`);
        const undoable = opts.undoable !== false && inverses.length === bodies.length;
        const entry: UndoEntry | undefined = undoable
          ? { id: newId(), label, inverses: inverses.reverse(), mutationIds: mutations.map((m) => m.id) }
          : undefined;
        setState({
          pending: [...getState().pending, ...mutations],
          undoStack: entry ? [...getState().undoStack, entry] : getState().undoStack,
          toasts: [...getState().toasts, { id: newId(), text: label, entryId: entry?.id }],
        });
        await persist();
        return getState().drain();
      },
      async undo(entryId) {
        const stack = getState().undoStack;
        const entry = entryId ? stack.find((u) => u.id === entryId) : stack.at(-1);
        if (!entry) return;
        setState({
          undoStack: stack.filter((u) => u.id !== entry.id),
          toasts: getState().toasts.filter((t) => t.entryId !== entry.id),
        });
        if (entry.onUndo) return void (await entry.onUndo());
        return getState().mutateMany(entry.inverses, { undoable: false, label: `Undid: ${entry.label}` });
      },
      notifyUndoable(text, onUndo) {
        const entry: UndoEntry = { id: newId(), label: text, inverses: [], mutationIds: [], onUndo };
        setState({
          undoStack: [...getState().undoStack, entry],
          toasts: [...getState().toasts, { id: newId(), text, entryId: entry.id }],
        });
      },
      notify(text) {
        setState({ toasts: [...getState().toasts, { id: newId(), text }] });
      },
      dismissToast(id) {
        setState({ toasts: getState().toasts.filter((t) => t.id !== id) });
      },
      drain() {
        draining ??= doDrain().finally(() => (draining = null));
        return draining;
      },
      dismissFailed(id) {
        setState({ failed: getState().failed.filter((f) => f.mutation.id !== id) });
      },
    };
  });
  return store;
}

export type AppStore = ReturnType<typeof createAppStore>;

// ---- derived view: server truth + pending overlay (memoised on identity) ----

let ctxCache: { issues: IssueMap; ctx: LocalContext } | null = null;
export function localContext(issues: IssueMap): LocalContext {
  if (ctxCache?.issues === issues) return ctxCache.ctx;
  const statuses: Record<string, string> = {};
  const users: Record<string, string> = {};
  for (const i of Object.values(issues)) {
    statuses[i.status] = i.statusCategory;
    for (const u of [i.assignee, i.reporter]) if (u) users[u.id] = u.name;
  }
  ctxCache = { issues, ctx: { statuses, users } };
  return ctxCache.ctx;
}

let viewCache: { issues: IssueMap; pending: Mutation[]; view: IssueMap } | null = null;
export function viewIssues(s: Pick<AppState, "issues" | "pending">): IssueMap {
  if (viewCache && viewCache.issues === s.issues && viewCache.pending === s.pending) return viewCache.view;
  const ctx = localContext(s.issues);
  const view = s.pending.reduce((acc, m) => applyLocal(acc, m, ctx), s.issues);
  viewCache = { issues: s.issues, pending: s.pending, view };
  return view;
}
