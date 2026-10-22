import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import type { AppStore } from "../store/store";
import type { UiStore } from "../store/ui";
import { applyTheme, createSettingsStore, type SettingsStore } from "../store/settings";
import { IssuePage } from "./IssuePage";
import { IssueList } from "./IssueList";
import { ProjectPage, ProjectsList } from "./Projects";
import { ProjectSidebar } from "./ProjectSidebar";
import { Overlays } from "./Overlays";
import { BulkBar, Sidebar, StatusBar, Toasts, ViewHeader } from "./Chrome";
import { runAction } from "./actions";
import { isEpic } from "../lib/projects";
import { CtxProvider, useCtx, useIssueMap, useOrder, useProjects, useProjectsDisplay, useSettings, useUi, useVisible, type Ctx } from "./context";
import { site } from "../lib/site";

export interface AppProps {
  app: AppStore;
  ui: UiStore;
  settings?: SettingsStore;
  fetchFn?: typeof fetch;
  jiraUrl?: string;
  openExternal?: (url: string) => void;
  copyText?: (text: string) => Promise<void>;
  /** background poll / retry interval in ms; 0 disables */
  pollMs?: number;
}

export function App(props: AppProps) {
  const { app, ui } = props;
  const fetchFn = props.fetchFn ?? fetch.bind(globalThis);
  const [me, setMe] = useState<Ctx["me"]>(null);
  const [fallbackSettings] = useState(() => createSettingsStore());
  const settings = props.settings ?? fallbackSettings;
  const [review, setReviewState] = useState<Ctx["review"]>({});
  const reviewRef = useRef(review);
  reviewRef.current = review;

  const refreshReview = () => {
    fetchFn("/api/review").then((r) => (r.ok ? r.json() : [])).then((rows: Array<{ key: string; markedAt: string }>) => setReviewState(Object.fromEntries(rows.map((r) => [r.key, r.markedAt])))).catch(() => {});
  };
  const setReview: Ctx["setReview"] = (keys, marked) => {
    const before = reviewRef.current;
    const changed = keys.filter((k) => !!before[k] !== marked);
    if (!changed.length) return;
    const next = { ...before };
    for (const k of changed) { if (marked) next[k] = new Date().toISOString(); else delete next[k]; }
    setReviewState(next);
    const noun = changed.length === 1 ? changed[0] : `${changed.length} issues`;
    fetchFn("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys: changed, marked }) })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
      .then(() => app.getState().notifyUndoable(marked ? "Marked for review" : "Removed from review", () => setReview(changed, !marked)))
      .catch(() => {
        setReviewState((cur) => {
          const back = { ...cur };
          for (const k of changed) { if (before[k]) back[k] = before[k]; else delete back[k]; }
          return back;
        });
        app.getState().notify(`Couldn’t ${marked ? "mark" : "unmark"} ${noun} for review`);
      });
  };
  useEffect(() => {
    const apply = () => applyTheme(document.documentElement, settings.getState());
    apply();
    return settings.subscribe(apply);
  }, [settings]);

  useEffect(() => {
    let alive = true;
    void app.getState().load().then(() => app.getState().sync()).then(() => app.getState().drain());
    refreshReview();
    fetchFn("/api/me").then((r) => (r.ok ? r.json() : null)).then((u) => alive && u && setMe(u)).catch(() => {});
    let es: EventSource | undefined;
    if (typeof EventSource !== "undefined") {
      es = new EventSource("/api/events");
      es.onmessage = () => void app.getState().sync();
    }
    // The server only asks Jira every few minutes; coming back to the tab is when you want it current.
    let lastCheck = 0;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      fetchFn("/api/sync", { method: "POST" }).catch(() => {}).finally(() => void app.getState().sync());
    };
    document.addEventListener("visibilitychange", onVisible);
    const poll = props.pollMs ?? 15_000;
    const t = poll > 0 ? setInterval(() => { void app.getState().drain().then(() => app.getState().sync()); }, poll) : undefined;
    return () => { alive = false; es?.close(); if (t) clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app]);

  const value: Ctx = {
    app, ui, me, settings, fetchFn, review, setReview,
    jiraUrl: props.jiraUrl ?? site.jiraUrl,
    openExternal: props.openExternal ?? ((u) => void window.open(u, "_blank", "noopener")),
    copyText: props.copyText ?? ((t) => navigator.clipboard.writeText(t)),
  };
  return (
    <CtxProvider value={value}>
      <Shell />
    </CtxProvider>
  );
}

function Shell() {
  useShortcuts();
  useHistorySync();
  const detailOpen = useUi((s) => s.detailOpen);
  const view = useUi((s) => s.view);
  const projectTab = useUi((s) => s.projectTab);
  const projectSideOpen = useSettings((s) => s.projectSidebarOpen);
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  const key = useUi((s) => s.selectedKey);
  const issues = useIssueMap();
  const { total } = useVisible();
  useEffect(() => {
    (window as unknown as { __focusSearch?: () => void }).__focusSearch = () => document.getElementById("search-input")?.focus();
  }, []);
  const onPage = detailOpen && !!key && !!issues[key] && !isEpic(issues[key]);
  return (
    <div className={`shell${collapsed ? " is-collapsed" : ""}`}>
      {!collapsed && <Sidebar />}
      <main className={`main${!onPage && view.startsWith("project:") ? " is-project" : ""}`}>
        {onPage ? <IssuePage /> : (
          <>
            <ViewHeader count={view === "projects" || view.startsWith("project:") ? undefined : total} />
            {view === "projects" ? <ProjectsList /> : (
              view.startsWith("project:") ? (
                <div className={`project-layout${projectSideOpen ? "" : " no-side"}`}>
                  <div className="project-main">
                    <ProjectPage projectKey={view.slice(8)} />
                    {projectTab === "issues" && <IssueList />}
                  </div>
                  <ProjectSidebar projectKey={view.slice(8)} />
                </div>
              ) : <IssueList />
            )}
          </>
        )}
      </main>
      <StatusBar />
      <BulkBar />
      <Toasts />
      <Overlays />
    </div>
  );
}

/** The browser's Back button leaves an open ticket (and Forward returns to it) without full routing. */
function useHistorySync() {
  const { ui } = useCtx();
  useEffect(() => {
    // Entries are tagged with this session so leftovers from elsewhere are never mistaken for ours.
    const session = Math.random().toString(36).slice(2);
    const mine = (state: unknown): string | null => {
      const st = state as { jl?: string; issue?: string } | null;
      return st?.jl === session && st.issue ? st.issue : null;
    };
    let pushed = false;
    const unsub = ui.subscribe((s, prev) => {
      if (s.detailOpen && !prev.detailOpen) {
        window.history.pushState({ jl: session, issue: s.selectedKey }, "");
        pushed = true;
      } else if (!s.detailOpen && prev.detailOpen && pushed) {
        pushed = false;
        if (mine(window.history.state)) window.history.back();
      } else if (s.detailOpen && s.selectedKey !== prev.selectedKey && pushed) {
        window.history.replaceState({ jl: session, issue: s.selectedKey }, ""); // stepping between tickets adds no history entries
      }
    });
    const onPop = (e: PopStateEvent) => {
      const open = ui.getState().detailOpen;
      const issue = mine(e.state);
      if (open && !issue) { pushed = false; ui.getState().closeDetail(); }
      else if (!open && issue) { pushed = true; ui.getState().openIssue(issue); }
    };
    window.addEventListener("popstate", onPop);
    return () => { unsub(); window.removeEventListener("popstate", onPop); };
  }, [ui]);
}

/**
 * Keys typed with Shift or AltGr on many layouts (? / [ ] on a Spanish keyboard). The hotkey library matches
 * modifier state exactly, which breaks these, so they are matched by the character that was typed instead.
 */
function useSymbolKeys() {
  const { ui } = useCtx();
  const order = useOrder();
  const orderRef = useRef(order);
  orderRef.current = order;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.defaultPrevented) return; // ⌘[ is "back", not "previous issue"
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (ui.getState().overlay) return;
      if (e.key === "?" || e.key === "F1") ui.getState().openOverlay("help");
      else if (e.key === "/") (window as unknown as { __focusSearch?: () => void }).__focusSearch?.();
      else if (e.key === "]") ui.getState().move(orderRef.current, 1);
      else if (e.key === "[") ui.getState().move(orderRef.current, -1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui]);
}

