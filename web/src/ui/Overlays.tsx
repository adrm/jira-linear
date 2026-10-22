import { useEffect, useMemo, useRef, useState } from "react";
import type { View } from "../store/ui";
import { SHORTCUTS } from "./shortcuts";
import { PickerDialog, type PickItem } from "./Overlay";
import { StatusIcon } from "./icons";
import { AssigneePicker, DueDatePicker, LabelsPicker, PriorityPicker, ProjectPicker, RelationPicker, StatusPicker } from "./pickers";
import { ContextMenu } from "./ContextMenu";
import { FilterMenu } from "./FilterMenu";
import { DisplayOptions } from "./DisplayOptions";
import { SaveViewDialog } from "./SaveView";
import { CreateIssueDialog } from "./CreateIssue";
import { SettingsDialog } from "./SettingsDialog";
import { ACTIONS, reviewText, runAction, type ActionId } from "./actions";
import { isEpic, isPermanent, stripPermanent } from "../lib/projects";
import { useApp, useCtx, useIssueMap, useSettings, useStatusFractions, useTargets, useUi } from "./context";

export function Overlays() {
  const overlay = useUi((s) => s.overlay);
  if (!overlay) return null;
  if (overlay.kind === "help") return <Help />;
  if (overlay.kind === "settings") return <SettingsDialog />;
  if (overlay.kind === "palette") return <Palette />;
  if (overlay.kind === "context") return <ContextMenu x={overlay.x} y={overlay.y} />;
  if (overlay.kind === "filter") return <FilterMenu field={overlay.field} />;
  if (overlay.kind === "relation") return <RelationPicker relation={overlay.relation} issueKey={overlay.key} />;
  if (overlay.kind === "display") return <DisplayOptions />;
  if (overlay.kind === "saveView") return <SaveViewDialog />;
  if (overlay.kind === "picker" && overlay.picker === "status") return <StatusPicker />;
  if (overlay.kind === "picker" && overlay.picker === "assignee") return <AssigneePicker />;
  if (overlay.kind === "picker" && overlay.picker === "priority") return <PriorityPicker />;
  if (overlay.kind === "picker" && overlay.picker === "labels") return <LabelsPicker />;
  if (overlay.kind === "picker" && overlay.picker === "epic") return <ProjectPicker />;
  if (overlay.kind === "picker" && overlay.picker === "duedate") return <DueDatePicker />;
  if (overlay.kind === "create") return <CreateIssueDialog defaults={overlay.defaults} />;
  if (overlay.kind === "createProject") return <CreateProjectDialog />;
  if (overlay.kind === "rename") return <RenameDialog targetKey={overlay.targetKey} />;
  return null;
}

function RenameDialog({ targetKey }: { targetKey: string }) {
  const { app, ui } = useCtx();
  const issues = useIssueMap();
  const issue = issues[targetKey];
  const permanent = !!issue && isPermanent(issue.summary);
  const [name, setName] = useState(issue ? stripPermanent(issue.summary) : "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  if (!issue) return null;
  const submit = () => {
    const next = name.trim();
    ui.getState().closeOverlay();
    if (!next || next === stripPermanent(issue.summary)) return;
    void app.getState().mutate({ op: "setSummary", key: targetKey, summary: permanent ? `[PERMANENT] ${next}` : next });
  };
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && ui.getState().closeOverlay()}>
      <form role="dialog" aria-modal="true" aria-label="Rename" className="dialog form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label>Name<input ref={input} aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => ui.getState().closeOverlay()}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>Save</button>
        </div>
      </form>
    </div>
  );
}

