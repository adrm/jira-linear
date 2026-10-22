import { useEffect, useRef } from "react";
import { isEpic } from "../lib/projects";
import { ACTIONS, reviewText, runAction, type ActionId } from "./actions";
import { useCtx, useTargetIssues } from "./context";

export function ContextMenu({ x, y }: { x: number; y: number }) {
  const ctx = useCtx();
  const targets = useTargetIssues();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus(), []);
  const allMarked = targets.length > 0 && targets.every((t) => ctx.review[t.key]);
  const close = () => ctx.ui.getState().closeOverlay();
  const onlyProjects = targets.length > 0 && targets.every(isEpic);
  const actions = ACTIONS.filter((a) => !(onlyProjects && (a.id === "project" || a.id.startsWith("rel"))) && !(targets.length > 1 && (a.id === "rename" || a.id === "open" || a.id.startsWith("rel"))));

  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  };
  const left = Math.min(x, window.innerWidth - 240);
  const top = Math.min(y, window.innerHeight - 380);
  return (
    <div className="menu-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()} onContextMenu={(e) => { e.preventDefault(); close(); }}>
      <div ref={ref} role="menu" aria-label="Issue actions" className="menu" style={{ left, top }} onKeyDown={onKey}>
        {targets.length > 1 && <div className="menu-head">{targets.length} issues</div>}
        {actions.map((a) => (
          <button key={a.id} type="button" role="menuitem" className="menu-item" onClick={() => runAction(ctx, a.id as ActionId)}>
            <span>{a.id === "review" ? reviewText(allMarked, "label") : a.label}</span>
            {a.keys && <span className="dlg-kbd">{a.keys.split(" ").map((k) => <kbd key={k}>{k}</kbd>)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
