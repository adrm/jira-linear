import { useEffect, useRef, useState } from "react";
import type { InboxRules as Rules } from "@shared/inbox";
import { STATUS_FLOW } from "../lib/workflow";
import { isEpic } from "../lib/projects";
import { Choice } from "./Choice";
import { useApp, useCtx, useIssueMap } from "./context";

const FIELDS: Array<[keyof Rules["fields"], string]> = [
  ["priority", "Priority"], ["duedate", "Due date"], ["summary", "Title"], ["description", "Description"], ["labels", "Labels"], ["type", "Type"], ["parent", "Parent"], ["links", "Links"],
];

function Check({ label, text, checked, onChange }: { label: string; text?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="disp-check">
      <input type="checkbox" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />{text ?? label}
    </label>
  );
}

const tick = (list: string[], item: string, on: boolean) => (on ? [...list, item] : list.filter((x) => x !== item));

/** Which changes reach the inbox. The server holds the rules and applies them as it syncs; each change is saved at once. */
export function InboxRules() {
  const { fetchFn } = useCtx();
  const issues = useIssueMap();
  const notify = useApp((s) => s.notify);
  const [rules, setRules] = useState<Rules | null>(null);
  // "Only moves into…" is chosen before any status is ticked; the server takes no empty list, so it is kept here until then.
  const [choosingStatuses, setChoosingStatuses] = useState(false);
  const current = useRef<Rules | null>(null);
  current.current = rules;

  useEffect(() => {
    let alive = true;
    fetchFn("/api/inbox/rules").then((r) => (r.ok ? r.json() : null)).then((r: Rules | null) => { if (alive && r) setRules(r); }).catch(() => {});
    return () => { alive = false; };
  }, [fetchFn]);

  if (!rules) return null;
  const save = (patch: Partial<Rules>) => {
    const before = current.current!;
    setRules({ ...before, ...patch });
    fetchFn("/api/inbox/rules", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...before, ...patch }) })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
      .catch(() => {
        setRules(before);
        notify("Couldn’t save the notification rules");
      });
  };
  const into = rules.status.mode === "into" ? rules.status.statuses : [];
  const statusMode = choosingStatuses ? "into" : rules.status.mode;
  const epics = Object.values(issues).filter(isEpic);

  const pickStatusMode = (mode: "off" | "any" | "into") => {
    setChoosingStatuses(mode === "into");
    if (mode !== "into") save({ status: { mode } });
  };
  const tickStatus = (name: string, on: boolean) => {
    const next = tick(into, name, on);
    if (next.length === 0) {
      setChoosingStatuses(false);
      save({ status: { mode: "off" } });
    } else save({ status: { mode: "into", statuses: next } });
  };

  return (
    <section aria-label="Notifications" className="inbox-rules">
      <h3 className="dlg-subtitle">Notifications</h3>
      <p className="muted">What reaches the Inbox. Changes you make yourself never do.</p>
      <Choice label="Notification scope" options={[["involved", "Tickets I’m involved in"], ["project", "Whole project"]]} value={rules.scope} onPick={(scope) => save({ scope })} />
      <Check label="Mentions of me in comments" checked={rules.mentions} onChange={(mentions) => save({ mentions })} />
      <Check label="Assigned to me or taken off me" checked={rules.assigned} onChange={(assigned) => save({ assigned })} />
      <Choice label="Status changes" options={[["off", "Off"], ["any", "Any status"], ["into", "Only moves into…"]]} value={statusMode} onPick={pickStatusMode} />
      {statusMode === "into" && (
        <div className="rule-list">
          {STATUS_FLOW.map((name) => <Check key={name} label={`Notify when moved to ${name}`} text={name} checked={into.includes(name)} onChange={(on) => tickStatus(name, on)} />)}
        </div>
      )}
      <Choice label="Comments" options={[["off", "Off"], ["mentions", "Only mentions"], ["all", "Every comment"]]} value={rules.comments} onPick={(comments) => save({ comments })} />
      <Choice
        label="New tickets" options={[["off", "Off"], ["assigned", "Assigned to me"], ["epics", "In epics…"], ["all", "All"]]} value={rules.newTickets.mode}
        onPick={(mode) => save({ newTickets: { mode, epics: rules.newTickets.epics } })}
      />
      {rules.newTickets.mode === "epics" && (
        <div className="rule-list">
          {epics.map((e) => (
            <Check
              key={e.key} label={`Notify for new tickets in ${e.summary}`} text={e.summary} checked={rules.newTickets.epics.includes(e.key)}
              onChange={(on) => save({ newTickets: { mode: "epics", epics: tick(rules.newTickets.epics, e.key, on) } })}
            />
          ))}
        </div>
      )}
      <p className="muted">Other changes</p>
      {FIELDS.map(([id, text]) => (
        <Check key={id} label={`Notify on ${text} changes`} text={text} checked={rules.fields[id]} onChange={(on) => save({ fields: { ...rules.fields, [id]: on } })} />
      ))}
    </section>
  );
}
