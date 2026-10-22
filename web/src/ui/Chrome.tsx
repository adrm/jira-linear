import { useEffect } from "react";
import { Settings as SettingsIcon, Box, ChevronDown, Flag, ListFilter, SlidersHorizontal, CircleDashed, CircleDot, Layers, PanelLeft, PanelLeftClose, Plus, Search, Star, UserRound, X } from "lucide-react";
import { ACTIONS, runAction } from "./actions";
import type { View } from "../store/ui";
import { useSidebarProjects, useApp, useCtx, useFilters, useIssueMap, useProjects, useSettings, useUi } from "./context";
import { site } from "../lib/site";

function NavItem({ icon, label, keys, active, onClick, trailing }: {
  icon: React.ReactNode; label: string; keys?: string; active: boolean; onClick: () => void; trailing?: React.ReactNode;
}) {
  return (
    <button type="button" className={`nav-item${active ? " is-active" : ""}`} aria-label={label} aria-keyshortcuts={keys} aria-current={active ? "page" : undefined} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-name">{label}</span>
      {trailing}
      {keys && <span className="nav-keys">{keys.split(" ").map((k) => <kbd key={k}>{k}</kbd>)}</span>}
    </button>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const folded = useSettings((s) => s.foldedSections.includes(id));
  const { settings } = useCtx();
  return (
    <div role="group" aria-label={title} className="nav-section">
      <button type="button" className="nav-section-head" aria-expanded={!folded} onClick={() => settings.getState().toggleSection(id)}>
        <span>{title}</span>
        <ChevronDown size={12} className={folded ? "is-folded" : ""} />
      </button>
      {!folded && <div className="nav-section-body">{children}</div>}
    </div>
  );
}

function ProjectRing({ pct }: { pct: number }) {
  const r = 5.5, c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="1.6" />
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--st-done)" strokeWidth="1.6" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 7 7)" strokeLinecap="round" />
    </svg>
  );
}

export function Sidebar() {
  const { ui, settings, review } = useCtx();
  const issues = useIssueMap();
  const reviewCount = Object.keys(review).filter((k) => issues[k] && issues[k].issuetype !== "Epic").length;
  const view = useUi((s) => s.view);
  const favorites = useSettings((s) => s.favorites);
  const savedViews = useSettings((s) => s.savedViews);
  const activeSaved = useUi((s) => s.activeSavedView);
  const { all: projects, active, ongoing } = useSidebarProjects();
  const favProjects = favorites.filter((f) => f.startsWith("project:")).map((f) => projects.find((p) => `project:${p.key}` === f)).filter((p): p is NonNullable<typeof p> => !!p);
  const go = (v: View) => ui.getState().setView(v);
  const icon = (n: React.ReactNode) => n;
  return (
    <nav className="sidebar" aria-label="Views">
      <div className="side-head">
        <span className="brand"><span className="brand-mark" aria-hidden="true">{site.name.charAt(0).toUpperCase()}</span>{site.name}</span>
        <span className="side-head-tools">
        <button type="button" className="icon-btn" aria-label="Settings" title="Settings" onClick={() => ui.getState().openOverlay("settings")}><SettingsIcon size={15} /></button>
        <button type="button" className="icon-btn" aria-label="Hide sidebar" title="Hide sidebar  ⌘." onClick={() => settings.getState().toggleSidebar()}><PanelLeftClose size={16} /></button>
        </span>
      </div>
      <NavItem icon={icon(<UserRound size={15} />)} label="My issues" keys="G I" active={view === "mine" || view === "created"} onClick={() => go("mine")} />
      <Section id="workspace" title="Workspace">
        <NavItem icon={<Box size={15} />} label="Projects" keys="G P" active={view === "projects"} onClick={() => go("projects")} />
      </Section>
      <Section id="team" title={site.name}>
        <NavItem icon={<CircleDot size={15} />} label="Active" keys="G A" active={view === "active"} onClick={() => go("active")} />
        <NavItem icon={<CircleDashed size={15} />} label="Backlog" keys="G B" active={view === "backlog"} onClick={() => go("backlog")} />
        <NavItem icon={<Flag size={15} />} label="For review" keys="G R" active={view === "review"} onClick={() => go("review")} trailing={reviewCount > 0 ? <span className="nav-pct">{reviewCount}</span> : undefined} />
        <NavItem icon={<Layers size={15} />} label="All issues" keys="G T" active={view === "all"} onClick={() => go("all")} />
      </Section>
      {savedViews.length > 0 && (
        <Section id="views" title="Views">
          {savedViews.map((v) => (
            <NavItem key={v.id} icon={<ListFilter size={14} />} label={v.name} active={activeSaved === v.id} onClick={() => { settings.getState().setDisplay(v.view, v.display); ui.getState().openSavedView(v); }} />
          ))}
        </Section>
      )}
      {favProjects.length > 0 && (
        <Section id="favorites" title="Favorites">
          {favProjects.map((p) => (
            <NavItem key={p.key} icon={<Star size={14} />} label={p.name} active={view === `project:${p.key}`} onClick={() => go(`project:${p.key}`)} />
          ))}
        </Section>
      )}
      {active.length > 0 && (
        <Section id="projects" title="Active projects">
          {active.map((p) => (
            <NavItem key={p.key} icon={<ProjectRing pct={p.pct} />} label={p.name} active={view === `project:${p.key}`} onClick={() => go(`project:${p.key}`)} trailing={<span className="nav-pct">{p.pct}%</span>} />
          ))}
        </Section>
      )}
      {ongoing.length > 0 && (
        <Section id="ongoing" title="Ongoing projects">
          {ongoing.map((p) => (
            <NavItem key={p.key} icon={<ProjectRing pct={p.pct} />} label={p.name} active={view === `project:${p.key}`} onClick={() => go(`project:${p.key}`)} trailing={<span className="nav-pct">{p.pct}%</span>} />
          ))}
        </Section>
      )}
    </nav>
  );
}

