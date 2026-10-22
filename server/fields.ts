// deno-lint-ignore-file no-explicit-any
import type { Settings } from "./settings.ts";

/** Jira field ids for the optional planning fields; a missing one just hides that feature. */
export interface FieldIds {
  storyPoints?: string;
  quarter?: string;
  initialEstimate?: string;
  revisedEstimate?: string;
}

/** What to look for when the settings name no field: names Jira sites commonly use. */
const CANDIDATES: Record<keyof FieldIds, string[]> = {
  storyPoints: ["story points", "story point estimate"],
  quarter: ["quarter"],
  initialEstimate: ["initial estimate", "initial estimated date", "initial target date"],
  revisedEstimate: ["revised estimate", "revised estimated date", "revised target date"],
};

const isId = (s: string) => /^customfield_\d+$/.test(s);

/**
 * Work out which Jira field holds what. A configured id is used as is, a configured name is looked
 * up, and with nothing configured the usual names are tried.
 */
export function resolveFields(allFields: Array<{ id: string; name: string }>, wanted: Settings["fields"] = {}): FieldIds {
  const byName = new Map(allFields.map((f) => [f.name.trim().toLowerCase(), f.id]));
  const out: FieldIds = {};
  for (const key of Object.keys(CANDIDATES) as Array<keyof FieldIds>) {
    const w = wanted?.[key]?.trim();
    const names = w ? [w.toLowerCase()] : CANDIDATES[key];
    const id = w && isId(w) ? w : names.map((n) => byName.get(n)).find(Boolean);
    if (id) out[key] = id;
  }
  return out;
}

export async function discoverFields(client: { request: <T = any>(m: string, p: string) => Promise<T> }, wanted?: Settings["fields"]): Promise<FieldIds> {
  const all = await client.request<Array<{ id: string; name: string }>>("GET", "/field");
  return resolveFields(all, wanted);
}

/** The `fields` list for issue searches. */
export function issueFieldList(f: FieldIds): string[] {
  return [
    "summary", "description", "status", "issuetype", "priority", "assignee", "reporter", "labels", "parent",
    "created", "updated", "duedate", "issuelinks", "comment", "resolution", "statuscategorychangedate",
    ...Object.values(f),
  ];
}
