import { memo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { Issue } from "@shared/types";
import { blockState, type BlockState } from "../lib/relations";
import { dropChanges } from "../lib/drop";
import { stripPermanent } from "../lib/projects";
import { dueState, labelHue } from "../lib/rowdetails";
import { typeClass } from "../lib/vocab";
import type { DisplayProp, IssueGroup } from "../lib/layout";
import { Avatar, PriorityIcon, StatusIcon } from "./icons";
import { GroupIcon, ReviewFlag, StoryPoints, groupDefaults, useRowData, type RowHandlers } from "./IssueList";
import { useCtx, useUi, useVisible } from "./context";

const Card = memo(function Card({ issue, selected, checked, reviewed, block, fraction, now, show, onDragStart, onClick, onToggle, onContext, onOpen, onProject }: RowHandlers & {
  issue: Issue; selected: boolean; checked: boolean; reviewed: boolean; block: BlockState; fraction?: number; now: Date; show: Set<DisplayProp>;
  onDragStart: (key: string) => void;
}) {
  const type = typeClass(issue.issuetype);
  const due = show.has("due") ? dueState(issue.duedate, issue.statusCategory === "done", now) : null;
  return (
    <div
      role="option" draggable aria-selected={selected} data-key={issue.key}
      aria-label={`${issue.key} ${issue.summary}${block ? `, ${block}` : ""}`}
      className={`card${selected ? " is-selected" : ""}${checked ? " is-checked" : ""}`}
      onDragStart={(e) => { e.dataTransfer?.setData?.("text/plain", issue.key); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; onDragStart(issue.key); }}
      onClick={(e) => onClick(issue.key, e)} onContextMenu={(e) => onContext(issue.key, e)} onDoubleClick={() => onOpen(issue.key)}
    >
      <label className="card-lead" title="Select" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <input type="checkbox" className="row-check card-check" aria-label={`Select ${issue.key}`} checked={checked} onChange={() => onToggle(issue.key)} />
      </label>
      <div className="card-top">
        {show.has("id") && <span className="row-key">{issue.key}</span>}
        {show.has("assignee") && <span className="card-assignee"><Avatar name={issue.assignee?.name ?? null} /></span>}
      </div>
      <div className="card-title">{issue.summary}</div>
      <div className="card-foot">
        {show.has("priority") && <PriorityIcon priority={issue.priority} />}
        {show.has("status") && <StatusIcon category={issue.statusCategory} status={issue.status} block={block} fraction={fraction} />}
        {show.has("type") && type !== "Task" && <span className={`chip chip-type chip-${type.toLowerCase()}`}><i className="dot" />{type}</span>}
        {show.has("labels") && issue.labels.slice(0, 2).map((l) => <span key={l} className="chip chip-label"><i className="dot" style={{ background: `lch(66 58 ${labelHue(l)})` }} />{l}</span>)}
        {show.has("project") && issue.parentKey && issue.parentSummary && (
          <button type="button" className="chip chip-epic" onClick={(e) => { e.stopPropagation(); onProject(issue.parentKey!); }}>{stripPermanent(issue.parentSummary)}</button>
        )}
        {show.has("points") && issue.storyPoints !== null && <StoryPoints value={issue.storyPoints} />}
        {reviewed && <ReviewFlag />}
        {due && <span className="due" data-overdue={due.overdue} data-soon={due.soon}>{due.text}</span>}
      </div>
    </div>
  );
});

/** Kanban board: one column per group; drop cards on a column to make the change that column means. */
export function Board() {
  const { groups } = useVisible();
  const { ui, app, review } = useCtx();
  const selected = useUi((s) => s.selectedKey);
  const selection = useUi((s) => s.selection);
  const { map, fractions, now, show, handlers } = useRowData();
  const dragged = useRef<string[]>([]);
  const [over, setOver] = useState<string | null>(null);

  const start = (key: string) => {
    dragged.current = ui.getState().selection.includes(key) ? [...ui.getState().selection] : [key];
  };
  const drop = (g: IssueGroup) => {
    const issues = dragged.current.map((k) => map[k]).filter((i): i is Issue => !!i);
    dragged.current = [];
    setOver(null);
    const changes = dropChanges(g, issues, Object.values(map));
    if (changes.length) void app.getState().mutateMany(changes);
  };

  return (
    <div role="listbox" aria-label="Issues" className="board">
      {groups.map((g) => (
        <section
          key={g.id} role="group" aria-label={`${g.label}, ${g.issues.length}`} className={`column${over === g.id ? " is-over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); if (over !== g.id) setOver(g.id); }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(null); }}
          onDrop={(e) => { e.preventDefault(); drop(g); }}
        >
          <div className="column-head">
            <GroupIcon g={g} fraction={g.status ? fractions[g.status] : undefined} />
            <span className="column-name">{g.label}</span>
            <span className="count">{g.issues.length}</span>
            <button type="button" className="icon-btn group-add" aria-label={`Add issue to ${g.label}`} title={`Add issue to ${g.label}`} onClick={() => ui.getState().openCreate(groupDefaults(g))}><Plus size={15} /></button>
          </div>
          <div className="column-body">
            {g.issues.map((i) => (
              <Card
                key={i.key} issue={i} selected={i.key === selected} checked={selection.includes(i.key)} reviewed={!!review[i.key]} block={blockState(i, map)}
                fraction={fractions[i.status]} now={now} show={show} onDragStart={start} {...handlers}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
