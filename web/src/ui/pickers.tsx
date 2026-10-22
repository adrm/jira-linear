import { useEffect, useMemo, useRef, useState } from "react";
import type { Issue } from "@shared/types";
import { isEpic, stripPermanent } from "../lib/projects";
import { jiraTypeFor, priorityOptions, statusOptions, typeClass, TYPE_GROUPS, type TypeGroup } from "../lib/vocab";
import { localContext } from "../store/store";
import { PickerDialog, PickList, type PickItem } from "./Overlay";
import { Avatar, PriorityIcon, StatusIcon } from "./icons";
import { useCtx, useIssueMap, useStatusFractions, useTargetIssues } from "./context";

const same = <T,>(issues: Issue[], get: (i: Issue) => T, value: T) => issues.length > 0 && issues.every((i) => get(i) === value);
const subtitleOf = (n: number) => (n > 1 ? `${n} issues` : undefined);

function usePickerBasics() {
  const { app, ui } = useCtx();
  const targets = useTargetIssues();
  const close = () => ui.getState().closeOverlay();
  const apply = (body: (i: Issue) => Parameters<ReturnType<typeof app.getState>["mutateMany"]>[0][number]) => {
    close();
    void app.getState().mutateMany(targets.map(body));
  };
  return { app, ui, targets, close, apply };
}

export function StatusPicker() {
  const { targets, close, apply } = usePickerBasics();
  const issues = useIssueMap();
  const fractions = useStatusFractions();
  const items = useMemo<PickItem[]>(() => {
    const forProject = targets.length > 0 && targets.every(isEpic);
    return statusOptions(Object.values(issues), forProject).map((s) => ({
      id: s.name, label: s.name, icon: <StatusIcon category={s.category} status={s.name} fraction={(forProject ? fractions.projects : fractions.tickets)[s.name]} />, checked: same(targets, (i) => i.status, s.name),
    }));
  }, [issues, targets, fractions]);
  return (
    <PickerDialog
      title="Set status" subtitle={subtitleOf(targets.length)} placeholder="Set status…" groups={[{ items }]}
      onClose={close} onPick={(status) => apply((i) => ({ op: "setStatus", key: i.key, status }))}
    />
  );
}

export function AssigneePicker() {
  const { targets, close, apply } = usePickerBasics();
  const issues = useIssueMap();
  const { me } = useCtx();
  const items = useMemo<PickItem[]>(() => {
    const users = localContext(issues).users;
    const people = Object.entries(users).sort((a, b) => (a[0] === me?.id ? -1 : b[0] === me?.id ? 1 : a[1].localeCompare(b[1])));
    return [
      { id: "", label: "Unassigned", icon: <Avatar name={null} />, checked: same(targets, (i) => i.assignee?.id ?? "", "") },
      ...people.map(([id, name]) => ({ id, label: name, hint: id === me?.id ? "You" : undefined, icon: <Avatar name={name} />, checked: same(targets, (i) => i.assignee?.id ?? "", id) })),
    ];
  }, [issues, targets, me]);
  return (
    <PickerDialog
      title="Set assignee" subtitle={subtitleOf(targets.length)} placeholder="Assign to…" groups={[{ items }]}
      onClose={close} onPick={(id) => apply((i) => ({ op: "setAssignee", key: i.key, accountId: id || null }))}
    />
  );
}

export function PriorityPicker() {
  const { targets, close, apply } = usePickerBasics();
  const issues = useIssueMap();
  const items = useMemo(
    () => priorityOptions(Object.values(issues)).map((p) => ({ id: p, label: p, icon: <PriorityIcon priority={p} />, checked: same(targets, (i) => i.priority, p) })),
    [issues, targets],
  );
  return (
    <PickerDialog
      title="Set priority" subtitle={subtitleOf(targets.length)} placeholder="Set priority…" groups={[{ items }]}
      onClose={close} onPick={(priority) => apply((i) => ({ op: "setPriority", key: i.key, priority }))}
    />
  );
}

