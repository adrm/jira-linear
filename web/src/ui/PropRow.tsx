/** One editable property in a details sidebar: label on the left, value on the right. */
export function PropRow({ label, value, children, onClick }: { label: string; value: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="side-row" aria-label={`${label}: ${value}`} onClick={onClick}>
      <span className="side-row-label">{label}</span>
      <span className="side-row-value">{children}</span>
    </button>
  );
}
