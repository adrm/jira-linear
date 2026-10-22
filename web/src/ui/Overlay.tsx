import { Command } from "cmdk";
import { Check, Minus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

const contains = (value: string, search: string) => (value.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0);

export interface PickItem {
  id: string;
  label: string;
  hint?: string;
  /** shortcut shown at the right, e.g. "S" */
  kbd?: string;
  icon?: ReactNode;
  /** text matched against the search box; defaults to label */
  search?: string;
  /** a check mark: true for all, "mixed" for some of a multi-selection */
  checked?: boolean | "mixed";
}

/** Filter box plus a list of items; the body of every picker and of the command menu. */
export function PickList({ placeholder, groups, onPick, extra, autoFocus = true, source }: {
  placeholder: string;
  groups: Array<{ heading?: string; items: PickItem[] }>;
  /** for very long lists: produce the items for the current search instead of filtering everything on screen */
  source?: (search: string) => PickItem[];
  onPick: (id: string) => void;
  extra?: (search: string) => PickItem | null;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  useEffect(() => { if (autoFocus) ref.current?.querySelector("input")?.focus(); }, [autoFocus]);
  const added = extra?.(search) ?? null;
  return (
    <div ref={ref}>
      <Command filter={contains} loop shouldFilter={!source}>
        <Command.Input placeholder={placeholder} aria-label={placeholder} value={search} onValueChange={setSearch} />
        <Command.List>
          <Command.Empty>Nothing matches.</Command.Empty>
          {(source ? [{ heading: undefined, items: source(search) }] : groups).map((g, gi) => (
            <Command.Group key={gi} heading={g.heading}>
              {g.items.map((it) => (
                <Command.Item key={it.id} value={it.search ?? it.label} onSelect={() => onPick(it.id)}>
                  {it.icon}
                  <span className="dlg-label">{it.label}</span>
                  {it.hint && <span className="muted">{it.hint}</span>}
                  {it.kbd && <span className="dlg-kbd">{it.kbd.split(" ").map((k) => <kbd key={k}>{k}</kbd>)}</span>}
                  {it.checked && (
                    <span className="check" role="img" aria-label={it.checked === "mixed" ? "Partly selected" : "Selected"}>
                      {it.checked === "mixed" ? <Minus size={14} /> : <Check size={14} />}
                    </span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
          {added && (
            <Command.Item key={added.id} value={search} onSelect={() => onPick(added.id)}>
              <span className="dlg-label">{added.label}</span>
            </Command.Item>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

/** A modal picker: scrim, dialog, and a PickList. */
export function PickerDialog({ title, subtitle, placeholder, groups, onPick, onClose, extra }: {
  title: string;
  /** shown above the list, e.g. "3 issues" when acting on a selection */
  subtitle?: string;
  extra?: (search: string) => PickItem | null;
  placeholder: string;
  groups: Array<{ heading?: string; items: PickItem[] }>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="dialog">
        {subtitle && <h2 className="dlg-sub">{subtitle}</h2>}
        <PickList placeholder={placeholder} groups={groups} onPick={onPick} extra={extra} />
      </div>
    </div>
  );
}
