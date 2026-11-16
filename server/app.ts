import type { Mutation } from "../shared/types.ts";
import type { Store } from "./db.ts";
import type { JiraClient } from "./jira.ts";
import { applyMutation, MutationError } from "./mutate.ts";
import { issueActivity } from "./activity.ts";
import { projectHistory } from "./history.ts";
import { reconcile, syncOnce } from "./sync.ts";
import type { InboxAction } from "../shared/inbox.ts";
import { validateRules } from "./inbox_rules.ts";
import type { FieldIds } from "./fields.ts";
import type { Settings } from "./settings.ts";
import { discoverWorkflow, type WorkflowConfig } from "./workflow.ts";
import { createMediaResolver } from "./media.ts";

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
const INBOX_ACTIONS = new Set<string>(["read", "unread", "archive", "unarchive", "delete"] satisfies InboxAction[]);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
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
  const media = createMediaResolver(client);

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

  async function resolveMe() {
    if (!me) {
      const u = await client.getMyself();
      me = { id: u.accountId, name: u.displayName };
    }
    return me;
  }

  async function runSync() {
    try {
      // Without the owner's id the sync still mirrors Jira; it just leaves the inbox alone.
      const meId = await resolveMe().then((u) => u.id, () => undefined);
      const r = await syncOnce({ ...deps, meId });
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
      // Pages of the app live at their own paths (/backlog, /issue/ABC-1); files have an extension.
      if (!rel.split("/").pop()!.includes(".")) {
        try {
          return new Response(await Deno.readFile(`${opts.staticDir}/index.html`), { headers: { "content-type": MIME.html } });
        } catch { /* not built yet */ }
      }
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
        return json(await resolveMe());
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
    if (pathname === "/api/inbox/rules") {
      if (req.method === "GET") return json(store.inboxRules());
      if (req.method === "PUT") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
        const rules = validateRules(body);
        if (!rules) return json({ error: "Invalid inbox rules" }, 400);
        store.setInboxRules(rules);
        return json(rules);
      }
    }
    if (pathname === "/api/inbox") {
      if (req.method === "GET") return json(store.inbox());
      if (req.method === "POST") {
        let body: { keys?: unknown; action?: unknown };
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
        const keys = body.keys;
        if (!Array.isArray(keys) || keys.length === 0 || keys.length > 500 || !keys.every((k) => typeof k === "string" && keyOk(k))) {
          return json({ error: `keys must be 1-500 ${project} keys` }, 400);
        }
        if (typeof body.action !== "string" || !INBOX_ACTIONS.has(body.action)) return json({ error: "Unknown action" }, 400);
        store.applyInboxAction(keys as string[], body.action as InboxAction);
        notify();
        return json({ ok: true });
      }
    }
    const mediaPath = pathname.match(/^\/api\/media\/([^/]+)\/(.+)$/);
    if (req.method === "GET" && mediaPath) {
      const [, key, rawId] = mediaPath;
      if (!keyOk(key)) return json({ error: "Not found" }, 404);
      let id: string;
      try {
        id = decodeURIComponent(rawId);
      } catch {
        return json({ error: "Not found" }, 404);
      }
      try {
        const att = await media.resolve(key, id, url.searchParams.get("name") ?? undefined);
        if (!att) return json({ error: "Not found" }, 404);
        const upstream = await client.fetchAttachment(att.id);
        if (!upstream.ok || !upstream.body) {
          await upstream.body?.cancel();
          return json({ error: "Jira could not provide the file" }, 502);
        }
        const mime = /^[\w.+-]+\/[\w.+-]+$/.test(att.mimeType) ? att.mimeType : "application/octet-stream";
        // Only pictures that cannot run script are shown in place; everything else downloads.
        const inline = /^image\/(png|jpe?g|gif|webp|bmp|avif)$/i.test(mime);
        return new Response(upstream.body, {
          headers: {
            "content-type": mime,
            "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
            "cache-control": "private, max-age=3600",
            "x-content-type-options": "nosniff",
            "content-security-policy": "sandbox",
          },
        });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }
    const uploadPath = pathname.match(/^\/api\/upload\/([^/]+)$/);
    if (req.method === "POST" && uploadPath) {
      const key = uploadPath[1];
      if (!keyOk(key)) return json({ error: "Key is outside the project" }, 400);
      const declared = Number(req.headers.get("content-length") ?? 0);
      if (declared > MAX_UPLOAD_BYTES) return json({ error: "File is larger than 25 MB" }, 413);
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.length) return json({ error: "File is empty" }, 400);
      if (bytes.length > MAX_UPLOAD_BYTES) return json({ error: "File is larger than 25 MB" }, 413);
      // deno-lint-ignore no-control-regex
      const name = (url.searchParams.get("name") ?? "").replace(/[\\/\x00-\x1f]/g, "_").trim().slice(0, 200) || "attachment";
      try {
        const att = await client.uploadAttachment(key, { name, type: req.headers.get("content-type") ?? "", bytes });
        media.forget(key);
        const id = await media.mediaIdFor(att.id);
        if (!id) return json({ error: "Jira stored the file but did not say how to reference it in text" }, 502);
        return json({ id, name: att.filename, mime: att.mimeType });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
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