function useShortcuts() {
  useSymbolKeys();
  const ctx = useCtx();
  const { app, ui } = ctx;
  const order = useOrder();
  const { columns: ticketColumns, display } = useVisible();
  const projectsLayout = useProjectsDisplay().layout;
  const projectGroups = useProjects().groups;
  const view = useUi((s) => s.view);
  const pageOpen = useUi((s) => s.detailOpen);
  const board = view === "projects" ? projectsLayout === "board" : display.layout === "board" && !pageOpen;
  const columns = useMemo(() => (view === "projects" ? projectGroups.map((g) => g.projects.map((p) => p.key)) : ticketColumns), [view, projectGroups, ticketColumns]);
  const overlay = useUi((s) => s.overlay);
  const idle = overlay === null;
  const opts = { useKey: true, enabled: idle, preventDefault: true } as const;

  // moving
  useHotkeys("j, arrowdown", () => (board ? ui.getState().boardMove(columns, 0, 1) : ui.getState().move(order, 1)), opts, [order, idle, board, columns]);
  useHotkeys("k, arrowup", () => (board ? ui.getState().boardMove(columns, 0, -1) : ui.getState().move(order, -1)), opts, [order, idle, board, columns]);
  useHotkeys("arrowright", () => { if (board) ui.getState().boardMove(columns, 1, 0); }, opts, [idle, board, columns]);
  useHotkeys("arrowleft", () => { if (board) ui.getState().boardMove(columns, -1, 0); }, opts, [idle, board, columns]);
  useHotkeys("meta+arrowdown, ctrl+arrowdown", () => ui.getState().jump(order, "last"), opts, [order, idle]);
  useHotkeys("meta+arrowup, ctrl+arrowup", () => ui.getState().jump(order, "first"), opts, [order, idle]);
  // selecting
  useHotkeys("x", () => ui.getState().toggleSelect(), opts, [idle]);
  useHotkeys("shift+arrowdown", () => ui.getState().extendSelection(order, 1), opts, [order, idle]);
  useHotkeys("shift+arrowup", () => ui.getState().extendSelection(order, -1), opts, [order, idle]);
  useHotkeys("meta+a, ctrl+a", () => ui.getState().selectAll(order), opts, [order, idle]);
  useHotkeys("meta+z, ctrl+z", () => void app.getState().undo(), opts, [idle]);
  // opening
  useHotkeys("enter", () => {
    const { view, selectedKey } = ui.getState();
    if (view === "projects") { if (selectedKey) ui.getState().setView(`project:${selectedKey}`); }
    else ui.getState().openDetail();
  }, opts, [idle]);
  // going places (Linear: G then I / A / B)
  useHotkeys("g>i", () => ui.getState().setView("mine"), opts, [idle]);
  useHotkeys("g>a", () => ui.getState().setView("active"), opts, [idle]);
  useHotkeys("g>b", () => ui.getState().setView("backlog"), opts, [idle]);
  useHotkeys("g>t", () => ui.getState().setView("all"), opts, [idle]);
  useHotkeys("g>r", () => ui.getState().setView("review"), opts, [idle]);
  useHotkeys("g>p", () => ui.getState().setView("projects"), opts, [idle]);
  // acting on the highlighted row or the selection
  useHotkeys("s", () => runAction(ctx, "status"), opts, [idle, ctx]);
  useHotkeys("a", () => runAction(ctx, "assignee"), opts, [idle, ctx]);
  useHotkeys("i", () => runAction(ctx, "me"), opts, [idle, ctx]);
  useHotkeys("p", () => runAction(ctx, "priority"), opts, [idle, ctx]);
  useHotkeys("l", () => runAction(ctx, "labels"), opts, [idle, ctx]);
  useHotkeys("shift+p", () => runAction(ctx, "project"), opts, [idle, ctx]);
  useHotkeys("shift+d", () => runAction(ctx, "due"), opts, [idle, ctx]);
  useHotkeys("r", () => runAction(ctx, "rename"), opts, [idle, ctx]);
  useHotkeys("t", () => runAction(ctx, "review"), opts, [idle, ctx]);
  useHotkeys("o", () => runAction(ctx, "open"), opts, [idle, ctx]);
  useHotkeys("y", () => runAction(ctx, "copy"), opts, [idle, ctx]);
  useHotkeys("c", () => ui.getState().openCreate(), opts, [idle]);
  useHotkeys("m", () => {
    if (!ui.getState().selectedKey) return;
    ui.getState().openDetail();
    ui.getState().openOverlay("comment");
  }, opts, [idle]);
  useHotkeys("meta+., ctrl+.", () => ctx.settings.getState().toggleSidebar(), { useKey: true, preventDefault: true, enableOnFormTags: true }, [ctx]);
  useHotkeys("meta+i, ctrl+i", () => { if (ui.getState().view.startsWith("project:")) ctx.settings.getState().toggleProjectSidebar(); }, { useKey: true, preventDefault: true, enableOnFormTags: true }, [ctx]);
  useHotkeys("meta+[, ctrl+[", () => { if (ui.getState().detailOpen) ui.getState().closeDetail(); }, { useKey: true, preventDefault: true, enableOnFormTags: true }, []);
  useHotkeys("f", () => ui.getState().openFilter(), opts, [idle]);
  useHotkeys("shift+v", () => ui.getState().openOverlay("display"), opts, [idle]);
  useHotkeys("meta+b, ctrl+b", () => {
    const v = ui.getState().view;
    if (v === "projects") {
      const cur = ctx.settings.getState().resolveProjectsDisplay().layout;
      ctx.settings.getState().setProjectsDisplay({ layout: cur === "board" ? "list" : "board" });
      return;
    }
    const cur = ctx.settings.getState().resolveDisplay(v).layout;
    ctx.settings.getState().setDisplay(v, { layout: cur === "board" ? "list" : "board" });
  }, { useKey: true, preventDefault: true, enabled: idle }, [idle, ctx]);
  useHotkeys("meta+k, ctrl+k", () => ui.getState().openOverlay("palette"), { enableOnFormTags: true, preventDefault: true }, []);
  useHotkeys("escape", () => {
    ui.getState().escape();
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, { enableOnFormTags: true }, []);
}
