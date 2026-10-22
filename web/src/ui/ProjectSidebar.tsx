import { useEffect, useMemo, useState } from "react";
import { Info, Plus } from "lucide-react";
import type { Issue, ResourceLink, TicketHistory } from "@shared/types";
import { childrenOf, projectStats, quarterList, stripPermanent } from "../lib/projects";
import { buildGraph, forecast, progressBy, type Graph as GraphData } from "../lib/projectGraph";
import { dueState } from "../lib/rowdetails";
import { timeAgo } from "../lib/time";
import { Avatar, PriorityIcon, StatusIcon } from "./icons";
import { PropRow } from "./PropRow";
import { useCtx, useDefaultPoints, useIssueMap, useSettings, useStatusFractions } from "./context";
import { site } from "../lib/site";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (ms: number) => { const d = new Date(ms); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };

export function ProjectSidebar({ projectKey }: { projectKey: string }) {
  const { ui } = useCtx();
  const open = useSettings((s) => s.projectSidebarOpen);
  const issues = useIssueMap();
  const fractions = useStatusFractions();
  const epic = issues[projectKey];
  const all = useMemo(() => Object.values(issues), [issues]);
  const kids = useMemo(() => childrenOf(all, projectKey), [all, projectKey]);
  const now = useMemo(() => new Date(), [issues]); // eslint-disable-line react-hooks/exhaustive-deps
  const defaultPoints = useDefaultPoints();
  if (!epic || !open) return null;

  const stats = projectStats(all, epic, now, { defaultPoints });
  const members = [...new Map([epic.assignee, ...kids.map((k) => k.assignee)].filter((u): u is NonNullable<typeof u> => !!u).map((u) => [u.id, u])).values()];
  const due = dueState(stats.targetDate, epic.statusCategory === "done", now);
  const pick = (picker: "status" | "priority" | "assignee" | "duedate" | "labels") => ui.getState().openPicker(picker, projectKey);

  return (
    <aside role="complementary" aria-label="Project details" className="project-side">
      <section aria-label="Properties" className="side-section">
        <h3>Properties</h3>
        <PropRow label="Status" value={epic.status} onClick={() => pick("status")}>
          <StatusIcon category={epic.statusCategory} status={epic.status} fraction={fractions.projects[epic.status]} />{epic.status}
        </PropRow>
        <PropRow label="Priority" value={epic.priority ?? "none"} onClick={() => pick("priority")}>
          <PriorityIcon priority={epic.priority} />{epic.priority ?? "No priority"}
        </PropRow>
        <PropRow label="Lead" value={epic.assignee?.name ?? "none"} onClick={() => pick("assignee")}>
          <Avatar name={epic.assignee?.name ?? null} />{epic.assignee?.name ?? "No lead"}
        </PropRow>
        <div className="side-row is-static">
          <span className="side-row-label">Members</span>
          <ul className="side-row-value members" aria-label="Members">
            {members.length ? members.map((m) => <li key={m.id} title={m.name}><Avatar name={m.name} /><span>{m.name}</span></li>) : <li className="muted">No members yet</li>}
          </ul>
        </div>
        <PropRow label="Target date" value={due?.text ?? "none"} onClick={() => pick("duedate")}>
          {due ? <span data-overdue={due.overdue}>{due.text}</span> : <span className="muted">Set target date</span>}
          {due?.overdue && <span className="chip chip-overdue">Overdue</span>}
          {stats.targetSource === "revised" && <span className="muted">from revised date</span>}
          {stats.targetSource === "initial" && <span className="muted">from initial estimate</span>}
        </PropRow>
        <div className="side-row is-static">
          <span className="side-row-label">Quarter</span>
          <span className="side-row-value">{quarterList(stats.quarter).length ? quarterList(stats.quarter).map((q) => <span key={q} className="chip">{q}</span>) : <span className="muted">No quarter</span>}</span>
        </div>
        <div className="side-row is-static">
          <span className="side-row-label">Initial estimate</span>
          <span className="side-row-value">{stats.initialEstimate ?? <span className="muted">Not set</span>}</span>
        </div>
        <div className="side-row is-static">
          <span className="side-row-label">Revised date</span>
          <span className="side-row-value">
            {stats.revisedEstimate ?? <span className="muted">Not revised</span>}
            {stats.slipDays != null && <span className="chip chip-overdue">Slipped {stats.slipDays} d</span>}
          </span>
        </div>
        {epic.statusChanged && (
          <div className="side-row is-static">
            <span className="side-row-label">In status since</span>
            <span className="side-row-value">{timeAgo(epic.statusChanged, now)}</span>
          </div>
        )}
        <div className="side-row is-static">
          <span className="side-row-label">Team</span>
          <span className="side-row-value">{site.name}</span>
        </div>
        <PropRow label="Labels" value={epic.labels.join(", ") || "none"} onClick={() => pick("labels")}>
          {epic.labels.length ? epic.labels.map((l) => <span key={l} className="chip">{l}</span>) : <span className="muted">Add labels</span>}
        </PropRow>
      </section>
      <Resources projectKey={projectKey} />
      <Progress projectKey={projectKey} epic={epic} kids={kids} pct={stats} now={now} />
    </aside>
  );
}

