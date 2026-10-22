import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Calendar, ChevronRight, CircleUserRound, Tag, X } from "lucide-react";
import { stripPermanent, isEpic } from "../lib/projects";
import { jiraTypeFor, priorityOptions, statusOptions, TYPE_GROUPS, type TypeGroup } from "../lib/vocab";
import { localContext } from "../store/store";
import type { CreateDefaults } from "../store/ui";
import { contextDefaults } from "./defaults";
import { PickList, type PickItem } from "./Overlay";
import { Avatar, PriorityIcon, StatusIcon } from "./icons";
import { useCtx, useIssueMap, useStatusFractions, useUi } from "./context";
import { site } from "../lib/site";

type PillId = "type" | "status" | "priority" | "assignee" | "labels" | "project" | "due";

const HOTKEYS: Record<string, PillId> = { t: "type", s: "status", p: "priority", a: "assignee", l: "labels" };

const dot = (cls: string) => <i className={`dot ${cls}`} />;

export function CreateIssueDialog({ defaults }: { defaults?: CreateDefaults }) {
  const { app, ui, me } = useCtx();
  const issues = useIssueMap();
  const all = useMemo(() => Object.values(issues), [issues]);
  const fractions = useStatusFractions();
  const view = useUi((s) => s.view);
  const initial = useMemo(() => ({ ...contextDefaults(view, me), ...defaults }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TypeGroup>(initial.type ?? "Task");
  const [status, setStatus] = useState(initial.status ?? "Backlog");
  const [priority, setPriority] = useState<string | null>(initial.priority ?? null);
  const [assigneeId, setAssigneeId] = useState<string | null>(initial.assigneeId ?? null);
  const [labels, setLabels] = useState<string[]>(initial.labels ?? []);
  const [due, setDue] = useState("");
  const [parentKey, setParentKey] = useState<string | null>(initial.parentKey ?? null);
  const [open, setOpen] = useState<PillId | null>(null);
  const [more, setMore] = useState(false);
  const title = useRef<HTMLInputElement>(null);
  const desc = useRef<HTMLTextAreaElement>(null);
  const pills = useRef<Partial<Record<PillId, HTMLButtonElement | null>>>({});
  useEffect(() => title.current?.focus(), []);

  const close = () => ui.getState().closeOverlay();
  const users = localContext(issues).users;
  const projects = useMemo(() => all.filter(isEpic), [all]);
  const valid = summary.trim().length > 0;

  const submit = () => {
    if (!valid) return;
    void app.getState().mutate({
      op: "createIssue", summary: summary.trim(), issuetype: jiraTypeFor(type, all),
      ...(description.trim() ? { markdown: description } : {}),
      ...(labels.length ? { labels } : {}),
      ...(due ? { duedate: due } : {}),
      ...(parentKey ? { parentKey } : {}),
      ...(priority ? { priority } : {}),
      ...(assigneeId ? { assigneeId } : {}),
      ...(status !== "Backlog" ? { status } : {}),
    });
    if (more) {
      setSummary("");
      setDescription("");
      title.current?.focus();
    } else close();
  };

  const closePopover = (id: PillId) => {
    setOpen(null);
    pills.current[id]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation(); // close only the list, not the whole dialog
      closePopover(open);
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); return; }
    const tag = (e.target as HTMLElement).tagName;
    if (e.metaKey || e.ctrlKey || e.altKey || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const k = e.key.toLowerCase();
    const id = e.shiftKey ? (k === "p" ? "project" : k === "d" ? "due" : undefined) : HOTKEYS[k];
    if (id) { e.preventDefault(); setOpen(id); }
  };

  // ---- pill contents
  const typeItems: PickItem[] = TYPE_GROUPS.map((g) => ({
    id: g, label: g, icon: dot(`dot-${g.toLowerCase()}`), checked: g === type,
  }));
  const statusItems: PickItem[] = useMemo(
    () => statusOptions(all, false).map((s) => ({
      id: s.name, label: s.name, checked: s.name === status,
      icon: <StatusIcon category={s.category} status={s.name} fraction={fractions.tickets[s.name]} />,
    })),
    [all, status, fractions],
  );
  const priorityItems: PickItem[] = [
    { id: "", label: "No priority", icon: <PriorityIcon priority={null} />, checked: priority === null },
    ...priorityOptions(all).map((p) => ({ id: p, label: p, icon: <PriorityIcon priority={p} />, checked: priority === p })),
  ];
  const people = Object.entries(users).sort((a, b) => (a[0] === me?.id ? -1 : b[0] === me?.id ? 1 : a[1].localeCompare(b[1])));
  const assigneeItems: PickItem[] = [
    { id: "", label: "Unassigned", icon: <Avatar name={null} />, checked: assigneeId === null },
    ...people.map(([id, name]) => ({ id, label: name, hint: id === me?.id ? "You" : undefined, icon: <Avatar name={name} />, checked: assigneeId === id })),
  ];
  const allLabels = useMemo(() => [...new Set(all.flatMap((i) => i.labels))].sort(), [all]);
  const labelItems: PickItem[] = allLabels.map((l) => ({ id: l, label: l, checked: labels.includes(l) }));
  const projectItems: PickItem[] = [
    { id: "", label: "No project", checked: parentKey === null },
    ...projects.map((p) => ({ id: p.key, label: stripPermanent(p.summary), hint: p.key, search: `${p.key} ${stripPermanent(p.summary)}`, checked: parentKey === p.key })),
  ];

  const projectName = parentKey ? stripPermanent(issues[parentKey]?.summary ?? parentKey) : null;
  const assigneeName = assigneeId ? users[assigneeId] ?? assigneeId : null;
  const statusCat = statusOptions(all, false).find((s) => s.name === status)?.category ?? "new";

  function Pill({ id, name, value, icon, empty = "none", children }: { id: PillId; name: string; value: string | null; icon: React.ReactNode; empty?: string; children: React.ReactNode }) {
    return (
      <div className="pill-wrap">
        <button
          type="button" ref={(el) => { pills.current[id] = el; }} className={`pill${value ? " has-value" : ""}`}
          aria-label={`${name}: ${value ?? empty}`} aria-haspopup="dialog" aria-expanded={open === id}
          onClick={() => setOpen(open === id ? null : id)}
        >
          {icon}<span>{value ?? name}</span>
        </button>
        {open === id && <div role="dialog" aria-label={`Choose ${name.toLowerCase()}`} className="popover">{children}</div>}
      </div>
    );
  }

  return (
    <div className="scrim modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        role="dialog" aria-modal="true" aria-label="Create issue" className="modal"
        onSubmit={(e) => { e.preventDefault(); submit(); }} onKeyDown={onKeyDown}
      >
        <header className="modal-head">
          <span className="team-chip">{site.name}</span>
          <ChevronRight size={13} />
          <span>New issue</span>
          <button type="button" className="icon-btn modal-x" aria-label="Close" onClick={close}><X size={15} /></button>
        </header>
        <input
          ref={title} className="modal-title" aria-label="Summary" placeholder="Issue title" value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); desc.current?.focus(); } }}
        />
        <textarea ref={desc} className="modal-desc" aria-label="Description" placeholder="Add description…" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="pills">
          <Pill id="type" name="Type" value={type} icon={dot(`dot-${type.toLowerCase()}`)}>
            <PickList placeholder="Change type…" groups={[{ items: typeItems }]} onPick={(id) => { setType(id as TypeGroup); closePopover("type"); }} />
          </Pill>
          <Pill id="status" name="Status" value={status} icon={<StatusIcon category={statusCat} status={status} fraction={fractions.tickets[status]} />}>
            <PickList placeholder="Change status…" groups={[{ items: statusItems }]} onPick={(id) => { setStatus(id); closePopover("status"); }} />
          </Pill>
          <Pill id="priority" name="Priority" value={priority} icon={<PriorityIcon priority={priority} />}>
            <PickList placeholder="Set priority…" groups={[{ items: priorityItems }]} onPick={(id) => { setPriority(id || null); closePopover("priority"); }} />
          </Pill>
          <Pill id="assignee" name="Assignee" empty="Unassigned" value={assigneeName} icon={assigneeName ? <Avatar name={assigneeName} /> : <CircleUserRound size={15} />}>
            <PickList placeholder="Assign to…" groups={[{ items: assigneeItems }]} onPick={(id) => { setAssigneeId(id || null); closePopover("assignee"); }} />
          </Pill>
          <Pill id="labels" name="Labels" value={labels.length ? labels.join(", ") : null} icon={<Tag size={14} />}>
            <PickList
              placeholder="Add labels…" groups={[{ items: labelItems }]}
              extra={(q) => { const t = q.trim(); return t && !allLabels.some((l) => l.toLowerCase() === t.toLowerCase()) && !labels.includes(t) ? { id: t, label: `Add label “${t}”` } : null; }}
              onPick={(id) => setLabels(labels.includes(id) ? labels.filter((l) => l !== id) : [...labels, id])}
            />
          </Pill>
          <Pill id="project" name="Project" value={projectName} icon={<Box size={14} />}>
            <PickList placeholder="Add to project…" groups={[{ items: projectItems }]} onPick={(id) => { setParentKey(id || null); closePopover("project"); }} />
          </Pill>
          <Pill id="due" name="Due date" value={due || null} icon={<Calendar size={14} />}>
            <div className="date-pop">
              <input
                type="date" aria-label="Due date" autoFocus value={due} onChange={(e) => setDue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); closePopover("due"); } }}
              />
              {due && <button type="button" className="btn btn-quiet" onClick={() => { setDue(""); closePopover("due"); }}>Clear</button>}
            </div>
          </Pill>
        </div>
        <footer className="modal-foot">
          <label className="toggle">
            <input type="checkbox" aria-label="Create more" checked={more} onChange={(e) => setMore(e.target.checked)} />
            <span className="switch" aria-hidden="true" />
            <span>Create more</span>
          </label>
          <button type="submit" className="btn btn-primary" disabled={!valid}>Create issue</button>
        </footer>
      </form>
    </div>
  );
}
