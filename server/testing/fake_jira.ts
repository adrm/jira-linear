/**
 * In-process fake of the slice of Jira Cloud REST v3 that jira-linear uses.
 * Response shapes follow what real ABC returned in the Phase 0 spike
 * (search/jql: issues + nextPageToken + isLast, no total).
 * Tests point the client at this server so nothing ever touches production Jira.
 */

export interface FakeUser {
  accountId: string;
  displayName: string;
}

export const STATUSES = [
  { id: "591", name: "Backlog", category: "new" },
  { id: "601", name: "Ready for Dev", category: "new" },
  { id: "611", name: "In Development", category: "indeterminate" },
  { id: "671", name: "Code Review", category: "indeterminate" },
  { id: "801", name: "In Testing (QA)", category: "indeterminate" },
  { id: "651", name: "Cerrada", category: "done" },
] as const;

/** The custom fields the fake issues carry, as the server resolves them. */
export const FAKE_FIELDS = {
  storyPoints: "customfield_10002",
  quarter: "customfield_13581",
  initialEstimate: "customfield_13182",
  revisedEstimate: "customfield_13280",
  qaAssignee: "customfield_11208",
};

// deno-lint-ignore no-explicit-any
type Raw = any;

export interface SeedIssue {
  key?: string;
  summary?: string;
  status?: string;
  issuetype?: string;
  priority?: string;
  assignee?: FakeUser | null;
  reporter?: FakeUser | null;
  qa?: FakeUser[];
  labels?: string[];
  parent?: string | null;
  duedate?: string | null;
  description?: unknown;
  updated?: string;
  created?: string;
  quarter?: string[];
  initial?: string | null;
  revised?: string | null;
  statusChanged?: string | null;
  points?: number | null;
  resolution?: string | null;
  /** the test user watches this issue (reported in the `watches` field) */
  watching?: boolean;
}

export class FakeJira {
  issues = new Map<string, Raw>();
  histories = new Map<string, Array<{ at: string; from: string; to: string; field?: string; fromId?: string; toId?: string; author?: { accountId: string; displayName: string } }>>();
  remoteLinks = new Map<string, Raw[]>();
  comments = new Map<string, Raw[]>();
  /** Files attached to issues; `mediaId` is the id rich text uses for the file. */
  attachments = new Map<string, Array<{ id: string; filename: string; mimeType: string; bytes: Uint8Array; mediaId: string }>>();
  /** When set, attachment content URLs redirect somewhere that does not name the file by a media id. */
  hideMediaIds = false;
  private attachmentSeq = 9000;
  requests: Array<{ method: string; path: string; body: unknown }> = [];
  /** People returned by /user/search when their name contains the query. */
  users: Array<{ accountId: string; displayName: string; active: boolean; accountType: string }> = [];
  /** Queue of failures returned for the next matching requests (any path). */
  failures: Array<{ status: number; body?: unknown; headers?: Record<string, string> }> = [];
  now = "2026-10-15T09:00:00.000+0000";
  pageCap = 100;
  /** Simulates Jira storing issue links backwards (to prove the server verifies direction). */
  reverseLinks = false;
  /** If set, search embeds at most this many comments but still reports the real total. */
  truncateEmbeddedComments?: number;
  private seq = 1000;
  private commentSeq = 5000;
  private server?: Deno.HttpServer;
  baseUrl = "";

  readonly expectedAuth: string;
  constructor(email = "test@example.com", token = "test-token") {
    this.expectedAuth = "Basic " + btoa(`${email}:${token}`);
  }

  start(): this {
    this.server = Deno.serve({ port: 0, onListen: () => {} }, (req) => this.handle(req));
    this.baseUrl = `http://127.0.0.1:${(this.server.addr as Deno.NetAddr).port}/rest/api/3`;
    return this;
  }
  async stop() {
    await this.server?.shutdown();
  }

  /** Attach a file to an issue and return its attachment id and media id. */
  attach(key: string, file: { filename: string; mimeType?: string; bytes?: Uint8Array; mediaId?: string }) {
    const a = {
      id: String(++this.attachmentSeq),
      filename: file.filename,
      mimeType: file.mimeType ?? "image/png",
      bytes: file.bytes ?? new Uint8Array([137, 80, 78, 71]),
      mediaId: file.mediaId ?? crypto.randomUUID(),
    };
    this.attachments.set(key, [...(this.attachments.get(key) ?? []), a]);
    return a;
  }

