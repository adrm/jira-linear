import { useMemo, useState } from "react";
import { ChevronLeft, CircleDot, Layers, Tag, UserRound, Box, Shapes, Signal } from "lucide-react";
import { FILTER_FIELDS, filterOptions, toggleValue, type FilterField } from "../lib/filters";
import { PickList, type PickItem } from "./Overlay";
import { useCtx, useFilters, useIssueMap, useUi, useViewIssues } from "./context";

const ICONS: Record<FilterField, React.ReactNode> = {
  status: <CircleDot size={14} />, assignee: <UserRound size={14} />, priority: <Signal size={14} />,
  label: <Tag size={14} />, project: <Box size={14} />, type: <Shapes size={14} />,
};
void Layers;

export function FilterMenu({ field: initial }: { field?: FilterField }) {
  const { ui } = useCtx();
  const [field, setField] = useState<FilterField | null>(initial ?? null);
  const filters = useFilters();
  const inView = useViewIssues();
  const map = useIssueMap();
  const all = useMemo(() => Object.values(map), [map]);
  const view = useUi((s) => s.view);
  const close = () => ui.getState().closeOverlay();
  void view;

  const fieldItems: PickItem[] = FILTER_FIELDS.map((f) => ({ id: f.field, label: f.label, icon: ICONS[f.field] }));
  const label = FILTER_FIELDS.find((f) => f.field === field)?.label;
  const valueItems: PickItem[] = field
    ? filterOptions(field, inView, all).map((o) => ({
      id: o.value === "" ? "__none" : o.value, label: o.label, hint: String(o.count),
      checked: !!filters.find((f) => f.field === field)?.values.includes(o.value),
    }))
    : [];
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Filter" className="dialog">
        {field && (
          <div className="dlg-back-row">
            <button type="button" className="dlg-back" onClick={() => setField(null)}><ChevronLeft size={14} />Filter</button>
            <span className="dlg-sub-inline">{label}</span>
          </div>
        )}
        <PickList
          key={field ?? "fields"}
          placeholder={field ? `Filter by ${label!.toLowerCase()}…` : "Filter…"}
          groups={[{ items: field ? valueItems : fieldItems }]}
          onPick={(id) => {
            if (!field) return setField(id as FilterField);
            ui.getState().setFilters(toggleValue(filters, field, id === "__none" ? "" : id));
          }}
        />
      </div>
    </div>
  );
}