function CreateProjectDialog() {
  const { app, ui } = useCtx();
  const [f, setF] = useState({ name: "", description: "", target: "", labels: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const valid = f.name.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    const labels = f.labels.split(",").map((l) => l.trim()).filter(Boolean);
    ui.getState().closeOverlay();
    void app.getState().mutate({
      op: "createIssue", issuetype: "Epic", summary: f.name.trim(),
      ...(f.description.trim() ? { markdown: f.description } : {}),
      ...(labels.length ? { labels } : {}),
      ...(f.target ? { duedate: f.target } : {}),
    });
  };
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && ui.getState().closeOverlay()}>
      <form
        role="dialog" aria-modal="true" aria-label="Create project" className="dialog form"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
      >
        <label>Name<input ref={input} aria-label="Name" value={f.name} onChange={set("name")} /></label>
        <label>Description<textarea aria-label="Description" rows={4} value={f.description} onChange={set("description")} /></label>
        <div className="form-row">
          <label>Target date<input type="date" aria-label="Target date" value={f.target} onChange={set("target")} /></label>
          <label>Labels<input aria-label="Labels" placeholder="CA:frontend" value={f.labels} onChange={set("labels")} /></label>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => ui.getState().closeOverlay()}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!valid}>Create project</button>
        </div>
      </form>
    </div>
  );
}

const VIEW_COMMANDS: Array<{ id: string; label: string; view: View }> = [
  { id: "view:mine", label: "Go to My issues", view: "mine" },
  { id: "view:active", label: "Go to Active issues", view: "active" },
  { id: "view:backlog", label: "Go to Backlog", view: "backlog" },
  { id: "view:review", label: "Go to For review", view: "review" },
  { id: "view:all", label: "Go to All issues", view: "all" },
  { id: "view:projects", label: "Go to Projects", view: "projects" },
];