  seed(s: SeedIssue = {}): Raw {
    const n = ++this.seq;
    const key = s.key ?? `ABC-${n}`;
    const status = STATUSES.find((x) => x.name === (s.status ?? "Backlog"))!;
    const raw: Raw = {
      id: String(n),
      key,
      fields: {
        summary: s.summary ?? `Issue ${key}`,
        description: s.description ?? null,
        status: {
          id: status.id,
          name: status.name,
          statusCategory: { key: status.category },
        },
        issuetype: { name: s.issuetype ?? "Task" },
        priority: s.priority === undefined ? { name: "Medium" } : s.priority ? { name: s.priority } : null,
        assignee: s.assignee ? { ...s.assignee, active: true } : null,
        reporter: s.reporter ? { ...s.reporter, active: true } : null,
        labels: s.labels ?? [],
        parent: s.parent ? this.parentRef(s.parent) : undefined,
        duedate: s.duedate ?? null,
        created: s.created ?? this.now,
        updated: s.updated ?? this.now,
        customfield_13581: (s.quarter ?? []).map((value, i) => ({ id: String(i), value })),
        customfield_13182: s.initial ?? null,
        customfield_13280: s.revised ?? null,
        customfield_11208: (s.qa ?? []).map((u) => ({ ...u, active: true })),
        statuscategorychangedate: s.statusChanged ?? null,
        customfield_10002: s.points ?? null,
        resolution: s.resolution ? { name: s.resolution } : null,
        resolutiondate: null,
        issuelinks: [],
        watches: { watchCount: s.watching ? 1 : 0, isWatching: !!s.watching },
      },
    };
    this.issues.set(key, raw);
    return raw;
  }

  /** Jira's history ids are unique across the whole site, not per issue. */
  private historyId(issue: Raw, index: number): string {
    return `${issue.id}${String(index + 1).padStart(3, "0")}`;
  }

  private parentRef(key: string) {
    const p = this.issues.get(key);
    return { id: p?.id ?? "0", key, fields: { summary: p?.fields.summary ?? key } };
  }

  setHistory(key: string, entries: Array<{ at: string; from: string; to: string; field?: string; fromId?: string; toId?: string; author?: { accountId: string; displayName: string } }>) {
    this.histories.set(key, entries);
  }
  setResolved(key: string, at: string | null) {
    this.issues.get(key).fields.resolutiondate = at;
  }

  addCommentDirect(issueKey: string, text: string, author?: FakeUser): Raw {
    const c = {
      id: String(++this.commentSeq),
      author: author ?? { accountId: "u1", displayName: "Tester" },
      body: adfText(text),
      created: this.now,
      updated: this.now,
    };
    this.comments.set(issueKey, [...(this.comments.get(issueKey) ?? []), c]);
    return c;
  }

  delete(key: string) {
    this.issues.delete(key);
    this.comments.delete(key);
  }

  touch(key: string, now = this.now) {
    this.issues.get(key).fields.updated = now;
  }

