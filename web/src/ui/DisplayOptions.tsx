import { Columns3, List } from "lucide-react";
import { ALL_PROPS, displayFor, type Display, type DisplayProp } from "../lib/layout";
import type { ProjectsDisplay } from "../lib/projects";
import { useCtx, useDisplay, useProjectsDisplay, useUi } from "./context";

const PROP_LABELS: Record<DisplayProp, string> = {
  id: "ID", priority: "Priority", status: "Status", type: "Type", labels: "Labels", project: "Project",
  subissues: "Sub-issues", points: "Story points", due: "Due date", assignee: "Assignee", updated: "Updated",
};

function ProjectsDisplayPanel() {
  const { ui, settings } = useCtx();
  const d = useProjectsDisplay();
  const set = (patch: Partial<ProjectsDisplay>) => settings.getState().setProjectsDisplay(patch);
  return (
    <div className="display-scrim" onMouseDown={(e) => e.target === e.currentTarget && ui.getState().closeOverlay()}>
      <div role="dialog" aria-label="Display options" className="display-panel">
        <div className="seg" role="group" aria-label="Layout">
          <button type="button" aria-pressed={d.layout === "list"} onClick={() => set({ layout: "list" })}><List size={14} />List</button>
          <button type="button" aria-pressed={d.layout === "board"} onClick={() => set({ layout: "board" })}><Columns3 size={14} />Board</button>
        </div>
        <label className="disp-row">Grouping
          <select aria-label="Grouping" value={d.groupBy} onChange={(e) => set({ groupBy: e.target.value as ProjectsDisplay["groupBy"] })}>
            <option value="status">Status</option><option value="lead">Lead</option><option value="quarter">Quarter</option><option value="none">No grouping</option>
          </select>
        </label>
        <label className="disp-row">Ordering
          <select aria-label="Ordering" value={d.orderBy} onChange={(e) => set({ orderBy: e.target.value as ProjectsDisplay["orderBy"] })}>
            <option value="updated">Last updated</option><option value="name">Name</option><option value="progress">Progress</option><option value="target">Target date</option>
          </select>
        </label>
        <label className="disp-check"><input type="checkbox" aria-label="Reverse order" checked={d.reverse} onChange={(e) => set({ reverse: e.target.checked })} />Reverse order</label>
        <label className="disp-row">Completed projects
          <select aria-label="Completed projects" value={d.completed} onChange={(e) => set({ completed: e.target.value as ProjectsDisplay["completed"] })}>
            <option value="none">None</option><option value="week">Past week</option><option value="month">Past month</option><option value="all">All</option>
          </select>
        </label>
        <div className="disp-foot">
          <button type="button" className="btn btn-quiet" onClick={() => settings.getState().resetProjectsDisplay()}>Reset to default</button>
        </div>
      </div>
    </div>
  );
}

export function DisplayOptions() {
  const view = useUi((s) => s.view);
  return view === "projects" ? <ProjectsDisplayPanel /> : <TicketDisplayPanel />;
}

function TicketDisplayPanel() {
  const { ui, settings } = useCtx();
  const view = useUi((s) => s.view);
  const d = useDisplay();
  const set = (patch: Partial<Display>) => settings.getState().setDisplay(view, patch);
  const toggleProp = (p: DisplayProp) => set({ props: d.props.includes(p) ? d.props.filter((x) => x !== p) : ALL_PROPS.filter((x) => x === p || d.props.includes(x)) });
  return (
    <div className="display-scrim" onMouseDown={(e) => e.target === e.currentTarget && ui.getState().closeOverlay()}>
      <div role="dialog" aria-label="Display options" className="display-panel">
        <div className="seg" role="group" aria-label="Layout">
          <button type="button" aria-pressed={d.layout === "list"} onClick={() => set({ layout: "list" })}><List size={14} />List</button>
          <button type="button" aria-pressed={d.layout === "board"} onClick={() => set({ layout: "board" })}><Columns3 size={14} />Board</button>
        </div>
        <label className="disp-row">Grouping
          <select aria-label="Grouping" value={d.groupBy} onChange={(e) => set({ groupBy: e.target.value as Display["groupBy"] })}>
            <option value="status">Status</option><option value="assignee">Assignee</option><option value="project">Project</option>
            <option value="priority">Priority</option><option value="label">Label</option><option value="type">Type</option><option value="none">No grouping</option>
          </select>
        </label>
        <label className="disp-row">Ordering
          <select aria-label="Ordering" value={d.orderBy} onChange={(e) => set({ orderBy: e.target.value as Display["orderBy"] })}>
            <option value="updated">Last updated</option><option value="created">Last created</option><option value="priority">Priority</option>
            <option value="status">Status</option><option value="due">Due date</option>
          </select>
        </label>
        <label className="disp-check"><input type="checkbox" aria-label="Reverse order" checked={d.reverse} onChange={(e) => set({ reverse: e.target.checked })} />Reverse order</label>
        <label className="disp-check"><input type="checkbox" aria-label="Show sub-issues" checked={d.showSubIssues} onChange={(e) => set({ showSubIssues: e.target.checked })} />Show sub-issues</label>
        <label className="disp-check"><input type="checkbox" aria-label="Show empty groups" checked={d.showEmptyGroups} onChange={(e) => set({ showEmptyGroups: e.target.checked })} />Show empty groups</label>
        <label className="disp-row">Completed issues
          <select aria-label="Completed issues" value={d.completed} onChange={(e) => set({ completed: e.target.value as Display["completed"] })}>
            <option value="none">None</option><option value="week">Past week</option><option value="month">Past month</option><option value="all">All</option>
          </select>
        </label>
        <div className="disp-props" role="group" aria-label="Display properties">
          {ALL_PROPS.map((p) => (
            <button key={p} type="button" className="prop-chip" aria-pressed={d.props.includes(p)} onClick={() => toggleProp(p)}>{PROP_LABELS[p]}</button>
          ))}
        </div>
        <div className="disp-foot">
          <button type="button" className="btn btn-quiet" onClick={() => settings.getState().resetDisplay(view)}>Reset to default</button>
        </div>
      </div>
    </div>
  );
}
void displayFor;
