import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink, Flag, Link2, Pencil, Plus } from "lucide-react";
import type { ActivityEntry, Issue } from "@shared/types";
import { timeline } from "../lib/activity";
import { adfToMarkdown, isEditable } from "../lib/adfMarkdown";
import { Adf } from "../adf/render";
import { childrenOf, isEpic, projectStats, relKind, stripPermanent, type RelKind } from "../lib/projects";
import { dueState } from "../lib/rowdetails";
import { timeAgo } from "../lib/time";
import { blockState } from "../lib/relations";
import { subtaskType, typeClass } from "../lib/vocab";
import { ShowSidebar } from "./Chrome";
import { Avatar, PriorityIcon, StatusIcon } from "./icons";
import { JiraKey } from "./JiraKey";
import { PropRow } from "./PropRow";
import { RefTable, type RefRow } from "./RefTable";
import { useApp, useCtx, useDefaultPoints, useIssueMap, useOrder, useStatusFractions, useUi } from "./context";
import { site } from "../lib/site";

const VIEW_LABELS: Record<string, string> = { mine: "My issues", active: "Active", backlog: "Backlog", all: "All issues", projects: "Projects" };
const RELATION_LABEL: Record<RelKind, string> = { blockedBy: "Blocked by", blocks: "Blocking", relates: "Related" };