  private json(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace("/rest/api/3", "");
    // The media service: files are fetched from a signed address without credentials.
    let fm: RegExpMatchArray | null;
    if ((fm = url.pathname.match(/^\/media\/file\/([0-9a-f-]+)\/binary$/))) {
      const hit = [...this.attachments.values()].flat().find((a) => a.mediaId === fm![1]);
      return hit ? new Response(hit.bytes as BodyInit, { headers: { "Content-Type": hit.mimeType } }) : new Response("not found", { status: 404 });
    }
    if ((fm = path.match(/^\/issue\/([A-Z]+-\d+)\/attachments$/)) && req.method === "POST") {
      this.requests.push({ method: req.method, path, body: "(multipart)" });
      if (req.headers.get("authorization") !== this.expectedAuth) return this.json({ errorMessages: ["Unauthorized"] }, 401);
      const failed = this.failures.shift();
      if (failed) return this.json(failed.body ?? { errorMessages: ["injected failure"] }, failed.status, failed.headers);
      if (req.headers.get("x-atlassian-token") !== "no-check") return this.json({ errorMessages: ["XSRF check failed"] }, 403);
      if (!this.issues.has(fm[1])) return this.json({ errorMessages: ["Issue does not exist"] }, 404);
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) return this.json({ errorMessages: ["No file"] }, 400);
      const a = this.attach(fm[1], { filename: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
      return this.json([{ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.bytes.length }], 200);
    }
    const text = await req.text();
    const body = text ? JSON.parse(text) : undefined;
    this.requests.push({ method: req.method, path, body });

    if (req.headers.get("authorization") !== this.expectedAuth) {
      return this.json({ errorMessages: ["Unauthorized"] }, 401);
    }
    const fail = this.failures.shift();
    if (fail) return this.json(fail.body ?? { errorMessages: ["injected failure"] }, fail.status, fail.headers);

    let m: RegExpMatchArray | null;
    if (req.method === "GET" && path === "/field") {
      return this.json([
        { id: "summary", name: "Summary" },
        { id: "customfield_10002", name: "Story Points" },
        { id: "customfield_13581", name: "Quarter" },
        { id: "customfield_13182", name: "Initial Estimate" },
        { id: "customfield_13280", name: "Revised Estimate" },
      ]);
    }
    if (req.method === "GET" && /^\/project\/[A-Z]+\/statuses$/.test(path)) {
      return this.json([{ name: "Task", statuses: STATUSES.map((s) => ({ name: s.name, statusCategory: { key: s.category } })) }]);
    }
    if (req.method === "GET" && path === "/myself") return this.json({ accountId: "me", displayName: "Me", active: true });
    if (req.method === "GET" && path === "/user/search") {
      const q = (url.searchParams.get("query") ?? "").toLowerCase();
      return this.json(this.users.filter((u) => u.displayName.toLowerCase().includes(q)));
    }
    if (req.method === "POST" && path === "/search/jql") return this.search(body);
    if (req.method === "POST" && path === "/issue") return this.create(body);
    if (req.method === "POST" && path === "/issueLink") return this.link(body);
    if ((m = path.match(/^\/issueLink\/(\d+)$/)) && req.method === "DELETE") {
      let found = false;
      for (const issue of this.issues.values()) {
        const before = issue.fields.issuelinks.length;
        issue.fields.issuelinks = issue.fields.issuelinks.filter((l: Raw) => l.id !== m![1]);
        if (issue.fields.issuelinks.length !== before) { found = true; issue.fields.updated = this.now; }
      }
      return found ? this.json(undefined, 204) : this.json({ errorMessages: ["No issue link with id"] }, 404);
    }
    if ((m = path.match(/^\/attachment\/content\/(\d+)$/)) && req.method === "GET") {
      const hit = [...this.attachments.values()].flat().find((a) => a.id === m![1]);
      if (!hit) return this.json({ errorMessages: ["Attachment not found"] }, 404);
      const origin = new URL(req.url).origin;
      const target = this.hideMediaIds ? `${origin}/elsewhere/${hit.id}` : `${origin}/media/file/${hit.mediaId}/binary?token=signed&client=x`;
      return new Response(null, { status: 303, headers: { Location: target } });
    }
    if ((m = path.match(/^\/issue\/([A-Z]+-\d+)$/))) {
      const issue = this.issues.get(m[1]);
      if (!issue) return this.json({ errorMessages: ["Issue does not exist"] }, 404);
      if (req.method === "GET") {
        const files = this.attachments.get(m[1]);
        if (!files) return this.json(issue);
        const attachment = files.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.bytes.length, content: `${new URL(req.url).origin}/rest/api/3/attachment/content/${a.id}` }));
        return this.json({ ...issue, fields: { ...issue.fields, attachment } });
      }
      if (req.method === "PUT") return this.edit(issue, body);
    }
    if ((m = path.match(/^\/issue\/([A-Z]+-\d+)\/transitions$/))) {
      const issue = this.issues.get(m[1]);
      if (!issue) return this.json({ errorMessages: ["Issue does not exist"] }, 404);
      if (req.method === "GET") {
        return this.json({
          transitions: STATUSES.filter((s) => s.id !== issue.fields.status.id).map((s) => ({
            id: s.id,
            name: s.name,
            to: { id: s.id, name: s.name },
          })),
        });
      }
      if (req.method === "POST") {
        const target = STATUSES.find((s) => s.id === body?.transition?.id && s.id !== issue.fields.status.id);
        if (!target) return this.json({ errorMessages: ["Transition is not valid"] }, 400);
        issue.fields.status = { id: target.id, name: target.name, statusCategory: { key: target.category } };
        issue.fields.updated = this.now;
        return this.json(undefined, 204);
      }
    }
    if ((m = path.match(/^\/issue\/([A-Z]+-\d+)\/changelog$/)) && req.method === "GET") {
      if (!this.issues.has(m[1])) return this.json({ errorMessages: ["Issue does not exist"] }, 404);
      const all = this.histories.get(m[1]) ?? [];
      const startAt = Number(new URL(req.url).searchParams.get("startAt") ?? 0);
      const size = Math.min(Number(new URL(req.url).searchParams.get("maxResults") ?? 100), this.pageCap);
      const slice = all.slice(startAt, startAt + size);
      return this.json({
        startAt, maxResults: size, total: all.length, isLast: startAt + size >= all.length,
        values: slice.map((h, i) => ({ id: this.historyId(this.issues.get(m![1]), startAt + i), created: h.at, author: h.author ?? null, items: [{ field: h.field ?? "status", from: h.fromId, to: h.toId, fromString: h.from || null, toString: h.to || null }] })),
      });
    }
    if ((m = path.match(/^\/issue\/([A-Z]+-\d+)\/remotelink$/))) {
      if (!this.issues.has(m[1])) return this.json({ errorMessages: ["Issue does not exist"] }, 404);
      if (req.method === "GET") return this.json(this.remoteLinks.get(m[1]) ?? []);
      if (req.method === "POST") {
        const link = { id: this.seq++, object: { url: body?.object?.url, title: body?.object?.title } };
        this.remoteLinks.set(m[1], [...(this.remoteLinks.get(m[1]) ?? []), link]);
        return this.json({ id: link.id }, 201);
      }
    }
    if ((m = path.match(/^\/issue\/([A-Z]+-\d+)\/comment$/))) {
      const key = m[1];
      if (!this.issues.has(key)) return this.json({ errorMessages: ["Issue does not exist"] }, 404);
      if (req.method === "GET") {
        const comments = this.comments.get(key) ?? [];
        return this.json({ startAt: 0, maxResults: 100, total: comments.length, comments });
      }
      if (req.method === "POST") {
        const c = {
          id: String(++this.commentSeq),
          author: { accountId: "me", displayName: "Me" },
          body: body.body,
          created: this.now,
          updated: this.now,
        };
        this.comments.set(key, [...(this.comments.get(key) ?? []), c]);
        this.issues.get(key).fields.updated = this.now;
        return this.json(c, 201);
      }
    }
    return this.json({ errorMessages: [`fake: unhandled ${req.method} ${path}`] }, 404);
  }

  private search(body: Raw): Response {
    const jql: string = body?.jql ?? "";
    const wantFields: string[] | undefined = body?.fields;
    let rows = [...this.issues.values()];
    const proj = jql.match(/project\s*=\s*"?([A-Z]+)"?/);
    if (proj) rows = rows.filter((r) => r.key.startsWith(proj[1] + "-"));
    const par = jql.match(/parent\s*=\s*"?([A-Z]+-\d+)"?/);
    if (par) rows = rows.filter((r) => r.fields.parent?.key === par[1]);
    const upd = jql.match(/updated\s*>=\s*"(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})"/);
    if (upd) {
      // Jira compares at minute precision
      const floor = `${upd[1]}T${upd[2]}:${upd[3]}`;
      rows = rows.filter((r) => r.fields.updated.slice(0, 16) >= floor);
    }
    const desc = /ORDER BY updated DESC/i.test(jql);
    rows.sort((a, b) => (a.fields.updated < b.fields.updated ? -1 : a.fields.updated > b.fields.updated ? 1 : a.key < b.key ? -1 : 1));
    if (desc) rows.reverse();

    const size = Math.min(body?.maxResults ?? 50, this.pageCap);
    const offset = body?.nextPageToken ? Number(atob(body.nextPageToken)) : 0;
    const page = rows.slice(offset, offset + size);
    const out: Raw = {
      issues: page.map((r) => this.project(r, wantFields, body?.expand)),
      isLast: offset + size >= rows.length,
    };
    if (!out.isLast) out.nextPageToken = btoa(String(offset + size));
    return this.json(out);
  }

  private project(raw: Raw, wantFields?: string[], expand?: string): Raw {
    const fields: Raw = {};
    for (const f of wantFields ?? Object.keys(raw.fields)) {
      if (f === "comment") {
        const cs = this.comments.get(raw.key) ?? [];
        // like Jira, the comments embedded in search results do not carry `parentId`; the comment list does
        const embedded = (this.truncateEmbeddedComments === undefined ? cs : cs.slice(0, this.truncateEmbeddedComments)).map(({ parentId: _p, ...rest }) => rest);
        fields.comment = { comments: embedded, total: cs.length, maxResults: 20, startAt: 0 };
      } else if (f in raw.fields) fields[f] = raw.fields[f];
    }
    const out: Raw = { id: raw.id, key: raw.key, fields };
    if (expand === "changelog") {
      out.changelog = {
        histories: (this.histories.get(raw.key) ?? []).map((h, i) => ({
          id: this.historyId(raw, i), created: h.at, author: h.author ?? null,
          items: [{ field: h.field ?? "status", from: h.fromId, to: h.toId, fromString: h.from, toString: h.to }],
        })),
      };
    }
    return out;
  }

  private edit(issue: Raw, body: Raw): Response {
    const f = body?.fields ?? {};
    for (const [k, v] of Object.entries(f) as Array<[string, Raw]>) {
      if (k === "summary" || k === "labels" || k === "duedate" || k === "description") issue.fields[k] = v;
      else if (k === "issuetype") issue.fields.issuetype = { name: v?.name };
      else if (k === "priority") issue.fields.priority = v?.name ? { name: v.name } : null;
      else if (k === "assignee") issue.fields.assignee = v?.accountId ? { accountId: v.accountId, displayName: v.accountId, active: true } : null;
      else if (k === "parent") issue.fields.parent = v?.key ? this.parentRef(v.key) : undefined;
      else return this.json({ errors: { [k]: "Field cannot be set" } }, 400);
    }
    issue.fields.updated = this.now;
    return this.json(undefined, 204);
  }

  private create(body: Raw): Response {
    const f = body?.fields ?? {};
    if (!f.summary) return this.json({ errors: { summary: "You must specify a summary of the issue." } }, 400);
    const raw = this.seed({
      summary: f.summary,
      issuetype: f.issuetype?.name ?? "Task",
      priority: f.priority?.name,
      labels: f.labels,
      parent: f.parent?.key,
      duedate: f.duedate,
      description: f.description,
      assignee: f.assignee?.accountId ? { accountId: f.assignee.accountId, displayName: f.assignee.accountId } : null,
    });
    return this.json({ id: raw.id, key: raw.key }, 201);
  }

  private link(body: Raw): Response {
    const { type, inwardIssue, outwardIssue } = body ?? {};
    const a = this.issues.get(this.reverseLinks ? inwardIssue?.key : outwardIssue?.key);
    const b = this.issues.get(this.reverseLinks ? outwardIssue?.key : inwardIssue?.key);
    if (!a || !b) return this.json({ errorMessages: ["Issue does not exist"] }, 404);
    const id = String(++this.seq);
    const phrases: Record<string, [string, string]> = { Blocks: ["is blocked by", "blocks"], Relates: ["relates to", "relates to"] };
    const [inw, outw] = phrases[type?.name] ?? [type?.name, type?.name];
    const t = { name: type.name, inward: inw, outward: outw };
    // outwardIssue "blocks" inwardIssue: on outward issue it appears as outwardIssue=inward target
    a.fields.issuelinks.push({ id, type: t, outwardIssue: { key: b.key, fields: { summary: b.fields.summary } } });
    b.fields.issuelinks.push({ id, type: t, inwardIssue: { key: a.key, fields: { summary: a.fields.summary } } });
    a.fields.updated = b.fields.updated = this.now;
    return this.json(undefined, 201);
  }
}

export function adfText(text: string) {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}