function Palette() {
  const ctx = useCtx();
  const { ui } = ctx;
  const issues = useIssueMap();
  const targets = useTargets();
  const fractions = useStatusFractions();
  const settings = useSettings((s) => s);
  const onlyProjects = targets.length > 0 && targets.every((k) => issues[k] && isEpic(issues[k]));
  const allMarked = targets.length > 0 && targets.every((k) => ctx.review[k]);
  const actionItems = useMemo<PickItem[]>(
    () => ACTIONS
      .filter((a) => !(onlyProjects && (a.id === "project" || a.id.startsWith("rel"))) && !(targets.length > 1 && (a.id === "rename" || a.id === "open" || a.id.startsWith("rel"))))
      .map((a) => ({ id: `act:${a.id}`, label: a.id === "review" ? reviewText(allMarked, "palette") : a.palette, kbd: a.keys })),
    [targets.length, onlyProjects, allMarked],
  );
  const commands = useMemo<PickItem[]>(() => [
    ...VIEW_COMMANDS.map((c) => ({ id: c.id, label: c.label })),
    { id: "cmd:create", label: "Create issue", kbd: "C" },
    { id: "cmd:create-project", label: "Create project" },
    { id: "cmd:help", label: "Keyboard shortcuts", kbd: "?" },
    { id: "cmd:settings", label: "Settings…" },
    { id: "cmd:sidebar", label: "Toggle sidebar", kbd: "⌘ ." },
    { id: "cmd:filter", label: "Filter…", kbd: "F" },
    { id: "cmd:display", label: "Display options…", kbd: "⇧ V" },
    { id: "layout:list", label: "Layout: List" },
    { id: "layout:board", label: "Layout: Board", kbd: "⌘ B" },
    { id: "cmd:saveview", label: "Save view…" },
    ...(ctx.ui.getState().activeSavedView ? [{ id: "cmd:updateview", label: "Update view" }] : []),
    ...settings.savedViews.map((v) => ({ id: `delview:${v.id}`, label: `Delete view: ${v.name}` })),
    { id: "set:theme:system", label: "Theme: System" },
    { id: "set:theme:light", label: "Theme: Light" },
    { id: "set:theme:dark", label: "Theme: Dark" },
    { id: "set:contrast:normal", label: "Contrast: Normal" },
    { id: "set:contrast:high", label: "Contrast: High" },
    { id: "set:density:comfortable", label: "Density: Comfortable" },
    { id: "set:density:compact", label: "Density: Compact" },
  ], [settings.savedViews]); // eslint-disable-line react-hooks/exhaustive-deps
  const projectItems = useMemo<PickItem[]>(
    () => Object.values(issues).filter(isEpic).map((e) => ({ id: `project:${e.key}`, label: stripPermanent(e.summary), hint: e.key, icon: <StatusIcon category={e.statusCategory} status={e.status} fraction={fractions.projects[e.status]} />, search: `${e.key} ${stripPermanent(e.summary)}` })),
    [issues, fractions],
  );
  const issueItems = useMemo<PickItem[]>(
    () => Object.values(issues).filter((i) => !isEpic(i)).map((i) => ({ id: `issue:${i.key}`, label: i.summary, hint: i.key, icon: <StatusIcon category={i.statusCategory} status={i.status} fraction={fractions.tickets[i.status]} />, search: `${i.key} ${i.summary}` })),
    [issues, fractions],
  );
  const pick = (id: string) => {
    const s = ui.getState();
    if (id.startsWith("act:")) runAction(ctx, id.slice(4) as ActionId);
    else if (id.startsWith("view:")) {
      s.setView(VIEW_COMMANDS.find((c) => c.id === id)!.view);
      s.closeOverlay();
    } else if (id === "cmd:create") s.openCreate();
    else if (id === "cmd:create-project") s.openOverlay("createProject");
    else if (id.startsWith("project:")) {
      s.closeOverlay();
      s.setView(id as `project:${string}`);
    } else if (id === "cmd:help") s.openOverlay("help");
    else if (id === "cmd:settings") s.openOverlay("settings");
    else if (id === "cmd:filter") s.openFilter();
    else if (id === "cmd:display") s.openOverlay("display");
    else if (id === "cmd:saveview") s.openOverlay("saveView");
    else if (id === "cmd:updateview") {
      const view = s.view;
      if (s.activeSavedView) ctx.settings.getState().updateView(s.activeSavedView, s.filters(), ctx.settings.getState().resolveDisplay(view));
      s.closeOverlay();
    } else if (id.startsWith("delview:")) {
      ctx.settings.getState().deleteView(id.slice(8));
      s.closeOverlay();
    } else if (id.startsWith("layout:")) {
      ctx.settings.getState().setDisplay(s.view, { layout: id.slice(7) as "list" | "board" });
      s.closeOverlay();
    } else if (id === "cmd:sidebar") {
      s.closeOverlay();
      ctx.settings.getState().toggleSidebar();
    } else if (id.startsWith("set:")) {
      const [, key, value] = id.split(":");
      s.closeOverlay();
      ctx.settings.getState().set({ [key]: value } as never);
    } else if (id.startsWith("issue:")) {
      s.closeOverlay();
      s.openIssue(id.slice(6));
    }
  };
  const heading = targets.length === 1 ? `Actions for ${targets[0]}` : `Actions for ${targets.length} issues`;
  return (
    <PickerDialog
      title="Command palette" placeholder="Search issues or run a command…"
      groups={[
        ...(targets.length ? [{ heading, items: actionItems }] : []),
        { heading: "Commands", items: commands },
        { heading: "Projects", items: projectItems },
        { heading: "Issues", items: issueItems },
      ]}
      onClose={() => ui.getState().closeOverlay()} onPick={pick}
    />
  );
}

function Help() {
  const { ui } = useCtx();
  const groups = ["Navigate", "Select", "Issue", "General"] as const;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && ui.getState().closeOverlay()}>
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="dialog dialog-help">
        {groups.map((g) => (
          <section key={g}>
            <h3>{g}</h3>
            <dl>
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <div key={s.keys} className="sc"><dt>{s.label}</dt><dd><kbd>{s.keys}</kbd></dd></div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

export { useApp };
