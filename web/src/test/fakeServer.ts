import type { Comment, Delta, Issue, Mutation } from "@shared/types";

export const mkIssue = (key: string, over: Partial<Issue> = {}): Issue => ({
  key, id: key.replace("ABC-", "1"), project: "ABC", summary: `Summary ${key}`, descriptionAdf: null,
  status: "Backlog", statusCategory: "new", issuetype: "Task", priority: "Medium", assignee: null, reporter: null,
  parentKey: null, parentSummary: null, labels: [], duedate: null,
  created: "2026-10-01T00:00:00.000+0000", updated: "2026-10-01T00:00:00.000+0000", links: [],
  quarter: null, initialEstimate: null, revisedEstimate: null, statusChanged: null, storyPoints: null, resolution: null, ...over,
});

/** In-memory stand-in for the jira-linear HTTP API, exposed as a fetch function. */
export class FakeServer {
  syncId = 0;
  rows = new Map<string, Issue & { deleted: boolean; sync: number }>();
  comments: Array<Comment & { deleted: boolean; sync: number }> = [];
  offline = false;
  /** local "for review" marks: key -> markedAt */
  review = new Map<string, string>();
  reviewFail = false;
  /** how many times the app asked the server to check Jira right now */
  jiraSyncs = 0;
  failNext: Array<{ status: number; error: string }> = [];
  received: Array<{ id: string; op: string }> = [];
  /** activity entries per issue key */
  activity = new Map<string, import("@shared/types").ActivityEntry[]>();
  activityFails = false;
  /** remote links per issue key */
  links = new Map<string, Array<{ id: string; url: string; title: string }>>();
  /** make /api/projects/:key/history fail */
  historyFails = false;
  /** explicit history per project, instead of the generated one */
  history: Record<string, Array<{ key: string; created: string; started: string | null; completed: string | null; canceled?: string | null; points?: number | null }>> = {};
  historyRequests = 0;
  /** createIssue mutations as received, in full */
  created: Array<Record<string, unknown>> = [];
  /** When set, /api/mutate waits for this promise before answering. */
  gate: Promise<void> | null = null;
  private seq = 100;

  put(issue: Issue) {
    this.rows.set(issue.key, { ...issue, deleted: false, sync: ++this.syncId });
  }
  remove(key: string) {
    const r = this.rows.get(key)!;
    this.rows.set(key, { ...r, deleted: true, sync: ++this.syncId });
  }
  addComment(c: Comment) {
    this.comments.push({ ...c, deleted: false, sync: ++this.syncId });
  }