export function LabelsPicker() {
  const { app, ui, targets } = usePickerBasics();
  const issues = useIssueMap();
  const all = useMemo(() => [...new Set(Object.values(issues).flatMap((i) => i.labels))].sort(), [issues]);
  const state = (label: string): boolean | "mixed" => {
    const n = targets.filter((i) => i.labels.includes(label)).length;
    return n === 0 ? false : n === targets.length ? true : "mixed";
  };
  // "Type" is a label group: exactly one of Bug / Spike / Task, backed by the Jira issue type
  const typeItems = TYPE_GROUPS.map((g) => ({
    id: `type:${g}`, label: g, search: `type ${g}`,
    checked: targets.length > 0 && targets.every((i) => typeClass(i.issuetype) === g),
  }));
  const items = all.map((l) => ({ id: l, label: l, checked: state(l) }));
  const pickType = (group: TypeGroup) => {
    const name = jiraTypeFor(group, Object.values(issues));
    const bodies = targets.filter((i) => typeClass(i.issuetype) !== group).map((i) => ({ op: "setType" as const, key: i.key, issuetype: name }));
    if (bodies.length) void app.getState().mutateMany(bodies);
  };
  const toggle = (label: string) => {
    const remove = state(label) === true; // everyone has it -> take it off everyone; otherwise add it to those missing it
    const bodies = targets
      .filter((i) => (remove ? i.labels.includes(label) : !i.labels.includes(label)))
      .map((i) => ({ op: "setLabels" as const, key: i.key, labels: remove ? i.labels.filter((l) => l !== label) : [...i.labels, label] }));
    void app.getState().mutateMany(bodies);
  };
  return (
    <PickerDialog
      title="Set labels" subtitle={subtitleOf(targets.length)} placeholder="Add or remove labels…"
      groups={[{ heading: "Type", items: typeItems }, { heading: "Labels", items }]}
      extra={(q) => {
        const t = q.trim();
        return t && !all.some((l) => l.toLowerCase() === t.toLowerCase()) ? { id: t, label: `Add label “${t}”` } : null;
      }}
      onClose={() => ui.getState().closeOverlay()}
      onPick={(id) => (id.startsWith("type:") ? pickType(id.slice(5) as TypeGroup) : toggle(id))}
    />
  );
}

export function ProjectPicker() {
  const { targets, close, apply } = usePickerBasics();
  const issues = useIssueMap();
  const keys = new Set(targets.map((t) => t.key));
  const projects = useMemo(() => Object.values(issues).filter((i) => isEpic(i) && !keys.has(i.key)), [issues, targets]); // eslint-disable-line react-hooks/exhaustive-deps
  const items: PickItem[] = [
    { id: "", label: "No project", checked: same(targets, (i) => i.parentKey ?? "", "") },
    ...projects.map((e) => ({ id: e.key, label: stripPermanent(e.summary), hint: e.key, search: `${e.key} ${stripPermanent(e.summary)}`, checked: same(targets, (i) => i.parentKey ?? "", e.key) })),
  ];
  return (
    <PickerDialog
      title="Set project" subtitle={subtitleOf(targets.length)} placeholder="Move to project…" groups={[{ items }]}
      onClose={close} onPick={(id) => apply((i) => ({ op: "setParent", key: i.key, parentKey: id || null }))}
    />
  );
}

export function DueDatePicker() {
  const { targets, close, apply } = usePickerBasics();
  const common = targets.length && targets.every((t) => t.duedate === targets[0].duedate) ? targets[0].duedate : null;
  const [date, setDate] = useState(common ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form role="dialog" aria-modal="true" aria-label="Set due date" className="dialog form" onSubmit={(e) => { e.preventDefault(); if (date) apply((i) => ({ op: "setDueDate", key: i.key, date })); }}>
        {targets.length > 1 && <h2 className="dlg-sub">{targets.length} issues</h2>}
        <label>Due date<input ref={input} type="date" aria-label="Due date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => apply((i) => ({ op: "setDueDate", key: i.key, date: null }))}>Clear</button>
          <button type="submit" className="btn btn-primary" disabled={!date}>Save</button>
        </div>
      </form>
    </div>
  );
}

const RELATION_TITLE = { blockedBy: "Blocked by", blocks: "Blocking", relates: "Related to" } as const;

/** Pick another ticket to relate the given one to. Searches by key or title, newest first. */
export function RelationPicker({ relation, issueKey }: { relation: "blockedBy" | "blocks" | "relates"; issueKey: string }) {
  const { app, ui } = useCtx();
  const issues = useIssueMap();
  const fractions = useStatusFractions();
  const candidates = useMemo(
    () => Object.values(issues).filter((i) => !isEpic(i) && i.key !== issueKey && !i.key.startsWith("NEW-")).sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0)),
    [issues, issueKey],
  );
  const source = (q: string): PickItem[] => {
    const t = q.trim().toLowerCase();
    return candidates
      .filter((i) => !t || `${i.key} ${i.summary}`.toLowerCase().includes(t))
      .slice(0, 50)
      .map((i) => ({ id: i.key, label: i.summary, hint: i.key, search: `${i.key} ${i.summary}`, icon: <StatusIcon category={i.statusCategory} status={i.status} fraction={fractions.tickets[i.status]} /> }));
  };
  const pick = (other: string) => {
    ui.getState().closeOverlay();
    const body = relation === "blockedBy"
      ? { op: "link" as const, type: "Blocks", outwardKey: other, inwardKey: issueKey }
      : relation === "blocks"
        ? { op: "link" as const, type: "Blocks", outwardKey: issueKey, inwardKey: other }
        : { op: "link" as const, type: "Relates", outwardKey: issueKey, inwardKey: other };
    void app.getState().mutate(body);
  };
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && ui.getState().closeOverlay()}>
      <div role="dialog" aria-modal="true" aria-label={RELATION_TITLE[relation]} className="dialog">
        <h2 className="dlg-sub">{RELATION_TITLE[relation]} · {issueKey}</h2>
        <PickList placeholder="Search tickets…" groups={[]} source={source} onPick={pick} />
      </div>
    </div>
  );
}