// ------------------------------------------------------------------ resources
function Resources({ projectKey }: { projectKey: string }) {
  const { app, fetchFn } = useCtx();
  const [links, setLinks] = useState<ResourceLink[]>([]);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => fetchFn(`/api/issues/${projectKey}/links`).then((r) => (r.ok ? r.json() : [])).then(setLinks).catch(() => {});
  useEffect(() => { void load(); }, [projectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!/^https?:\/\//i.test(url.trim())) return setError("Use a web address that starts with http:// or https://.");
    setError(null);
    const host = (() => { try { return new URL(url.trim()).hostname; } catch { return url.trim(); } })();
    await app.getState().mutate({ op: "addLink", key: projectKey, url: url.trim(), title: title.trim() || host });
    setUrl(""); setTitle(""); setAdding(false);
    void load();
  };

  return (
    <section role="region" aria-label="Resources" className="side-section">
      <div className="side-head-row">
        <h3>Resources</h3>
        <button type="button" className="icon-btn" aria-label="Add link" onClick={() => setAdding(!adding)}><Plus size={14} /></button>
      </div>
      {links.length === 0 && !adding && <p className="muted side-empty">Add links to documents, designs or tickets elsewhere.</p>}
      <ul className="resources">
        {links.map((l) => (
          <li key={l.id}>
            <a href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a>
            <span className="muted">{(() => { try { return new URL(l.url).hostname; } catch { return ""; } })()}</span>
          </li>
        ))}
      </ul>
      {adding && (
        <form className="link-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <input aria-label="Link URL" placeholder="https://…" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} />
          <input aria-label="Link title" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary">Add</button>
        </form>
      )}
    </section>
  );
}

// ------------------------------------------------------------------- progress
function Progress({ projectKey, epic, kids, pct: s, now }: { projectKey: string; epic: Issue; kids: Issue[]; pct: ReturnType<typeof projectStats>; now: Date }) {
  const { fetchFn } = useCtx();
  const defaultPoints = useDefaultPoints();
  const [history, setHistory] = useState<TicketHistory[] | "error" | null>(null);
  const [tab, setTab] = useState<"assignee" | "label">("assignee");
  const signature = kids.map((k) => `${k.key}:${k.status}`).join();
  useEffect(() => {
    let alive = true;
    setHistory(null);
    fetchFn(`/api/projects/${projectKey}/history`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((h) => alive && setHistory(h))
      .catch(() => alive && setHistory("error"));
    return () => { alive = false; };
  }, [projectKey, signature, fetchFn]);

  const fc = useMemo(() => (Array.isArray(history) ? forecast(history, now, { defaultPoints }) : null), [history, now, defaultPoints]);
  const graph = useMemo(
    () => (Array.isArray(history) ? buildGraph(history, { targetDate: s.targetDate, initialDate: s.initialEstimate, revisedDate: s.revisedEstimate, forecast: fc, defaultPoints, now }) : null),
    [history, s.targetDate, s.initialEstimate, s.revisedEstimate, fc, defaultPoints, now],
  );
  const rows = useMemo(() => progressBy(kids, tab, defaultPoints), [kids, tab, defaultPoints]);
  const startedPct = s.totalPoints ? Math.round((s.startedPoints / s.totalPoints) * 100) : 0;

  return (
    <section role="region" aria-label="Progress" className="side-section">
      <h3>Progress</h3>
      {history === "error" && <p className="muted side-empty">Couldn’t load the progress graph.</p>}
      {history === null && <p className="muted side-empty">Loading progress…</p>}
      {graph && <Chart graph={graph} forecast={fc} done={s.done} total={s.total} />}
      {graph && fc && s.done < s.total && <Estimate fc={fc} target={graph.target} />}
      <div className="stats">
        <div className="stat"><span>Scope</span><strong>{s.totalPoints}</strong></div>
        <div className="stat"><span>Started</span><strong>{s.startedPoints}</strong><span className="muted">{startedPct}%</span></div>
        <div className="stat"><span>Completed</span><strong>{s.donePoints}</strong><span className="muted">{s.pct}%</span></div>
      </div>
      <p className="muted points-note">Tickets with no estimate count as {defaultPoints} points. Change this in Settings.</p>
      <div role="tablist" aria-label="Break down by" className="tabs">
        <button role="tab" type="button" aria-selected={tab === "assignee"} onClick={() => setTab("assignee")}>Assignees</button>
        <button role="tab" type="button" aria-selected={tab === "label"} onClick={() => setTab("label")}>Labels</button>
      </div>
      {rows.length === 0 ? (
        <p className="muted side-empty">{tab === "label" ? "No labels on these tickets." : "No tickets yet."}</p>
      ) : (
        <ul className="breakdown" aria-label={`Completion by ${tab}`}>
          {rows.map((r) => (
            <li key={r.name} title={`${r.done} of ${r.total} done`}>
              <span className="bd-name">{r.name}</span>
              <span className="bar" aria-hidden="true"><span className="bar-done" style={{ width: `${r.pct}%` }} /></span>
              <span className="muted bd-pct">{r.pct}%</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const DAY_MS = 86_400_000;

/** Linear's "estimated completion", in words, with the early–late range and how it compares with the target. */
function Estimate({ fc, target }: { fc: NonNullable<ReturnType<typeof forecast>>; target: number | null }) {
  const gap = target === null ? null : Math.round((fc.at - target) / DAY_MS);
  return (
    <p role="status" aria-label="Estimated completion" className="estimate">
      <strong>Estimated completion {fmt(fc.at)}</strong>
      <span className="muted">{fmt(fc.early)} – {fmt(fc.late)}</span>
      <EstimateInfo fc={fc} />
      {gap !== null && gap > 0 && <span className="chip chip-overdue">{gap} d after target</span>}
      {gap !== null && gap <= 0 && <span className="chip">{-gap} d before target</span>}
    </p>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** An "i" button whose tooltip explains the estimate, using this project's own numbers. */
function EstimateInfo({ fc }: { fc: NonNullable<ReturnType<typeof forecast>> }) {
  const [open, setOpen] = useState(false);
  const defaultPoints = useDefaultPoints();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const weeks = round1(fc.remaining / fc.velocity);
  return (
    <span className="info-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button" className="icon-btn" aria-label="How the estimate is calculated" aria-describedby={open ? "estimate-tip" : undefined}
        onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      ><Info size={13} /></button>
      {open && (
        <span id="estimate-tip" role="tooltip" className="info-tip">
          <p>Like Linear: the pace of the last four weeks, with recent weeks counting more (4, 3, 2 and 1 times), is applied to the work that is left.</p>
          <p>This project finishes about <strong>{round1(fc.velocity)} points a week</strong>, with <strong>{round1(fc.remaining)} points left</strong> (work not started counts in full, work in progress as a quarter). That is about {weeks} weeks.</p>
          <p>The early and late dates are about 40% before and after that. Tickets without story points count as {defaultPoints} points (Settings), dropped tickets are left out, and it needs at least a week of history.</p>
        </span>
      )}
    </span>
  );
}

function Chart({ graph, forecast: fc, done, total }: { graph: GraphData; forecast: ReturnType<typeof forecast>; done: number; total: number }) {
  const W = 296, H = 132, L = 26, R = 8, T = 8, B = 20;
  const [hover, setHover] = useState<number | null>(null);
  const span = Math.max(1, graph.to - graph.from);
  const x = (t: number) => L + ((t - graph.from) / span) * (W - L - R);
  const y = (v: number) => T + (1 - v / Math.max(1, graph.max)) * (H - T - B);
  const line = (k: "scope" | "started" | "completed") => graph.points.map((p) => `${x(p.at).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const last = graph.points.at(-1)!;
  const hp = hover === null ? null : graph.points[hover];
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const t = graph.from + (((e.clientX - r.left) / r.width) * W - L) / (W - L - R) * span;
    let best = 0;
    graph.points.forEach((p, i) => { if (Math.abs(p.at - t) < Math.abs(graph.points[best].at - t)) best = i; });
    setHover(best);
  };
  return (
    <div className="chart-wrap">
      <svg
        role="img" aria-label={`Progress graph: ${done} of ${total} tickets completed`} className="chart" viewBox={`0 0 ${W} ${H}`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      >
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="axis" />
        <line x1={L} x2={W - R} y1={y(graph.max)} y2={y(graph.max)} className="axis faint" />
        <text x={L - 5} y={y(graph.max) + 3} className="tick" textAnchor="end">{graph.max}</text>
        <text x={L - 5} y={y(0) + 3} className="tick" textAnchor="end">0</text>
        <text x={L} y={H - 5} className="tick">{fmt(graph.from)}</text>
        <text x={W - R} y={H - 5} className="tick" textAnchor="end">{fmt(graph.to)}</text>
        {graph.target !== null && graph.target >= graph.from && graph.target <= graph.to && (
          <line data-line="target" x1={x(graph.target)} x2={x(graph.target)} y1={T} y2={y(0)} className="target-line" />
        )}
        {graph.points.map((p, i) => {
          if (p.doneInPeriod <= 0) return null;
          const w = Math.max(2, ((W - L - R) / Math.max(1, graph.points.length)) * 0.5);
          return <rect key={i} data-bar="" x={x(p.at) - w / 2} width={w} y={y(p.doneInPeriod)} height={Math.max(0, y(0) - y(p.doneInPeriod))} className="bar-week" />;
        })}
        {graph.markers.map((m) => (
          <line key={m.kind} data-line={m.kind} x1={x(m.at)} x2={x(m.at)} y1={T} y2={y(0)} className={`mark-line mark-${m.kind}`} />
        ))}
        <polyline data-line="scope" points={line("scope")} className="ln ln-scope" />
        <polyline data-line="started" points={line("started")} className="ln ln-started" />
        <polyline data-line="completed" points={line("completed")} className="ln ln-completed" />
        {fc && last.scope > last.completed && (
          <>
            <line data-line="forecast-early" x1={x(last.at)} y1={y(last.completed)} x2={x(fc.early)} y2={y(last.scope)} className="ln ln-forecast faint" />
            <line data-line="forecast-late" x1={x(last.at)} y1={y(last.completed)} x2={x(fc.late)} y2={y(last.scope)} className="ln ln-forecast faint" />
            <line data-line="forecast" x1={x(last.at)} y1={y(last.completed)} x2={x(fc.at)} y2={y(last.scope)} className="ln ln-forecast" />
          </>
        )}
        {hp && <line x1={x(hp.at)} x2={x(hp.at)} y1={T} y2={y(0)} className="hover-line" />}
      </svg>
      {hp && (
        <div className="chart-tip" role="status">
          <strong>{fmt(hp.at)}</strong>
          <span>Scope {hp.scope} pts</span><span>Started {hp.started}</span><span>Completed {hp.completed}</span>{hp.dropped > 0 && <span>Dropped {hp.dropped}</span>}
        </div>
      )}
      <div className="legend"><span className="lg lg-scope">Scope</span><span className="lg lg-started">Started</span><span className="lg lg-completed">Completed</span>{graph.target !== null && <span className="lg lg-target">Target</span>}{graph.markers.some((m) => m.kind === "initial") && <span className="lg lg-initial">Initial</span>}{graph.markers.some((m) => m.kind === "revised") && <span className="lg lg-revised">Revised</span>}</div>
    </div>
  );
}

export { stripPermanent };