export function IssuePage() {
  const { ui, app, jiraUrl, openExternal, copyText, fetchFn, review, setReview } = useCtx();
  const defaultPoints = useDefaultPoints();
  const key = useUi((s) => s.selectedKey);
  const view = useUi((s) => s.view);
  const issues = useIssueMap();
  const fractions = useStatusFractions();
  const order = useOrder();
  const comments = useApp((s) => (key ? s.comments[key] : undefined));
  const issue = key ? issues[key] : undefined;
  const all = useMemo(() => Object.values(issues), [issues]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const updated = issue?.updated;
  useEffect(() => {
    if (!key || key.startsWith("NEW-")) return;
    let alive = true;
    setActivity([]);
    fetchFn(`/api/issues/${key}/activity`).then((r) => (r.ok ? r.json() : [])).then((a) => alive && setActivity(a)).catch(() => {});
    return () => { alive = false; };
  }, [key, updated, fetchFn]);
  if (!issue || isEpic(issue)) return null;

  const idx = order.indexOf(issue.key);
  const viewLabel = view.startsWith("project:") ? stripPermanent(issues[view.slice(8)]?.summary ?? view.slice(8)) : VIEW_LABELS[view] ?? "Issues";
  const back = () => ui.getState().closeDetail();
  const go = (delta: number) => ui.getState().move(order, delta);
  const now = new Date();
  const due = dueState(issue.duedate, issue.statusCategory === "done", now);
  const project = issue.parentKey && issues[issue.parentKey] && isEpic(issues[issue.parentKey]) ? issues[issue.parentKey] : null;
  const parent = issue.parentKey && issues[issue.parentKey] && !isEpic(issues[issue.parentKey]) ? issues[issue.parentKey] : null;
  const pick = (picker: "status" | "assignee" | "priority" | "labels" | "epic" | "duedate") => ui.getState().openPicker(picker, issue.key);
  const type = typeClass(issue.issuetype);
  const subs = childrenOf(all, issue.key).length ? all.filter((i) => i.parentKey === issue.key && !isEpic(i)) : [];
  const subDone = subs.filter((s) => s.statusCategory === "done").length;

  const relations = (["blockedBy", "blocks", "relates"] as RelKind[]).map((kind) => ({
    kind,
    rows: issue.links.filter((l) => relKind(l) === kind).map((l): RefRow | null => (issues[l.key] ? { issue: issues[l.key], linkId: l.id } : null)).filter((r): r is RefRow => !!r),
  })).filter((r) => r.rows.length);
  const removeRelation = (row: RefRow) => { if (row.linkId) void app.getState().mutate({ op: "unlink", key: issue.key, linkId: row.linkId, otherKey: row.issue.key }); };

  return (
    <div className="issue-page">
      <header className="viewhead issue-head">
        <ShowSidebar />
        <button type="button" className="icon-btn" aria-label="Back" title="Back  Esc" onClick={back}><ArrowLeft size={16} /></button>
        <nav aria-label="Breadcrumb" className="crumb-trail">
          <button type="button" onClick={back}>{site.name}</button>
          <span className="sep" aria-hidden="true">›</span>
          <button type="button" onClick={back}>{viewLabel}</button>
          <span className="sep" aria-hidden="true">›</span>
          {project && view !== `project:${project.key}` && (
            <>
              <button type="button" onClick={() => ui.getState().setView(`project:${project.key}`)}>{stripPermanent(project.summary)}</button>
              <span className="sep" aria-hidden="true">›</span>
            </>
          )}
          <span className="crumb-here"><JiraKey issueKey={issue.key} current /></span>
        </nav>
        <div className="viewtools">
          {idx >= 0 && <span className="muted pager">{idx + 1} of {order.length}</span>}
          <button type="button" className="icon-btn" aria-label="Previous issue" title="Previous  K" disabled={idx <= 0} onClick={() => go(-1)}><ChevronUp size={16} /></button>
          <button type="button" className="icon-btn" aria-label="Next issue" title="Next  J" disabled={idx < 0 || idx >= order.length - 1} onClick={() => go(1)}><ChevronDown size={16} /></button>
          <button type="button" className="icon-btn" aria-label="Copy link" title="Copy link  Y" onClick={() => { void copyText(`${jiraUrl}/browse/${issue.key}`); app.getState().notify("Link copied"); }}><Link2 size={15} /></button>
          <button type="button" className="icon-btn" aria-label="Open in Jira" title="Open in Jira  O" onClick={() => openExternal(`${jiraUrl}/browse/${issue.key}`)}><ExternalLink size={15} /></button>
        </div>
      </header>
      <div role="region" aria-label="Issue detail" className="issue-body">
        <div className="issue-main">
          <Title issue={issue} />
          <Description issue={issue} />
          {!parent && (
            <section role="region" aria-label="Sub-issues" className="issue-section">
              <div className="side-head-row">
                <h2>Sub-issues {subs.length > 0 && <span className="count">{subDone}/{subs.length}</span>}</h2>
                <AddSubIssue parentKey={issue.key} />
              </div>
              {subs.length > 0 && <RefTable label="Sub-issues" rows={subs.map((i) => ({ issue: i }))} />}
            </section>
          )}
          <section role="region" aria-label="Relations" className="issue-section">
            <div className="side-head-row"><h2>Relations</h2><AddRelation issueKey={issue.key} /></div>
            {relations.length === 0 && <p className="muted side-empty">No relations yet.</p>}
            {relations.map((r) => (
              <div key={r.kind} className="rel-group">
                <h3>{RELATION_LABEL[r.kind]}<span className="count">{r.rows.length}</span></h3>
                <RefTable label={RELATION_LABEL[r.kind]} rows={r.rows} onRemove={removeRelation} />
              </div>
            ))}
          </section>
          <section role="region" aria-label="Activity" className="issue-section">
            <h2>Activity</h2>
            <ol className="timeline">
              {timeline(issue, comments ?? [], activity).map((item) => (
                <li key={item.id} className={`tl-${item.kind}`}>
                  {item.kind === "comment" ? (
                    <article className="comment">
                      <header><Avatar name={item.comment.author?.name ?? null} /><strong>{item.comment.author?.name ?? "Unknown"}</strong><time>{timeAgo(item.comment.created)}</time></header>
                      <Adf doc={item.comment.bodyAdf} />
                    </article>
                  ) : (
                    <div className="event">
                      <span className="event-dot" aria-hidden="true" />
                      <span><strong>{item.who}</strong> {item.kind === "created" ? "created this issue" : item.text}</span>
                      <time>{timeAgo(item.at)}</time>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <Composer issueKey={issue.key} />
          </section>
        </div>
        <aside aria-label="Issue properties" className="issue-side">
          <h3>Properties</h3>
          <PropRow label="Status" value={issue.status} onClick={() => pick("status")}>
            <StatusIcon category={issue.statusCategory} status={issue.status} fraction={fractions.tickets[issue.status]} block={blockState(issue, issues)} />{issue.status}
          </PropRow>
          <PropRow label="Priority" value={issue.priority ?? "none"} onClick={() => pick("priority")}>
            <PriorityIcon priority={issue.priority} />{issue.priority ?? "No priority"}
          </PropRow>
          <PropRow label="Assignee" value={issue.assignee?.name ?? "Unassigned"} onClick={() => pick("assignee")}>
            <Avatar name={issue.assignee?.name ?? null} />{issue.assignee?.name ?? "Unassigned"}
          </PropRow>
          <PropRow label="Type" value={type} onClick={() => pick("labels")}>
            <span className={`chip chip-type chip-${type.toLowerCase()}`}><i className="dot" />{type}</span>
          </PropRow>
          <PropRow label="Labels" value={issue.labels.join(", ") || "none"} onClick={() => pick("labels")}>
            {issue.labels.length ? issue.labels.map((l) => <span key={l} className="chip">{l}</span>) : <span className="muted">Add labels</span>}
          </PropRow>
          {project ? (
            <ProjectRow project={project} all={all} defaultPoints={defaultPoints} now={now} onPick={() => pick("epic")} />
          ) : (
            <PropRow label="Project" value="none" onClick={() => pick("epic")}><span className="muted">Add to project</span></PropRow>
          )}
          <PropRow label="Due date" value={due?.text ?? "none"} onClick={() => pick("duedate")}>
            {due ? <span data-overdue={due.overdue}>{due.text}</span> : <span className="muted">Set due date</span>}
          </PropRow>
          <div className="side-row is-static" aria-label={`Estimate: ${issue.storyPoints === null ? "none" : `${issue.storyPoints} points`}`}>
            <span className="side-row-label">Estimate</span>
            <span className="side-row-value">{issue.storyPoints === null ? <span className="muted">No estimate, counts as {defaultPoints}</span> : `${issue.storyPoints} points`}</span>
          </div>
          <PropRow label="Team review" value={!!review[issue.key] ? "marked" : "not marked"} onClick={() => setReview([issue.key], !review[issue.key])}>
            {review[issue.key] ? <span className="chip chip-review"><Flag size={11} />Marked for review</span> : <span className="muted">Mark for review</span>}
          </PropRow>
          {parent && (
            <PropRow label="Parent issue" value={parent.key} onClick={() => ui.getState().openIssue(parent.key)}>
              <span className="row-key">{parent.key}</span>{parent.summary}
            </PropRow>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Project row of the ticket sidebar: always one line, link plus edit button, details on hover or focus. */
function ProjectRow({ project, all, defaultPoints, now, onPick }: { project: Issue; all: Issue[]; defaultPoints: number; now: Date; onPick: () => void }) {
  const { ui } = useCtx();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const stats = projectStats(all, project, now, { defaultPoints });
  const due = dueState(stats.targetDate, project.statusCategory === "done", now);
  return (
    <div className="side-row side-row-split">
      <span className="side-row-label">Project</span>
      <span className="side-row-value proj-value" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        <a
          className="proj-link" href="#" aria-describedby={open ? "project-tip" : undefined}
          onClick={(e) => { e.preventDefault(); ui.getState().setView(`project:${project.key}`); }}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        >{stripPermanent(project.summary)}</a>
        <button type="button" className="icon-btn" aria-label="Change project" title="Change project" onClick={onPick}><Pencil size={12} /></button>
        {open && (
          <span id="project-tip" role="tooltip" className="info-tip proj-tip">
            <strong>{stripPermanent(project.summary)}</strong>
            <span>{stats.status}{stats.ongoing ? " · Ongoing" : ""}</span>
            <span>Lead: {stats.lead?.name ?? "none"}</span>
            <span>Target: {due ? due.text : "none"}</span>
            <span>{stats.pct}% complete · {stats.done} of {stats.total} tickets done</span>
            {stats.quarter && <span>{stats.quarter}</span>}
          </span>
        )}
      </span>
    </div>
  );
}

function AddRelation({ issueKey }: { issueKey: string }) {
  const { ui } = useCtx();
  const [open, setOpen] = useState(false);
  const choose = (kind: "blockedBy" | "blocks" | "relates") => { setOpen(false); ui.getState().openRelation(kind, issueKey); };
  return (
    <span className="add-relation">
      <button type="button" className="icon-btn" aria-label="Add relation" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Plus size={14} /></button>
      {open && (
        <div role="menu" aria-label="Add relation" className="menu inline-menu" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
          <button type="button" role="menuitem" className="menu-item" autoFocus onClick={() => choose("blockedBy")}>Blocked by…</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => choose("blocks")}>Blocking…</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => choose("relates")}>Related to…</button>
        </div>
      )}
    </span>
  );
}

function Description({ issue }: { issue: Issue }) {
  const { app, jiraUrl, openExternal } = useCtx();
  const markdown = adfToMarkdown(issue.descriptionAdf);
  const editable = isEditable(issue.descriptionAdf);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(markdown);
  useEffect(() => { setEditing(false); }, [issue.key]);
  const start = () => { setText(markdown); setEditing(true); };
  const save = () => {
    setEditing(false);
    if (text.trim() !== markdown.trim()) void app.getState().mutate({ op: "setDescription", key: issue.key, markdown: text });
  };
  if (editing) {
    return (
      <div className="issue-desc editing">
        <textarea
          className="desc-editor" aria-label="Description" autoFocus rows={10} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
            if (e.key === "Escape") { e.stopPropagation(); setEditing(false); }
          }}
        />
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className="btn btn-primary" aria-label="Save description" onClick={save}>Save</button>
        </div>
      </div>
    );
  }
  if (!issue.descriptionAdf) {
    return <button type="button" className="issue-desc add-desc" onClick={start}>Add description</button>;
  }
  return (
    <div className="issue-desc-wrap">
      <div
        className={`issue-desc${editable ? " is-editable" : ""}`} title={editable ? "Click to edit" : undefined}
        onClick={(e) => { if (editable && !(e.target as HTMLElement).closest("a")) start(); }}
      >
        <Adf doc={issue.descriptionAdf} />
      </div>
      {!editable && (
        <p className="muted desc-note">
          This description uses formatting that can’t be edited here.{" "}
          <button type="button" className="link-btn" onClick={() => openExternal(`${jiraUrl}/browse/${issue.key}`)}>Edit in Jira</button>
        </p>
      )}
    </div>
  );
}

function AddSubIssue({ parentKey }: { parentKey: string }) {
  const { app } = useCtx();
  const issues = useIssueMap();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const submit = () => {
    const summary = title.trim();
    if (!summary) return;
    void app.getState().mutate({ op: "createIssue", summary, issuetype: subtaskType(Object.values(issues)), parentKey });
    setTitle("");
    setOpen(false);
  };
  return (
    <span className="add-sub">
      {open && (
        <input
          className="sub-input" aria-label="Sub-issue title" placeholder="Sub-issue title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submit(); }
            if (e.key === "Escape") { e.stopPropagation(); setTitle(""); setOpen(false); }
          }}
        />
      )}
      <button type="button" className="icon-btn" aria-label="Add sub-issue" onClick={() => setOpen(!open)}><Plus size={14} /></button>
    </span>
  );
}

/** Click the title to edit it; Enter saves, Escape cancels. */
function Title({ issue }: { issue: Issue }) {
  const { app } = useCtx();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(issue.summary);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setEditing(false); setText(issue.summary); }, [issue.key, issue.summary]);
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  if (!editing) {
    return <h1 className="issue-title" title="Click to edit" onClick={() => setEditing(true)}>{issue.summary}</h1>;
  }
  const save = () => {
    const next = text.trim();
    setEditing(false);
    if (next && next !== issue.summary) void app.getState().mutate({ op: "setSummary", key: issue.key, summary: next });
    else setText(issue.summary);
  };
  return (
    <input
      ref={input} className="issue-title-input" aria-label="Title" value={text} onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); input.current?.blur(); }
        if (e.key === "Escape") { e.stopPropagation(); setText(issue.summary); setEditing(false); }
      }}
    />
  );
}

function Composer({ issueKey }: { issueKey: string }) {
  const { app, ui } = useCtx();
  const wantsFocus = useUi((s) => s.overlay?.kind === "comment");
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (wantsFocus) box.current?.focus(); }, [wantsFocus]);
  const send = () => {
    const markdown = text.trim();
    if (!markdown) return;
    void app.getState().mutate({ op: "addComment", key: issueKey, markdown });
    setText("");
    box.current?.blur();
    if (ui.getState().overlay?.kind === "comment") ui.getState().closeOverlay();
  };
  return (
    <textarea
      ref={box} className="composer" aria-label="Add a comment" placeholder="Leave a comment… (⌘↵ to send)" rows={3}
      value={text} onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
    />
  );
}
