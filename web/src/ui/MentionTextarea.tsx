import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { localContext } from "../store/store";
import { activeMention, uniqueLabel, type People } from "../lib/mentionText";
import { useApp, useCtx } from "./context";

interface Person { id: string; name: string }

const MAX_SUGGESTIONS = 6;
const SEARCH_DELAY_MS = 150;

type Props = Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  /** Who each `@Name` in the text stands for. Updated here; the owner turns the text into Markdown with `fromDisplay`. */
  people: { current: People };
};

/**
 * A textarea where typing `@` suggests people. Picking one writes `@Name` and remembers their account, so what is
 * sent to Jira is a native mention. People come from the tickets already loaded, then from a Jira search.
 */
export function MentionTextarea({ value, onChange, people, ref, onKeyDown, onKeyUp, onClick, onBlur, ...rest }: Props) {
  const { fetchFn, me } = useCtx();
  const issues = useApp((s) => s.issues);
  const listId = useId();
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [sel, setSel] = useState(0);
  const [remote, setRemote] = useState<Person[]>([]);

  const query = trigger?.query.trim() ?? "";
  useEffect(() => {
    if (!query) { setRemote([]); return; }
    let stale = false;
    const timer = setTimeout(() => {
      fetchFn(`/api/users?q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((list: Person[]) => { if (!stale && Array.isArray(list)) setRemote(list); })
        .catch(() => {});
    }, SEARCH_DELAY_MS);
    return () => { stale = true; clearTimeout(timer); };
  }, [query, fetchFn]);

  const items = useMemo(() => {
    if (!trigger) return [];
    const q = query.toLowerCase();
    const known = new Map<string, string>(Object.entries(localContext(issues).users));
    if (me) known.set(me.id, me.name);
    const local = [...known].map(([id, name]) => ({ id, name })).filter((p) => p.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name));
    const more = remote.filter((p) => p.name.toLowerCase().includes(q) && !known.has(p.id));
    return [...local, ...more].slice(0, MAX_SUGGESTIONS);
  }, [trigger, query, issues, me, remote]);

  const open = !!trigger && items.length > 0 && dismissed !== trigger.start;
  const active = Math.min(sel, Math.max(items.length - 1, 0));

  useLayoutEffect(() => {
    if (pendingCaret.current !== null) { inner.current?.setSelectionRange(pendingCaret.current, pendingCaret.current); pendingCaret.current = null; }
  }, [value]);

  const look = (el: HTMLTextAreaElement) => {
    const t = activeMention(el.value, el.selectionStart ?? el.value.length, people.current);
    setTrigger((prev) => (prev?.start === t?.start && prev?.query === t?.query ? prev : t));
  };

  const pick = (person: Person) => {
    if (!trigger) return;
    const caret = inner.current?.selectionStart ?? value.length;
    const label = uniqueLabel(person.name, person.id, people.current);
    people.current = { ...people.current, [label]: person.id };
    pendingCaret.current = trigger.start + label.length + 2;
    onChange(value.slice(0, trigger.start) + "@" + label + " " + value.slice(caret));
    setTrigger(null);
  };

  return (
    <div className="mention-wrap">
      <textarea
        {...rest}
        ref={(el) => {
          inner.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        value={value}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onChange={(e) => { setSel(0); onChange(e.target.value); look(e.target); }}
        onKeyUp={(e) => { onKeyUp?.(e); look(e.currentTarget); }}
        onClick={(e) => { onClick?.(e); look(e.currentTarget); }}
        onBlur={(e) => { onBlur?.(e); setTrigger(null); }}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setSel((active + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
              return;
            }
            if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey) || e.key === "Tab") {
              e.preventDefault();
              pick(items[active]);
              return;
            }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDismissed(trigger!.start); return; }
          }
          onKeyDown?.(e);
        }}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="Mention suggestions" className="menu mention-list">
          {items.map((p, i) => (
            <li
              key={p.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} className="menu-item"
              onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setSel(i)}
            >
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
