// deno-lint-ignore-file no-explicit-any
export class JiraError extends Error {
  constructor(public status: number, public body: string, message: string) {
    super(message);
  }
}

export interface JiraClientOptions {
  /** e.g. https://example.atlassian.net/rest/api/3 — required, no production default. */
  baseUrl: string;
  email: string;
  apiToken: string;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface AttachmentInfo {
  id: string;
  filename: string;
  mimeType: string;
}

export type JiraClient = ReturnType<typeof createJiraClient>;

export function createJiraClient(opts: JiraClientOptions) {
  const auth = "Basic " + btoa(`${opts.email}:${opts.apiToken}`);
  const maxRetries = opts.maxRetries ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(opts.baseUrl + path, {
        method,
        headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429 && attempt < maxRetries) {
        await res.body?.cancel();
        const secs = Number(res.headers.get("Retry-After"));
        await sleep((Number.isFinite(secs) && secs > 0 ? secs : 2 ** attempt) * 1000);
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new JiraError(res.status, text, `Jira ${method} ${path} failed: ${res.status}`);
      return (text ? JSON.parse(text) : undefined) as T;
    }
  }

  /** A plain request for files: no JSON headers, redirects handled by the caller. */
  async function raw(method: string, path: string, init: { headers?: Record<string, string>; body?: BodyInit; redirect?: RequestRedirect } = {}): Promise<Response> {
    return await fetch(opts.baseUrl + path, {
      method,
      headers: { Authorization: auth, ...init.headers },
      body: init.body,
      redirect: init.redirect ?? "follow",
    });
  }

  return {
    request,
    raw,
    async searchAll(jql: string, fields: string[], pageSize = 100, expand?: string): Promise<any[]> {
      const out: any[] = [];
      let nextPageToken: string | undefined;
      do {
        const page = await request("POST", "/search/jql", { jql, fields, maxResults: pageSize, nextPageToken, ...(expand ? { expand } : {}) });
        out.push(...page.issues);
        nextPageToken = page.isLast ? undefined : page.nextPageToken;
      } while (nextPageToken);
      return out;
    },
    getMyself: (): Promise<{ accountId: string; displayName: string }> => request("GET", "/myself"),
    async getChangelog(key: string): Promise<any[]> {
      const out: any[] = [];
      for (let startAt = 0;;) {
        const page = await request("GET", `/issue/${key}/changelog?startAt=${startAt}&maxResults=100`);
        out.push(...page.values);
        startAt += page.values.length;
        if (page.isLast || !page.values.length) return out;
      }
    },
    getRemoteLinks: (key: string): Promise<any[]> => request("GET", `/issue/${key}/remotelink`),
    async addRemoteLink(key: string, link: { url: string; title: string }) {
      await request("POST", `/issue/${key}/remotelink`, { object: { url: link.url, title: link.title } });
    },
    getIssue: (key: string) => request("GET", `/issue/${key}`),
    async getAttachments(key: string): Promise<AttachmentInfo[]> {
      const issue = await request("GET", `/issue/${key}?fields=attachment`);
      return (issue.fields?.attachment ?? []).map((a: any) => ({ id: String(a.id), filename: String(a.filename ?? ""), mimeType: String(a.mimeType ?? "") }));
    },
    /**
     * The id Jira's rich text uses for an attachment. The attachment's content URL redirects to the media service,
     * and that address names the file by this id.
     */
    async mediaIdOf(attachmentId: string): Promise<string | null> {
      const res = await raw("GET", `/attachment/content/${attachmentId}`, { redirect: "manual" });
      await res.body?.cancel();
      const found = /\/file\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(res.headers.get("location") ?? "");
      return found ? found[1].toLowerCase() : null;
    },
    fetchAttachment: (attachmentId: string) => raw("GET", `/attachment/content/${attachmentId}`),
    async uploadAttachment(key: string, file: { name: string; type: string; bytes: Uint8Array }): Promise<AttachmentInfo> {
      const form = new FormData();
      form.append("file", new Blob([file.bytes as BlobPart], { type: file.type || "application/octet-stream" }), file.name);
      const res = await raw("POST", `/issue/${key}/attachments`, { headers: { "X-Atlassian-Token": "no-check", Accept: "application/json" }, body: form });
      const text = await res.text();
      if (!res.ok) throw new JiraError(res.status, text, `Jira POST /issue/${key}/attachments failed: ${res.status}`);
      const a = JSON.parse(text)[0];
      return { id: String(a.id), filename: String(a.filename ?? file.name), mimeType: String(a.mimeType ?? file.type) };
    },
    async listComments(key: string): Promise<any[]> {
      return (await request("GET", `/issue/${key}/comment?maxResults=1000`)).comments;
    },
    async getTransitions(key: string): Promise<Array<{ id: string; name: string; to?: { name: string } }>> {
      return (await request("GET", `/issue/${key}/transitions`)).transitions;
    },
    async transition(key: string, id: string) {
      await request("POST", `/issue/${key}/transitions`, { transition: { id } });
    },
    async editFields(key: string, fields: Record<string, unknown>) {
      await request("PUT", `/issue/${key}`, { fields });
    },
    addComment: (key: string, body: unknown) => request("POST", `/issue/${key}/comment`, { body }),
    createIssue: (fields: Record<string, unknown>): Promise<{ key: string; id: string }> =>
      request("POST", "/issue", { fields }),
    async deleteLink(id: string) {
      await request("DELETE", `/issueLink/${id}`);
    },
    async createLink(type: string, p: { inwardKey: string; outwardKey: string }) {
      await request("POST", "/issueLink", {
        type: { name: type },
        inwardIssue: { key: p.inwardKey },
        outwardIssue: { key: p.outwardKey },
      });
    },
  };
}