const TITLES: Record<string, string> = { mine: "My issues", created: "My issues", active: "Active", backlog: "Backlog", review: "For review", all: "All issues", projects: "Projects" };

export function ViewHeader({ count }: { count?: number }) {
  const { ui, settings } = useCtx();
  const view = useUi((s) => s.view);
  const search = useUi((s) => s.search);
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  const filterCount = useFilters().length;
  const projectTab = useUi((s) => s.projectTab);
  const overviewTab = view.startsWith("project:") && projectTab === "overview";
  return (
    <header className="viewhead">
      {collapsed && (
        <button type="button" className="icon-btn" aria-label="Show sidebar" title="Show sidebar  ⌘." onClick={() => settings.getState().toggleSidebar()}><PanelLeft size={16} /></button>
      )}
      {TITLES[view] && <h1 className="viewtitle">{TITLES[view]}{count !== undefined && <span className="count">{count}</span>}</h1>}
      {(view === "mine" || view === "created") && (
        <div role="tablist" aria-label="My issues" className="seg tabs-seg">
          <button role="tab" type="button" aria-selected={view === "mine"} onClick={() => ui.getState().setView("mine")}>Assigned</button>
          <button role="tab" type="button" aria-selected={view === "created"} onClick={() => ui.getState().setView("created")}>Created</button>
        </div>
      )}
      <div className="viewtools">
        {view === "projects" && (
          <button type="button" className="btn" onClick={() => ui.getState().openOverlay("createProject")}><Plus size={14} />New project</button>
        )}
        {view !== "projects" && !overviewTab && (
          <button type="button" className="btn btn-quiet hdr-btn" aria-label="Filter" title="Filter  F" onClick={() => ui.getState().openFilter()}>
            <ListFilter size={14} />Filter{filterCount > 0 && <span className="badge">{filterCount}</span>}
          </button>
        )}
        {!overviewTab && (
        <button type="button" className="btn btn-quiet hdr-btn" aria-label="Display" title="Display options  ⇧V" onClick={() => ui.getState().openOverlay("display")}>
          <SlidersHorizontal size={14} />Display
        </button>
        )}
        {!overviewTab && <label className="searchbox">
          <Search size={14} aria-hidden="true" />
          <input
            id="search-input" type="search" role="searchbox" aria-label="Search issues" placeholder="Search"
            value={search} onChange={(e) => ui.getState().setSearch(e.target.value)}
          />
          <kbd>/</kbd>
        </label>}
      </div>
    </header>
  );
}

const TOAST_MS = 6000;

function ToastItem({ id, text, entryId }: { id: string; text: string; entryId?: string }) {
  const { app } = useCtx();
  useEffect(() => {
    const t = setTimeout(() => app.getState().dismissToast(id), TOAST_MS);
    return () => clearTimeout(t);
  }, [app, id]);
  return (
    <div role="status" aria-label={text} className="toast toast-info">
      <span>{text}</span>
      {entryId && <button type="button" className="toast-btn" onClick={() => void app.getState().undo(entryId)}>Undo</button>}
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => app.getState().dismissToast(id)}><X size={14} /></button>
    </div>
  );
}

export function Toasts() {
  const failed = useApp((s) => s.failed);
  const toasts = useApp((s) => s.toasts);
  const { app } = useCtx();
  return (
    <div className="toasts">
      {toasts.map((t) => <ToastItem key={t.id} id={t.id} text={t.text} entryId={t.entryId} />)}
      {failed.map((f) => (
        <div key={f.mutation.id} role="alert" className="toast">
          <div>
            <strong>Couldn’t save that change</strong>
            <p>{f.error}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => app.getState().dismissFailed(f.mutation.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function BulkBar() {
  const ctx = useCtx();
  const selection = useUi((s) => s.selection);
  if (!selection.length) return null;
  return (
    <div role="toolbar" aria-label="Bulk actions" className="bulkbar">
      <span className="bulk-count">{selection.length} selected</span>
      {(["status", "assignee", "priority", "labels", "project", "due", "review"] as const).map((id) => {
        const a = ACTIONS.find((x) => x.id === id)!;
        return <button key={id} type="button" className="bulk-btn" onClick={() => runAction(ctx, id)}>{id === "review" ? "Review" : a.label}</button>;
      })}
      <button type="button" className="icon-btn" aria-label="Clear selection" onClick={() => ctx.ui.getState().clearSelection()}><X size={14} /></button>
    </div>
  );
}

export function StatusBar() {
  const online = useApp((s) => s.online);
  const queued = useApp((s) => s.pending.length);
  const { ui } = useCtx();
  const selected = useUi((s) => s.selectedKey);
  const hints = selected
    ? [["S", "status"], ["A", "assign"], ["X", "select"], ["⌘K", "actions"], ["Enter", "open"]]
    : [["J K", "move"], ["/", "search"], ["⌘K", "commands"]];
  return (
    <footer className="statusbar">
      <span className={`sync${online ? "" : " is-offline"}`}>
        {online ? (queued ? `Saving ${queued}…` : "Synced") : `Offline${queued ? ` · ${queued} queued` : ""}`}
      </span>
      <span className="hints">
        {hints.map(([k, l]) => <span key={k}><kbd>{k}</kbd> {l}</span>)}
        <button type="button" className="hint-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts  ? or F1" onClick={() => ui.getState().openOverlay("help")}>
          <kbd>?</kbd> help
        </button>
      </span>
    </footer>
  );
}
