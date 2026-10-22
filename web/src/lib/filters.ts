import type { Issue } from "@shared/types";
import { isEpic, stripPermanent } from "./projects";
import { priorityOptions, statusOptions, TYPE_GROUPS, typeClass } from "./vocab";

export type FilterField = "status" | "assignee" | "priority" | "label" | "project" | "type";

export interface Filter {
  field: FilterField;
  /** "is not" instead of "is" */
  not: boolean;
  /** a status name, assignee id, priority name, label, project key or type group; "" means none */
  values: string[];
}

export const FILTER_FIELDS: Array<{ field: FilterField; label: string }> = [
  { field: "status", label: "Status" },
  { field: "assignee", label: "Assignee" },
  { field: "priority", label: "Priority" },
  { field: "label", label: "Label" },
  { field: "project", label: "Project" },
  { field: "type", label: "Type" },
];

const valuesOf = (i: Issue, field: FilterField): string[] => {
  switch (field) {
    case "status": return [i.status];
    case "assignee": return [i.assignee?.id ?? ""];
    case "priority": return [i.priority ?? ""];
    case "label": return i.labels;
    case "project": return [i.parentKey ?? ""];
    case "type": return [typeClass(i.issuetype)];
  }
};

export function applyFilters(issues: Issue[], filters: Filter[]): Issue[] {
  const active = filters.filter((f) => f.values.length > 0);
  if (!active.length) return issues;
  return issues.filter((i) =>
    active.every((f) => {
      const have = valuesOf(i, f.field);
      const hit = f.values.some((v) => (f.field === "label" && v === "" ? have.length === 0 : have.includes(v)));
      return f.not ? !hit : hit;
    }),
  );
}

export interface FilterOption { value: string; label: string; count: number }

const countBy = (issues: Issue[], field: FilterField) => {
  const m = new Map<string, number>();
  for (const i of issues) for (const v of valuesOf(i, field)) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
};

/** What can be picked for a field, with how many of the given tickets match each choice. */
export function filterOptions(field: FilterField, issues: Issue[], all: Issue[]): FilterOption[] {
  const n = countBy(issues, field);
  const opt = (value: string, label: string): FilterOption => ({ value, label, count: n.get(value) ?? 0 });
  switch (field) {
    case "status": return statusOptions(all, false).map((s) => opt(s.name, s.name));
    case "assignee": {
      const people = new Map<string, string>();
      for (const i of all) if (i.assignee) people.set(i.assignee.id, i.assignee.name);
      return [opt("", "No assignee"), ...[...people].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => opt(id, name))];
    }
    case "priority": return [...priorityOptions(all).map((p) => opt(p, p)), opt("", "No priority")];
    case "label": return [...new Set(all.flatMap((i) => i.labels))].sort().map((l) => opt(l, l));
    case "project": return [opt("", "No project"), ...all.filter(isEpic).map((e) => opt(e.key, stripPermanent(e.summary))).sort((a, b) => a.label.localeCompare(b.label))];
    case "type": return TYPE_GROUPS.map((t) => opt(t, t));
  }
}

/** Chip wording: Status · is either of · Backlog, Code Review */
export function describeFilter(f: Filter, ctx: { all: Issue[] }): { field: string; op: string; value: string } {
  const names = new Map(filterOptions(f.field, [], ctx.all).map((o) => [o.value, o.label]));
  const many = f.values.length > 1;
  return {
    field: FILTER_FIELDS.find((x) => x.field === f.field)!.label,
    op: f.not ? (many ? "is neither of" : "is not") : many ? "is either of" : "is",
    value: f.values.map((v) => names.get(v) ?? (v || "None")).join(", "),
  };
}

/** Add or remove one value from the filter for a field; an emptied filter disappears. */
export function toggleValue(filters: Filter[], field: FilterField, value: string): Filter[] {
  const existing = filters.find((f) => f.field === field);
  if (!existing) return [...filters, { field, not: false, values: [value] }];
  const values = existing.values.includes(value) ? existing.values.filter((v) => v !== value) : [...existing.values, value];
  return values.length ? filters.map((f) => (f.field === field ? { ...f, values } : f)) : filters.filter((f) => f.field !== field);
}
