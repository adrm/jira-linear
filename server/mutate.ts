// deno-lint-ignore-file no-explicit-any
import { markdownToAdf } from "../shared/markdown_adf.ts";
import type { Mutation, MutationResult } from "../shared/types.ts";
import type { Store } from "./db.ts";
import { type JiraClient, JiraError } from "./jira.ts";
import type { FieldIds } from "./fields.ts";
import { normalizeComment, normalizeIssue } from "./normalize.ts";

export class MutationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface MutateDeps {
  client: JiraClient;
  store: Store;
  project: string;
  fields: FieldIds;
}

const bad = (msg: string) => new MutationError(400, msg);

function checkKey(deps: MutateDeps, key: string) {
  if (!new RegExp(`^${deps.project}-\\d+$`).test(key)) {
    throw bad(`Key ${key} is outside project ${deps.project}`);
  }
}

async function refresh(deps: MutateDeps, key: string) {
  const raw = await deps.client.getIssue(key);
  deps.store.upsertIssue(normalizeIssue(raw, deps.fields));
  const comments = await deps.client.listComments(key);
  deps.store.replaceComments(key, comments.map((c) => normalizeComment(key, c)));
}

interface RunResult { keys: string[]; warning?: string }

async function run(deps: MutateDeps, m: Mutation): Promise<string[] | RunResult> {
  const { client } = deps;
  switch (m.op) {
    case "setStatus": {
      checkKey(deps, m.key);
      const want = m.status.trim().toLowerCase();
      const ts = await client.getTransitions(m.key);
      const t = ts.find((x) => (x.to?.name ?? x.name).toLowerCase() === want) ??
        ts.find((x) => x.name.toLowerCase() === want);
      if (!t) throw bad(`No transition from the current status to "${m.status}"`);
      await client.transition(m.key, t.id);
      return [m.key];
    }
    case "setAssignee":
      checkKey(deps, m.key);
      await client.editFields(m.key, { assignee: m.accountId ? { accountId: m.accountId } : null });
      return [m.key];
    case "setPriority":
      checkKey(deps, m.key);
      await client.editFields(m.key, { priority: { name: m.priority } });
      return [m.key];
    case "setLabels":
      checkKey(deps, m.key);
      await client.editFields(m.key, { labels: m.labels });
      return [m.key];
    case "setType":
      checkKey(deps, m.key);
      if (!m.issuetype.trim()) throw bad("Issue type is required");
      await client.editFields(m.key, { issuetype: { name: m.issuetype } });
      return [m.key];
    case "unlink":
      checkKey(deps, m.key);
      checkKey(deps, m.otherKey);
      await client.deleteLink(m.linkId);
      return [m.key, m.otherKey];
    case "addLink": {
      checkKey(deps, m.key);
      if (!/^https?:\/\//i.test(m.url)) throw bad("Links must start with http:// or https://");
      if (!m.title.trim()) throw bad("A link needs a title");
      await client.addRemoteLink(m.key, { url: m.url, title: m.title.trim() });
      return [m.key];
    }
    case "setSummary":
      checkKey(deps, m.key);
      if (!m.summary.trim()) throw bad("Summary is required");
      await client.editFields(m.key, { summary: m.summary });
      return [m.key];
    case "setDescription":
      checkKey(deps, m.key);
      await client.editFields(m.key, { description: m.markdown.trim() ? markdownToAdf(m.markdown) : null });
      return [m.key];
    case "setDueDate":
      checkKey(deps, m.key);
      await client.editFields(m.key, { duedate: m.date });
      return [m.key];
    case "setParent":
      checkKey(deps, m.key);
      if (m.parentKey) checkKey(deps, m.parentKey);
      await client.editFields(m.key, { parent: m.parentKey ? { key: m.parentKey } : null });
      return [m.key];
    case "addComment":
      checkKey(deps, m.key);
      if (!m.markdown.trim()) throw bad("Comment is empty");
      await client.addComment(m.key, markdownToAdf(m.markdown));
      return [m.key];
    case "createIssue": {
      if (!m.summary.trim()) throw bad("Summary is required");
      if (!m.issuetype.trim()) throw bad("Issue type is required");
      if (m.parentKey) checkKey(deps, m.parentKey);
      const fields: Record<string, unknown> = {
        project: { key: deps.project },
        summary: m.summary,
        issuetype: { name: m.issuetype },
      };
      if (m.markdown) fields.description = markdownToAdf(m.markdown);
      if (m.labels) fields.labels = m.labels;
      if (m.parentKey) fields.parent = { key: m.parentKey };
      if (m.duedate) fields.duedate = m.duedate;
      if (m.priority) fields.priority = { name: m.priority };
      if (m.assigneeId) fields.assignee = { accountId: m.assigneeId };
      const { key } = await client.createIssue(fields);
      if (!m.status) return [key];
      // The issue exists now, so a failed transition must not fail the mutation (a retry would create a duplicate).
      try {
        const want = m.status.trim().toLowerCase();
        const ts = await client.getTransitions(key);
        const t = ts.find((x) => (x.to?.name ?? x.name).toLowerCase() === want) ?? ts.find((x) => x.name.toLowerCase() === want);
        if (!t) return { keys: [key], warning: `Created ${key}, but there is no way to start it in "${m.status}"` };
        await client.transition(key, t.id);
      } catch (e) {
        return { keys: [key], warning: `Created ${key}, but couldn't set its status to "${m.status}": ${e instanceof Error ? e.message : e}` };
      }
      return [key];
    }
    case "link": {
      checkKey(deps, m.inwardKey);
      checkKey(deps, m.outwardKey);
      await client.createLink(m.type, { inwardKey: m.inwardKey, outwardKey: m.outwardKey });
      // Verify the direction right after creating the link.
      const out: any = await client.getIssue(m.outwardKey);
      const ok = (out.fields.issuelinks ?? []).some((l: any) =>
        l.type?.name === m.type && l.outwardIssue?.key === m.inwardKey
      );
      if (!ok) {
        throw new MutationError(
          502,
          `Link direction check failed: ${m.outwardKey} does not read as the outward side of ${m.type} to ${m.inwardKey}`,
        );
      }
      return [m.outwardKey, m.inwardKey];
    }
  }
}

export async function applyMutation(deps: MutateDeps, m: Mutation): Promise<MutationResult> {
  const cached = deps.store.getMutationResult(m.id);
  if (cached) return JSON.parse(cached) as MutationResult;

  let keys: string[];
  let warning: string | undefined;
  try {
    const ran = await run(deps, m);
    keys = Array.isArray(ran) ? ran : ran.keys;
    warning = Array.isArray(ran) ? undefined : ran.warning;
    for (const k of keys) await refresh(deps, k);
  } catch (e) {
    if (e instanceof MutationError) throw e;
    if (e instanceof JiraError) throw new MutationError(e.status, `${e.message}: ${e.body.slice(0, 300)}`);
    throw e;
  }
  const result: MutationResult = { syncId: deps.store.currentSyncId(), key: keys[0], ...(warning ? { warning } : {}) };
  deps.store.saveMutationResult(m.id, JSON.stringify(result));
  return result;
}
