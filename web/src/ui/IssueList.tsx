import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { Issue } from "@shared/types";
import { timeAgo } from "../lib/time";
import { blockState, type BlockState } from "../lib/relations";
import { stripPermanent } from "../lib/projects";
import { typeClass } from "../lib/vocab";
import { dueState, labelHue, startedFractions, subIssueStats } from "../lib/rowdetails";
import type { CreateDefaults } from "../store/ui";
import type { DisplayProp, IssueGroup } from "../lib/layout";
import { Box, ChevronDown, Flag, Plus } from "lucide-react";
import { Avatar, PriorityIcon, StatusIcon } from "./icons";
import { FilterBar } from "./FilterBar";
import { Board } from "./Board";
import { useCtx, useIssueMap, useUi, useVisible } from "./context";

export interface RowHandlers {
  onClick: (k: string, e: React.MouseEvent) => void;
  onToggle: (k: string) => void;
  onContext: (k: string, e: React.MouseEvent) => void;
  onOpen: (k: string) => void;
  onProject: (k: string) => void;
}

/** What a new issue made inside a group should start with. */
export function groupDefaults(g: IssueGroup): CreateDefaults {
  switch (g.kind) {
    case "status": return g.status ? { status: g.status } : {};
    case "assignee": return g.value ? { assigneeId: g.value } : {};
    case "project": return g.value ? { parentKey: g.value } : {};
    case "priority": return g.value ? { priority: g.value } : {};
    case "type": return g.value ? { type: g.value as "Bug" | "Spike" | "Task" } : {};
    case "label": return g.value ? { labels: [g.value] } : {};
    default: return {};
  }
}

export function GroupIcon({ g, fraction }: { g: IssueGroup; fraction?: number }) {
  switch (g.kind) {
    case "status": return <StatusIcon category={g.category ?? "new"} status={g.status} fraction={fraction} />;
    case "assignee": return <Avatar name={g.value ? g.label : null} />;
    case "project": return <Box size={14} className="muted" />;
    case "priority": return <PriorityIcon priority={g.value} />;
    case "type": return <i className={`dot dot-${g.label.toLowerCase()}`} />;
    case "label": return <i className="dot" style={{ background: g.value ? `lch(66 58 ${labelHue(g.value)})` : "var(--muted)" }} />;
    default: return null;
  }
}

/** The ticket's Story Points, shown only when it has an estimate. */
export function StoryPoints({ value }: { value: number }) {
  return <span className="pts" role="img" aria-label={`${value} story points`} title={`${value} story points`}>{value}</span>;
}

/** Small flag shown on tickets marked for team review. */
export function ReviewFlag() {
  return <span className="chip chip-review" role="img" aria-label="For review" title="Marked for team review (only on this computer)"><Flag size={11} /></span>;
}

export const Row = memo(function Row({ issue, selected, checked, reviewed, block, fraction, sub, now, show, onClick, onToggle, onContext, onOpen, onProject }: RowHandlers & {
  issue: Issue; selected: boolean; checked: boolean; reviewed: boolean; block: BlockState; fraction?: number;
  sub?: { done: number; total: number }; now: Date; show: Set<DisplayProp>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  const pending = issue.key.startsWith("NEW-");
  const due = show.has("due") ? dueState(issue.duedate, issue.statusCategory === "done", now) : null;
  const type = typeClass(issue.issuetype);
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      aria-label={`${pending ? "New" : issue.key} ${issue.summary}${block ? `, ${block}` : ""}`}
      data-key={issue.key}
      className={`row${selected ? " is-selected" : ""}${checked ? " is-checked" : ""}${pending ? " is-pending" : ""}`}
      onClick={(e) => onClick(issue.key, e)}
      onContextMenu={(e) => onContext(issue.key, e)}
      onDoubleClick={() => onOpen(issue.key)}
    >
      <label className="row-lead" title="Select" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <input type="checkbox" className="row-check" aria-label={`Select ${issue.key}`} checked={checked} onChange={() => onToggle(issue.key)} />
        {show.has("priority") && <PriorityIcon priority={issue.priority} />}
      </label>
      {show.has("id") && <span className="row-key">{pending ? "New" : issue.key}</span>}
      {show.has("status") && <StatusIcon category={issue.statusCategory} status={issue.status} block={block} fraction={fraction} />}
      <span className="row-title">{issue.summary}</span>
      {show.has("subissues") && sub && (
        <span className="subprog" title={`${sub.done} of ${sub.total} sub-issues done`}>
          <StatusIcon category={sub.done === sub.total ? "done" : "indeterminate"} fraction={sub.done / sub.total} />
          {sub.done}/{sub.total}
        </span>
      )}
      <span className="row-meta">
        {show.has("points") && issue.storyPoints !== null && <StoryPoints value={issue.storyPoints} />}
        {reviewed && <ReviewFlag />}
        {show.has("type") && type !== "Task" && (
          <span className={`chip chip-type chip-${type.toLowerCase()}`}><i className="dot" />{type}</span>
        )}
        {show.has("labels") && issue.labels.slice(0, 2).map((l) => <span key={l} className="chip chip-label"><i className="dot" style={{ background: `lch(66 58 ${labelHue(l)})` }} />{l}</span>)}
        {show.has("project") && issue.parentKey && issue.parentSummary && (
          <button type="button" className="chip chip-epic" onClick={(e) => { e.stopPropagation(); onProject(issue.parentKey!); }}>
            {stripPermanent(issue.parentSummary)}
          </button>
        )}
      </span>
      {due && <span className="due" data-overdue={due.overdue} data-soon={due.soon}>{due.text}</span>}
      {show.has("assignee") && <Avatar name={issue.assignee?.name ?? null} />}
      {show.has("updated") && <time className="row-time">{timeAgo(issue.updated)}</time>}
    </div>
  );
});

