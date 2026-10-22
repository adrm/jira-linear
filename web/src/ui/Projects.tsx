import { memo, useEffect, useMemo, useRef } from "react";
import { Adf } from "../adf/render";
import { childrenOf, projectRelationships, projectStats, stripPermanent, summarizeProjects, quarterList, type ProjectGroup, type ProjectStats, type RelKind } from "../lib/projects";
import { JiraKey } from "./JiraKey";
import { RefTable, type RefRow } from "./RefTable";
import { dueState } from "../lib/rowdetails";
import { Avatar, StatusIcon } from "./icons";
import { PanelRight, Star } from "lucide-react";
import { useCtx, useDefaultPoints, useIssueMap, useProjects, useProjectsDisplay, useSettings, useStatusFractions, useUi } from "./context";

function Progress({ p }: { p: ProjectStats }) {
  const active = p.total ? Math.round((p.inProgress / p.total) * 100) : 0;
  return (
    <span className="progress">
      <span className="bar" aria-hidden="true">
        <span className="bar-done" style={{ width: `${p.pct}%` }} />
        <span className="bar-active" style={{ width: `${active}%` }} />
      </span>
      <span className="pct">{p.pct}%</span>
    </span>
  );
}

const ProjectRow = memo(function ProjectRow({ p, selected, blockedBy, fraction, onSelect, onOpen }: {
  p: ProjectStats; selected: boolean; blockedBy: number; fraction?: number; onSelect: (k: string) => void; onOpen: (k: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView?.({ block: "nearest" }); }, [selected]);
  return (
    <div
      ref={ref} role="option" aria-selected={selected} data-key={p.key}
      aria-label={`${p.name}, ${p.pct}% complete`}
      className={`row prow${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(p.key)} onDoubleClick={() => onOpen(p.key)}
    >
      <StatusIcon category={p.statusCategory} status={p.status} fraction={fraction} />
      <span className="row-title">{p.name}</span>
      <span className="row-meta">
        {quarterList(p.quarter).map((q) => <span key={q} className="chip">{q}</span>)}
        {p.slipDays != null && <span className="chip chip-overdue">Slipped {p.slipDays} d</span>}
        {blockedBy > 0 && <span className="chip chip-blocked">Blocked by {blockedBy}</span>}
        {p.overdue && <span className="chip chip-overdue">Overdue</span>}
      </span>
      <span className="row-time">{p.targetDate ?? ""}</span>
      <Progress p={p} />
      <span className="lead"><Avatar name={p.lead?.name ?? null} /><span>{p.lead?.name}</span></span>
    </div>
  );
});

/** The quick check at the top of the Projects page: how many projects are in each state, how far along, and what is late. */
function ProjectsOverview({ projects }: { projects: ProjectStats[] }) {
  const s = useMemo(() => summarizeProjects(projects), [projects]);
  if (!s.groups.length) return null;
  return (
    <section role="region" aria-label="Projects overview" className="p-overview">
      <ul className="p-tiles">
      {s.groups.map((g) => (
        <li key={g.label} aria-label={g.label} className="p-tile">
          <span className="p-tile-label">{g.label}</span>
          <strong>{g.count}</strong>
          <span className="progress"><span className="bar" aria-hidden="true"><span className="bar-done" style={{ width: `${g.pct}%` }} /></span><span className="pct">{g.pct}%</span></span>
        </li>
      ))}
      <li aria-label="Overdue" className="p-tile p-tile-risk" data-hot={s.overdue > 0}><span className="p-tile-label">Overdue</span><strong>{s.overdue}</strong></li>
      <li aria-label="Slipped" className="p-tile p-tile-risk" data-hot={s.slipped > 0}><span className="p-tile-label">Slipped</span><strong>{s.slipped}</strong></li>
      </ul>
    </section>
  );
}

/** One column per group, cards with the same facts as a list row. */
function ProjectsBoard({ groups, blocked }: { groups: ProjectGroup[]; blocked: Record<string, number> }) {
  const { ui } = useCtx();
  const fractions = useStatusFractions();
  const selected = useUi((s) => s.selectedKey);
  return (
    <div role="listbox" aria-label="Projects board" className="board">
      {groups.map((g) => (
        <section key={g.label} role="group" aria-label={`${g.label}, ${g.projects.length}`} className="column">
          <div className="column-head"><span className="column-name">{g.label}</span><span className="count">{g.projects.length}</span></div>
          <div className="column-body">
            {g.projects.map((p) => (
              <ProjectCard key={p.key} p={p} selected={p.key === selected} blockedBy={blocked[p.key] ?? 0} fraction={fractions.projects[p.status]}
                onSelect={(k) => ui.getState().select(k)} onOpen={(k) => ui.getState().setView(`project:${k}`)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const ProjectCard = memo(function ProjectCard({ p, selected, blockedBy, fraction, onSelect, onOpen }: {
  p: ProjectStats; selected: boolean; blockedBy: number; fraction?: number; onSelect: (k: string) => void; onOpen: (k: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView?.({ block: "nearest" }); }, [selected]);
  return (
    <div
      ref={ref} role="option" aria-selected={selected} data-key={p.key} aria-label={`${p.name}, ${p.pct}% complete`}
      className={`card pcard${selected ? " is-selected" : ""}`} onClick={() => onSelect(p.key)} onDoubleClick={() => onOpen(p.key)}
    >
      <div className="card-top">
        <StatusIcon category={p.statusCategory} status={p.status} fraction={fraction} />
        <span className="row-key">{p.key}</span>
        <span className="card-assignee"><Avatar name={p.lead?.name ?? null} /></span>
      </div>
      <div className="card-title">{p.name}</div>
      <Progress p={p} />
      <div className="card-foot">
        {quarterList(p.quarter).map((q) => <span key={q} className="chip">{q}</span>)}
        {p.slipDays != null && <span className="chip chip-overdue">Slipped {p.slipDays} d</span>}
        {blockedBy > 0 && <span className="chip chip-blocked">Blocked by {blockedBy}</span>}
        {p.overdue && <span className="chip chip-overdue">Overdue</span>}
        {p.targetDate && <span className="due">{p.targetDate}</span>}
      </div>
    </div>
  );
});

export function ProjectsList() {
  const { groups, total, shown } = useProjects();
  const issues = useIssueMap();
  const fractions = useStatusFractions();
  const { ui } = useCtx();
  const display = useProjectsDisplay();
  const selected = useUi((s) => s.selectedKey);
  const blocked = useMemo(() => {
    const all = Object.values(issues);
    const out: Record<string, number> = {};
    for (const g of groups) for (const p of g.projects) {
      out[p.key] = projectRelationships(all, p.key).derived.filter((d) => d.kind === "blockedBy").reduce((n, d) => n + d.count, 0);
    }
    return out;
  }, [issues, groups]);

  return (
    <>
      <ProjectsOverview projects={shown} />
      {total === 0 ? (
        <div className="empty" role="status"><p>No projects yet. Create one to group related tickets.</p></div>
      ) : display.layout === "board" ? (
        <ProjectsBoard groups={groups} blocked={blocked} />
      ) : (
        <div role="listbox" aria-label="Projects" className="list">
          {groups.map((g) => (
            <section key={g.label} role="group" aria-label={`${g.label}, ${g.projects.length}`} className="group">
              {g.label && (
                <header className="group-head">
                  {display.groupBy === "lead" && <Avatar name={g.label === "No lead" ? null : g.label} />}
                  <span>{g.label}</span><span className="count">{g.projects.length}</span>
                </header>
              )}
              {g.projects.map((p) => (
                <ProjectRow
                  key={p.key} p={p} selected={p.key === selected} blockedBy={blocked[p.key] ?? 0} fraction={fractions.projects[p.status]}
                  onSelect={(k) => ui.getState().select(k)}
                  onOpen={(k) => ui.getState().setView(`project:${k}`)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

const KIND_LABEL: Record<RelKind, string> = { blockedBy: "Blocked by", blocks: "Blocks", relates: "Related" };

export function ProjectPage({ projectKey }: { projectKey: string }) {
  const issues = useIssueMap();
  const { ui, settings } = useCtx();
  const epic = issues[projectKey];
  const all = useMemo(() => Object.values(issues), [issues]);
  const rel = useMemo(() => projectRelationships(all, projectKey), [all, projectKey]);
  const fractions = useStatusFractions();
  const favorite = useSettings((s) => s.favorites.includes(`project:${projectKey}`));
  const sideOpen = useSettings((s) => s.projectSidebarOpen);
  const defaultPoints = useDefaultPoints();
  const tab = useUi((s) => s.projectTab);
  if (!epic) return <div className="empty" role="status"><p>This project no longer exists.</p></div>;
  const p = projectStats(all, epic, new Date(), { defaultPoints });
  const due = dueState(p.targetDate, p.statusCategory === "done", new Date());
  const open = (picker: "status" | "assignee" | "duedate" | "labels") => ui.getState().openPicker(picker, projectKey);

  const OURS_HEADER: Record<RelKind, string> = { blockedBy: "Blocking", blocks: "Blocked by", relates: "Related to" };
  const sections = (["blockedBy", "blocks", "relates"] as RelKind[]).map((kind) => {
    // one row per linked ticket, remembering which of this project's tickets it touches
    const byTicket = new Map<string, RefRow>();
    for (const d of rel.derived.filter((x) => x.kind === kind)) {
      for (const pair of d.pairs) {
        const ext = issues[pair.to];
        if (!ext) continue;
        const row = byTicket.get(ext.key) ?? { issue: ext, ours: [] };
        if (issues[pair.from] && !row.ours!.some((o) => o.key === pair.from)) row.ours!.push(issues[pair.from]);
        byTicket.set(ext.key, row);
      }
    }
    const direct = rel.direct.filter((d) => d.kind === kind);
    return { kind, rows: [...byTicket.values()], direct };
  }).filter((s) => s.rows.length || s.direct.length);

  const go = (key: string | null) => key && ui.getState().setView(`project:${key}`);

  return (
    <section role="region" aria-label={`Project ${p.name}`} className="project-page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <button type="button" className="link-btn" onClick={() => ui.getState().setView("projects")}>Projects</button>
        <span className="muted">/</span>
      </nav>
      <div className="project-title">
        <StatusIcon category={p.statusCategory} status={p.status} fraction={fractions.projects[p.status]} />
        <JiraKey issueKey={projectKey} />
        <h2>{p.name}</h2>
        {p.ongoing && <span className="chip">Ongoing</span>}
        <span className="project-title-actions">
          <button
            type="button" className="icon-btn" aria-pressed={sideOpen} title="Project details  ⌘I"
            aria-label={sideOpen ? "Hide project details" : "Show project details"}
            onClick={() => settings.getState().toggleProjectSidebar()}
          ><PanelRight size={15} /></button>
          <button
            type="button" className={`icon-btn${favorite ? " is-on" : ""}`} aria-pressed={favorite}
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
            onClick={() => settings.getState().toggleFavorite(`project:${projectKey}`)}
          ><Star size={15} fill={favorite ? "currentColor" : "none"} /></button>
          <button type="button" className="btn btn-quiet" onClick={() => ui.getState().openRename(projectKey)}>Rename</button>
        </span>
      </div>
      <div role="tablist" aria-label="Project sections" className="tabs project-tabs">
        <button role="tab" type="button" aria-selected={tab === "overview"} onClick={() => ui.getState().setProjectTab("overview")}>Overview</button>
        <button role="tab" type="button" aria-selected={tab === "issues"} onClick={() => ui.getState().setProjectTab("issues")}>
          Issues <span className="count">{childrenOf(all, projectKey).length}</span>
        </button>
      </div>
      {/* Linear shows these in the details sidebar; they only appear inline when that sidebar is hidden */}
      {tab === "overview" && !sideOpen && (
        <>
      <div className="project-props">
        <button type="button" className="prop-btn" aria-label={`Status: ${p.status}`} onClick={() => open("status")}><StatusIcon category={p.statusCategory} status={p.status} fraction={fractions.projects[p.status]} /><span>{p.status}</span></button>
        <button type="button" className="prop-btn" aria-label={`Lead: ${p.lead?.name ?? "none"}`} onClick={() => open("assignee")}><Avatar name={p.lead?.name ?? null} /><span>{p.lead?.name ?? "No lead"}</span></button>
        <button type="button" className="prop-btn" aria-label={`Target date: ${due?.text ?? "none"}`} onClick={() => open("duedate")}>
          <span>{due?.text ?? "No target date"}</span>{p.overdue && <span className="chip chip-overdue">Overdue</span>}
        </button>
        {quarterList(p.quarter).map((q) => <span key={q} className="prop-btn is-static"><span className="chip">{q}</span></span>)}
        {p.slipDays != null && <span className="prop-btn is-static"><span className="chip chip-overdue">Slipped {p.slipDays} d</span></span>}
        <button type="button" className="prop-btn" aria-label="Labels" onClick={() => open("labels")}>
          {p.labels.length ? p.labels.map((l) => <span key={l} className="chip">{l}</span>) : <span className="muted">No labels</span>}
        </button>
      </div>
      <div className="project-progress">
        <Progress p={p} />
        <span className="muted">{p.done} of {p.total} tickets done</span>
        {p.inProgress > 0 && <span className="muted">{p.inProgress} in progress</span>}
      </div>
        </>
      )}
      {tab === "overview" && epic.descriptionAdf ? (
        <div className="project-desc-wrap">
          <div className="project-desc"><Adf doc={epic.descriptionAdf} /></div>
        </div>
      ) : null}
      {tab === "overview" && sections.length > 0 && (
        <section role="region" aria-label="Relationships" className="relationships">
          {sections.map((s) => (
            <div key={s.kind} className="rel-group">
              <h3>{KIND_LABEL[s.kind]}<span className="count">{s.rows.length || s.direct.length}</span></h3>
              {s.rows.length > 0 && <RefTable label={KIND_LABEL[s.kind]} rows={s.rows} oursHeader={OURS_HEADER[s.kind]} />}
              {s.direct.length > 0 && (
                <ul className="rel-direct">
                  {s.direct.map((d) => (
                    <li key={`d${d.key}`}>
                      <button type="button" className="rel-btn" onClick={() => go(d.key)}>
                        <span className="rel-name">{d.name}</span><span className="muted">linked project</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}
    </section>
  );
}

export { stripPermanent };
