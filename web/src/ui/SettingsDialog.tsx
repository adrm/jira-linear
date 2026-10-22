import { useEffect, useRef, useState } from "react";
import { useCtx, useDefaultPoints } from "./context";

/** App-wide settings. They apply to every project and are remembered in this browser. */
export function SettingsDialog() {
  const { ui, settings } = useCtx();
  const value = useDefaultPoints();
  const [draft, setDraft] = useState(String(value));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && ui.getState().closeOverlay()}>
      <div role="dialog" aria-modal="true" aria-label="Settings" className="dialog form">
        <h2 className="dlg-title">Settings</h2>
        <label>
          Points for unestimated tickets
          <input
            ref={input} type="number" min={1} max={100} step={1} aria-label="Points for unestimated tickets" value={draft}
            onChange={(e) => { setDraft(e.target.value); settings.getState().setDefaultStoryPoints(Number(e.target.value)); }}
            onBlur={() => setDraft(String(settings.getState().defaultStoryPoints))}
          />
        </label>
        <p className="muted">Used for progress, the chart and the forecast in every project, for tickets that have no Story Points in Jira.</p>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={() => ui.getState().closeOverlay()}>Done</button>
        </div>
      </div>
    </div>
  );
}
