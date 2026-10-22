import { useEffect, useRef, useState } from "react";
import { useCtx } from "./context";

export function SaveViewDialog() {
  const { ui, settings } = useCtx();
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const view = ui.getState().view;
    const id = settings.getState().saveView(n, view, ui.getState().filters(), settings.getState().resolveDisplay(view));
    ui.getState().closeOverlay();
    ui.getState().openSavedView({ id, name: n, view, filters: ui.getState().filters(), display: settings.getState().resolveDisplay(view) });
  };
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && ui.getState().closeOverlay()}>
      <form role="dialog" aria-modal="true" aria-label="Save view" className="dialog form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label>Name<input ref={input} aria-label="Name" placeholder="e.g. Bugs in review" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => ui.getState().closeOverlay()}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>Save view</button>
        </div>
      </form>
    </div>
  );
}
