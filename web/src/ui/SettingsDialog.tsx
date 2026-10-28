import { useEffect, useRef, useState } from "react";
import type { Contrast, Density, Theme } from "../store/settings";
import { useCtx, useDefaultPoints, useSettings } from "./context";

const THEMES: [Theme, string][] = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];
const CONTRASTS: [Contrast, string][] = [["normal", "Normal"], ["high", "High"]];
const DENSITIES: [Density, string][] = [["comfortable", "Comfortable"], ["compact", "Compact"]];

function Choice<T extends string>({ label, options, value, onPick }: { label: string; options: [T, string][]; value: T; onPick(v: T): void }) {
  return (
    <div className="set-row">
      <span>{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map(([id, text]) => (
          <button key={id} type="button" aria-pressed={value === id} onClick={() => onPick(id)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

/** App-wide settings. They apply to every project and are remembered in this browser. */
export function SettingsDialog() {
  const { ui, settings } = useCtx();
  const value = useDefaultPoints();
  const theme = useSettings((s) => s.theme);
  const contrast = useSettings((s) => s.contrast);
  const density = useSettings((s) => s.density);
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  const [draft, setDraft] = useState(String(value));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && ui.getState().closeOverlay()}>
      <div role="dialog" aria-modal="true" aria-label="Settings" className="dialog form">
        <h2 className="dlg-title">Settings</h2>
        <Choice label="Theme" options={THEMES} value={theme} onPick={(v) => settings.getState().set({ theme: v })} />
        <Choice label="Contrast" options={CONTRASTS} value={contrast} onPick={(v) => settings.getState().set({ contrast: v })} />
        <Choice label="Density" options={DENSITIES} value={density} onPick={(v) => settings.getState().set({ density: v })} />
        <label className="disp-check">
          <input type="checkbox" aria-label="Show sidebar" checked={!collapsed} onChange={() => settings.getState().toggleSidebar()} />Show sidebar
        </label>
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
