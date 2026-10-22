import { useMemo } from "react";
import { Plus, X } from "lucide-react";
import { describeFilter } from "../lib/filters";
import { useCtx, useFilters, useIssueMap, useUi } from "./context";

/** The chips under the header: one per active filter, with operator, values, remove, and view actions. */
export function FilterBar() {
  const { ui, settings } = useCtx();
  const filters = useFilters();
  const map = useIssueMap();
  const all = useMemo(() => Object.values(map), [map]);
  const activeSaved = useUi((s) => s.activeSavedView);
  if (!filters.length) return null;
  const set = ui.getState().setFilters;
  return (
    <div role="toolbar" aria-label="Filters" className="filterbar">
      {filters.map((f) => {
        const d = describeFilter(f, { all });
        return (
          <div key={f.field} role="group" aria-label={`${d.field} ${d.op} ${d.value}`} className="fchip">
            <span className="fchip-field">{d.field}</span>
            <button type="button" className="fchip-op" aria-label="Change operator" onClick={() => set(filters.map((x) => (x.field === f.field ? { ...x, not: !x.not } : x)))}>{d.op}</button>
            <button type="button" className="fchip-value" aria-label={`Change ${d.field.toLowerCase()} values`} onClick={() => ui.getState().openFilter(f.field)}>{d.value}</button>
            <button type="button" className="fchip-x" aria-label="Remove filter" onClick={() => set(filters.filter((x) => x.field !== f.field))}><X size={12} /></button>
          </div>
        );
      })}
      <button type="button" className="icon-btn" aria-label="Add filter" onClick={() => ui.getState().openFilter()}><Plus size={14} /></button>
      <span className="filterbar-spacer" />
      {activeSaved ? (
        <button type="button" className="btn btn-quiet" onClick={() => {
          const v = ui.getState().view;
          settings.getState().updateView(activeSaved, filters, settings.getState().resolveDisplay(v));
        }}>Update view</button>
      ) : (
        <button type="button" className="btn btn-quiet" onClick={() => ui.getState().openOverlay("saveView")}>Save view</button>
      )}
      <button type="button" className="btn btn-quiet" aria-label="Clear all filters" onClick={() => ui.getState().clearFilters()}>Clear</button>
    </div>
  );
}
