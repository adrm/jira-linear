import type { Comment, Issue, IssueLink, UserRef } from "../shared/types.ts";
import type { FieldIds } from "./fields.ts";

// deno-lint-ignore no-explicit-any
type Raw = any;

function user(u: Raw): UserRef | null {
  return u?.accountId ? { id: u.accountId, name: u.displayName ?? u.accountId } : null;
}

function links(raw: Raw[] | undefined): IssueLink[] {
  return (raw ?? []).map((l) => {
    const outward = !!l.outwardIssue;
    const other = outward ? l.outwardIssue : l.inwardIssue;
    return {
      id: l.id,
      type: l.type?.name,
      direction: outward ? "outward" : "inward",
      phrase: outward ? l.type?.outward : l.type?.inward,
      key: other?.key,
      summary: other?.fields?.summary ?? "",
    } satisfies IssueLink;
  });
}

export function normalizeIssue(raw: Raw, fields: FieldIds = {}): Issue {
  const f = raw.fields;
  const get = (id?: string) => (id ? f[id] : undefined);
  const quarter = get(fields.quarter);
  const points = get(fields.storyPoints);
  return {
    key: raw.key,
    id: raw.id,
    project: raw.key.split("-")[0],
    summary: f.summary,
    descriptionAdf: f.description ?? null,
    status: f.status?.name,
    statusCategory: f.status?.statusCategory?.key ?? "new",
    issuetype: f.issuetype?.name,
    priority: f.priority?.name ?? null,
    assignee: user(f.assignee),
    reporter: user(f.reporter),
    parentKey: f.parent?.key ?? null,
    parentSummary: f.parent?.fields?.summary ?? null,
    labels: f.labels ?? [],
    duedate: f.duedate ?? null,
    created: f.created,
    updated: f.updated,
    links: links(f.issuelinks),
    quarter: Array.isArray(quarter) && quarter.length ? quarter.map((o: Raw) => o.value).join(", ") : null,
    initialEstimate: get(fields.initialEstimate) ?? null,
    revisedEstimate: get(fields.revisedEstimate) ?? null,
    statusChanged: f.statuscategorychangedate ?? null,
    storyPoints: typeof points === "number" ? points : null,
    resolution: f.resolution?.name ?? null,
  };
}

export function normalizeComment(issueKey: string, raw: Raw): Comment {
  return {
    id: raw.id,
    issueKey,
    author: user(raw.author),
    bodyAdf: raw.body ?? null,
    created: raw.created,
    updated: raw.updated,
  };
}