/** Shared by the list and the board: click / context / open behaviour and the data rows need. */
export function useRowData() {
  const { ui } = useCtx();
  const map = useIssueMap();
  const { order, display } = useVisible();
  const fractions = useMemo(() => startedFractions(Object.values(map)), [map]);
  const subs = useMemo(() => subIssueStats(Object.values(map)), [map]);
  const now = useMemo(() => new Date(), [map]); // eslint-disable-line react-hooks/exhaustive-deps
  const show = useMemo(() => new Set(display.props), [display.props]);
  const orderRef = useRef(order);
  orderRef.current = order;
  const handlers: RowHandlers = {
    onClick: useCallback((key, e) => {
      const s = ui.getState();
      if (e.shiftKey) s.selectRange(orderRef.current, key);
      else if (e.metaKey || e.ctrlKey) s.toggleSelect(key);
      else s.select(key);
    }, [ui]),
    onToggle: useCallback((key) => ui.getState().toggleSelect(key), [ui]),
    onContext: useCallback((key, e) => {
      e.preventDefault();
      const s = ui.getState();
      if (!s.selection.includes(key)) { s.clearSelection(); s.select(key); }
      s.openContext(e.clientX, e.clientY);
    }, [ui]),
    onOpen: useCallback((k) => ui.getState().openIssue(k), [ui]),
    onProject: useCallback((k) => ui.getState().setView(`project:${k}`), [ui]),
  };
  return { map, fractions, subs, now, show, handlers };
}

export function IssueList() {
  const { groups, total, display, filters } = useVisible();
  const { ui, review } = useCtx();
  const selected = useUi((s) => s.selectedKey);
  const selection = useUi((s) => s.selection);
  const search = useUi((s) => s.search);
  const collapsed = useUi((s) => s.collapsedGroups);
  const view = useUi((s) => s.view);
  const { map, fractions, subs, now, show, handlers } = useRowData();

  const empty =
    total === 0 ? (
      <div className="empty" role="status">
        {search ? <p>No issues match “{search}”.</p>
          : filters.length ? (
            <>
              <p>No issues match these filters.</p>
              <button type="button" className="btn" onClick={() => ui.getState().clearFilters()}>Clear filters</button>
            </>
          ) : view === "review" ? <p>Nothing marked for review. Press <kbd>T</kbd> on a ticket to add it here. Marks stay on this computer and are not sent to Jira.</p>
          : <p>No issues in this view yet. Press <kbd>C</kbd> to create one.</p>}
      </div>
    ) : null;

  const rows = (g: IssueGroup) => g.issues.map((i) => (
    <Row
      key={i.key} issue={i} selected={i.key === selected} checked={selection.includes(i.key)} reviewed={!!review[i.key]} block={blockState(i, map)}
      fraction={fractions[i.status]} sub={subs[i.key]} now={now} show={show} {...handlers}
    />
  ));

  if (display.layout === "board" && !empty) return <><FilterBar /><Board /></>;
  return (
    <>
      <FilterBar />
      {empty ?? (
        <div role="listbox" aria-label="Issues" className={`list${selection.length ? " has-selection" : ""}`}>
          {groups.map((g) => {
            const folded = collapsed.includes(`${view}|${g.id}`);
            if (g.kind === "none") return <section key={g.id} role="group" aria-label="Issues" className="group">{rows(g)}</section>;
            return (
              <section key={g.id} role="group" aria-label={`${g.label}, ${g.issues.length}`} className="group">
                <div className="group-head">
                  <button type="button" className="group-toggle" aria-expanded={!folded} onClick={() => ui.getState().toggleGroup(g.id)}>
                    <ChevronDown size={13} className="group-chev" />
                    <GroupIcon g={g} fraction={g.status ? fractions[g.status] : undefined} />
                    <span>{g.label}</span>
                    <span className="count">{g.issues.length}</span>
                  </button>
                  <button type="button" className="icon-btn group-add" aria-label={`Add issue to ${g.label}`} title={`Add issue to ${g.label}`} onClick={() => ui.getState().openCreate(groupDefaults(g))}>
                    <Plus size={15} />
                  </button>
                </div>
                {!folded && rows(g)}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