  private delta(since: number): Delta {
    return {
      syncId: this.syncId,
      issues: [...this.rows.values()].filter((r) => r.sync > since).map(({ sync: _s, ...i }) => i),
      comments: this.comments.filter((c) => c.sync > since).map(({ sync: _s, ...c }) => c),
    };
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (this.offline) throw new TypeError("Failed to fetch");
    const url = new URL(String(input), "http://localhost");
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url.pathname === "/api/me") return json({ id: "u1", name: "Ana" });
    let hm: RegExpMatchArray | null;
    if ((hm = url.pathname.match(/^\/api\/projects\/([^/]+)\/history$/))) {
      this.historyRequests++;
      if (this.historyFails) return json({ error: "boom" }, 502);
      if (this.history[hm[1]]) return json(this.history[hm[1]]);
      const day = (n: number) => new Date(Date.UTC(2026, 8, n, 10)).toISOString();
      return json([...this.rows.values()].filter((r) => r.parentKey === hm![1] && !r.deleted).map((r, i) => ({
        key: r.key, created: day(1 + i),
        started: r.statusCategory === "new" ? null : day(3 + i),
        completed: r.statusCategory === "done" && r.resolution !== "Won't Do" ? day(8 + i) : null,
        canceled: r.statusCategory === "done" && r.resolution === "Won't Do" ? day(8 + i) : null,
        points: r.storyPoints,
      })));
    }
    if (url.pathname === "/api/review") {
      if (init?.method === "POST") {
        if (this.reviewFail) return json({ error: "Could not save" }, 500);
        const b = JSON.parse(String(init.body)) as { keys: string[]; marked: boolean };
        for (const k of b.keys) { if (b.marked) this.review.set(k, this.review.get(k) ?? new Date().toISOString()); else this.review.delete(k); }
        return json({ ok: true });
      }
      return json([...this.review].map(([key, markedAt]) => ({ key, markedAt })));
    }
    let am: RegExpMatchArray | null;
    if ((am = url.pathname.match(/^\/api\/issues\/([^/]+)\/activity$/))) {
      if (this.activityFails) return json({ error: "boom" }, 502);
      return json(this.activity.get(am[1]) ?? []);
    }
    let lm: RegExpMatchArray | null;
    if ((lm = url.pathname.match(/^\/api\/issues\/([^/]+)\/links$/))) return json(this.links.get(lm[1]) ?? []);
    if (url.pathname === "/api/sync" && init?.method === "POST") { this.jiraSyncs++; return json({ mode: "incremental", changed: 0 }); }
    if (url.pathname === "/api/bootstrap") return json(this.delta(0));
    if (url.pathname === "/api/delta") return json(this.delta(Number(url.searchParams.get("since"))));
    if (url.pathname === "/api/mutate") {
      const m = JSON.parse(String(init?.body)) as Mutation;
      if (this.gate) await this.gate;
      if (this.offline) throw new TypeError("Failed to fetch");
      this.received.push({ id: m.id, op: m.op });
      const fail = this.failNext.shift();
      if (fail) return json({ error: fail.error }, fail.status);
      let key = "key" in m ? m.key : "";
      if (m.op === "setSummary") this.put({ ...this.rows.get(m.key)!, summary: m.summary });
      if (m.op === "setStatus") {
        const statusCategory = m.status === "Cerrada" ? "done" : ["Backlog", "Ready for Dev", "New Idea", "Reabierta"].includes(m.status) ? "new" : "indeterminate";
        this.put({ ...this.rows.get(m.key)!, status: m.status, statusCategory });
      }
      if (m.op === "setAssignee") this.put({ ...this.rows.get(m.key)!, assignee: m.accountId ? { id: m.accountId, name: m.accountId } : null });
      if (m.op === "setPriority") this.put({ ...this.rows.get(m.key)!, priority: m.priority });
      if (m.op === "setType") this.put({ ...this.rows.get(m.key)!, issuetype: m.issuetype });
      if (m.op === "link") {
        const out = this.rows.get(m.outwardKey)!;
        const inn = this.rows.get(m.inwardKey)!;
        const id = `L${++this.seq}`;
        const blocks = m.type === "Blocks";
        this.put({ ...out, links: [...out.links, { id, type: m.type, direction: "outward", phrase: blocks ? "blocks" : "relates to", key: inn.key, summary: inn.summary }] });
        this.put({ ...inn, links: [...inn.links, { id, type: m.type, direction: "inward", phrase: blocks ? "is blocked by" : "relates to", key: out.key, summary: out.summary }] });
      }
      if (m.op === "unlink") {
        for (const k of [m.key, m.otherKey]) {
          const r = this.rows.get(k);
          if (r) this.put({ ...r, links: r.links.filter((l) => l.id !== m.linkId) });
        }
      }
      if (m.op === "addLink") this.links.set(m.key, [...(this.links.get(m.key) ?? []), { id: `l${++this.seq}`, url: m.url, title: m.title }]);
      if (m.op === "setDescription") this.put({ ...this.rows.get(m.key)!, descriptionAdf: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: m.markdown }] }] } });
      if (m.op === "setLabels") this.put({ ...this.rows.get(m.key)!, labels: m.labels });
      if (m.op === "setDueDate") this.put({ ...this.rows.get(m.key)!, duedate: m.date });
      if (m.op === "setParent") this.put({ ...this.rows.get(m.key)!, parentKey: m.parentKey });
      if (m.op === "addComment") this.addComment({ id: `c${++this.seq}`, issueKey: m.key, author: { id: "u1", name: "Ana" }, bodyAdf: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: m.markdown }] }] }, created: "x", updated: "x" });
      let warning: string | undefined;
      if (m.op === "createIssue") {
        key = `ABC-${++this.seq}`;
        const known = ["In Development", "Code Review", "Ready for Dev", "Backlog"];
        const wanted = m.status && known.includes(m.status) ? m.status : "Backlog";
        if (m.status && !known.includes(m.status)) warning = `Created ${key}, but couldn't set its status to "${m.status}"`;
        this.put(mkIssue(key, {
          summary: m.summary, issuetype: m.issuetype, status: wanted, labels: m.labels ?? [], duedate: m.duedate ?? null,
          priority: m.priority ?? "Medium", parentKey: m.parentKey ?? null,
          assignee: m.assigneeId ? { id: m.assigneeId, name: m.assigneeId } : null,
          statusCategory: wanted === "In Development" || wanted === "Code Review" ? "indeterminate" : "new",
        }));
        this.created.push(m);
      }
      return json({ syncId: this.syncId, key, ...(warning ? { warning } : {}) });
    }
    return json({ error: "not found" }, 404);
  };
}
