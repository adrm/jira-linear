import type { BlockState } from "../lib/relations";
import { priorityLevel } from "../lib/vocab";
import { statusStyle } from "../lib/statusColors";

export function StatusIcon({ category, status, block = null, fraction }: { category: string; status?: string; block?: BlockState; fraction?: number }) {
  const st = statusStyle(status ?? "", category);
  const c = st.kind === "backlog" || st.kind === "todo" || st.kind === "canceled" ? "var(--st-todo)" : `lch(var(--l-status) ${st.chroma} ${st.hue})`;
  const f = st.kind === "started" ? Math.min(0.99, Math.max(0.05, fraction ?? 0.5)) : undefined;
  let pie: string | null = null;
  if (f !== undefined) {
    const a = f * 2 * Math.PI;
    pie = `M7 7 L7 3.5 A3.5 3.5 0 ${f > 0.5 ? 1 : 0} 1 ${(7 + 3.5 * Math.sin(a)).toFixed(3)} ${(7 - 3.5 * Math.cos(a)).toFixed(3)} Z`;
  }
  return (
    <svg className="icon-status" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" data-kind={st.kind} data-hue={st.kind === "started" || st.kind === "done" ? st.hue : undefined} data-block={block ?? undefined} data-fill={f}>
      {st.kind === "done" ? (
        <>
          <circle cx="7" cy="7" r="6" fill={c} />
          <path d="M4.2 7.2l1.9 1.9 3.7-3.9" stroke="var(--bg)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : st.kind === "canceled" ? (
        <>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={c} strokeWidth="1.5" />
          <path d="M5 5l4 4M9 5l-4 4" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
        </>
      ) : st.kind === "started" ? (
        <>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={c} strokeWidth="1.5" />
          <path d={pie!} fill={c} />
        </>
      ) : (
        <circle cx="7" cy="7" r="5.5" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray={st.kind === "backlog" ? "2.4 2" : undefined} />
      )}
      {block && (
        <g>
          <circle cx="11" cy="11" r="3.4" fill={block === "blocked" ? "var(--blocked)" : "var(--blocking)"} stroke="var(--bg)" strokeWidth="1.2" />
          {block === "blocked"
            ? <path d="M9.4 11h3.2" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
            : <path d="M11 9.5v1.7M11 12.4v.1" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />}
        </g>
      )}
    </svg>
  );
}

const BAR_COUNT = { high: 3, medium: 2, low: 1 } as const;
export function PriorityIcon({ priority }: { priority: string | null }) {
  const level = priorityLevel(priority);
  return (
    <svg className="icon-prio" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" data-priority={level}>
      {level === "urgent" ? (
        <>
          <rect x="1.5" y="1.5" width="11" height="11" rx="3" fill="var(--urgent)" />
          <path d="M7 4.2v3.8M7 9.7v.1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : level === "none" ? (
        <path d="M2.5 7h9" stroke="var(--muted)" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="1.8 2.2" />
      ) : (
        [0, 1, 2].map((i) => (
          <rect key={i} x={2 + i * 4} y={11 - (i + 1) * 3} width="2.4" height={(i + 1) * 3} rx=".7" fill={i < BAR_COUNT[level] ? "var(--text)" : "var(--line-strong)"} />
        ))
      )}
    </svg>
  );
}

export function Avatar({ name }: { name: string | null }) {
  if (!name) return <span className="avatar avatar-empty" aria-hidden="true" />;
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return <span className="avatar" title={name} aria-hidden="true">{initials}</span>;
}
