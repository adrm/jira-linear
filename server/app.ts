import type { Mutation } from "../shared/types.ts";
import type { Store } from "./db.ts";
import type { JiraClient } from "./jira.ts";
import { applyMutation, MutationError } from "./mutate.ts";
import { issueActivity } from "./activity.ts";
import { projectHistory } from "./history.ts";
import { reconcile, syncOnce } from "./sync.ts";
import type { FieldIds } from "./fields.ts";
import type { Settings } from "./settings.ts";
import { discoverWorkflow, type WorkflowConfig } from "./workflow.ts";

export interface AppOptions {
  store: Store;
  project: string;
  /** Jira site origin (https://your-domain.atlassian.net), for links to issues. */
  siteUrl?: string;
  client: JiraClient;
  /** Jira field ids for the planning fields (empty hides them). */
  fields?: FieldIds;
  /** Display name for the project; defaults to the key. */
  projectName?: string;
  /** The workflow section of the local settings. */
  workflow?: Settings["workflow"];
  /** The vocab section of the local settings; passed to the client as is. */
  vocab?: Settings["vocab"];
  /** Directory with the built frontend (Vite `dist`). */
  staticDir?: string;
}

const OPS = new Set([
  "setStatus", "setAssignee", "setPriority", "setLabels", "setType", "setSummary", "setDescription", "addLink", "unlink",
  "setDueDate", "setParent", "addComment", "createIssue", "link",
]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", svg: "image/svg+xml",
  png: "image/png", ico: "image/x-icon", json: "application/json", woff2: "font/woff2", map: "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createApp(opts: AppOptions) {
  const { store, project, client } = opts;
  const fields = opts.fields ?? {};
  const deps = { store, client, project, fields };
  let workflowCache: { at: number; data: WorkflowConfig } | null = null;
  const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const enc = new TextEncoder();
  let lastSyncAt: string | null = null;
  let lastError: string | null = null;
  let ticking: Promise<unknown> | null = null;
  let me: { id: string; name: string } | null = null;
  const historyCache = new Map<string, { at: number; data: unknown }>();
  const HISTORY_TTL_MS = 10 * 60_000;
  const keyOk = (k: string) => new RegExp(`^${project}-\\d+$`).test(k);

  function send(controller: ReadableStreamDefaultController<Uint8Array>) {
    controller.enqueue(enc.encode(`data: ${JSON.stringify({ syncId: store.currentSyncId() })}\n\n`));
  }
  function notify() {
    for (const c of subscribers) {
      try {
        send(c);
      } catch {
        subscribers.delete(c);
      }
    }
  }

  async function runSync() {
    try {
      const r = await syncOnce(deps);
      lastSyncAt = new Date().toISOString();
      lastError = null;
      if (r.changed > 0) notify();
      return r;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      return null;
    }
  }
  /** One poll cycle; overlapping calls share the in-flight run. */
  function tick() {
    ticking ??= runSync().finally(() => (ticking = null));
    return ticking as Promise<unknown>;
  }

  async function serveStatic(pathname: string): Promise<Response> {
    if (!opts.staticDir) return json({ error: "Not found" }, 404);
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return json({ error: "Not found" }, 404);
    }
    if (rel.split("/").includes("..")) return json({ error: "Not found" }, 404);
    if (rel.endsWith("/")) rel += "index.html";
    try {
      const data = await Deno.readFile(`${opts.staticDir}${rel}`);
      const ext = rel.split(".").pop() ?? "";
      return new Response(data, { headers: { "content-type": MIME[ext] ?? "application/octet-stream" } });
    } catch {
      return json({ error: "Not found" }, 404);
    }
  }

  async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (!LOCAL_HOSTS.has(url.hostname)) return json({ error: "Forbidden host" }, 403);
    const origin = req.headers.get("origin");
    if (origin) {
      let oh = "";
      try {
        oh = new URL(origin).hostname;
      } catch { /* invalid origin */ }
      if (!LOCAL_HOSTS.has(oh)) return json({ error: "Forbidden origin" }, 403);
    }

    const { pathname } = url;
    if (!pathname.startsWith("/api/")) return serveStatic(pathname);

    if (req.method === "GET" && pathname === "/api/bootstrap") return json(store.delta(0));
    if (req.method === "GET" && pathname === "/api/delta") {
      const raw = url.searchParams.get("since");
      const since = raw === null || raw === "" ? NaN : Number(raw);
      if (!Number.isInteger(since) || since < 0) return json({ error: "since must be a non-negative integer" }, 400);
      return json(store.delta(since));
    }
    if (req.method === "GET" && pathname === "/api/status") {
      return json({ syncId: store.currentSyncId(), lastSyncAt, lastError, project, siteUrl: opts.siteUrl });
    }
    if (req.method === "GET" && pathname === "/api/config") {
      if (!workflowCache || Date.now() - workflowCache.at > 10 * 60_000) {
        workflowCache = { at: Date.now(), data: await discoverWorkflow(client, project, store.statusCategories(), opts.workflow) };
      }
      return json({ project, projectName: opts.projectName ?? project, siteUrl: opts.siteUrl ?? "", workflow: workflowCache.data, vocab: opts.vocab ?? {}, fields: Object.keys(fields) });
    }
    if (req.method === "GET" && pathname === "/api/events") {
      let ctl!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          ctl = c;
          subscribers.add(c);
          send(c);
        },
        cancel() {
          subscribers.delete(ctl);
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
      });
    }
    if (req.method === "GET" && pathname === "/api/me") {
      try {
        if (!me) {
          const u = await client.getMyself();
          me = { id: u.accountId, name: u.displayName };
        }
        return json(me);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }
    let m: RegExpMatchArray | null;
    if (req.method === "GET" && (m = pathname.match(/^\/api\/projects\/([^/]+)\/history$/))) {
      if (!keyOk(m[1])) return json({ error: `Not a ${project} project key` }, 400);
      const hit = historyCache.get(m[1]);
      if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return json(hit.data);
      try {
        const data = await projectHistory(client, store.statusCategories(), m[1], project, fields.storyPoints);
        historyCache.set(m[1], { at: Date.now(), data });
        return json(data);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }
    if (req.method === "GET" && (m = pathname.match(/^\/api\/issues\/([^/]+)\/activity$/))) {
      if (!keyOk(m[1])) return json({ error: `Not a ${project} key` }, 400);
      try {
        return json(await issueActivity(client, m[1], project));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }
    if (req.method === "GET" && (m = pathname.match(/^\/api\/issues\/([^/]+)\/links$/))) {
      if (!keyOk(m[1])) return json({ error: `Not a ${project} key` }, 400);
      try {
        const raw = await client.getRemoteLinks(m[1]);
        return json(raw.map((l: { id: unknown; object?: { url?: string; title?: string } }) => ({ id: String(l.id), url: l.object?.url ?? "", title: l.object?.title ?? l.object?.url ?? "" })));
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }
    if (pathname === "/api/review") {
      if (req.method === "GET") return json(store.reviewMarks());
      if (req.method === "POST") {
        let body: { keys?: unknown; marked?: unknown };
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
        const keys = body.keys;
        if (!Array.isArray(keys) || keys.length === 0 || keys.length > 500 || !keys.every((k) => typeof k === "string" && keyOk(k))) {
          return json({ error: `keys must be 1-500 ${project} keys` }, 400);
        }
        if (typeof body.marked !== "boolean") return json({ error: "marked must be true or false" }, 400);
        store.setReviewMarks(keys as string[], body.marked);
        return json({ ok: true });
      }
    }
    if (req.method === "POST" && pathname === "/api/sync") {
      const r = await runSync();
      return r ? json(r) : json({ error: lastError }, 502);
    }
    if (req.method === "POST" && pathname === "/api/mutate") {
      let body: Partial<Mutation>;
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      if (!body || typeof body.id !== "string" || !body.id) return json({ error: "Mutation id is required" }, 400);
      if (typeof body.op !== "string" || !OPS.has(body.op)) return json({ error: `Unknown op: ${body.op}` }, 400);
      try {
        const result = await applyMutation(deps, body as Mutation);
        historyCache.clear();
        notify();
        return json(result);
      } catch (e) {
        if (e instanceof MutationError) return json({ error: e.message }, e.status >= 400 && e.status < 600 ? e.status : 502);
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }
    return json({ error: "Not found" }, 404);
  }

  return { handler, notify, tick, reconcile: () => reconcile(deps) };
}
