/** A row with a label and a segmented control; one option is on at a time. */
export function Choice<T extends string>({ label, options, value, onPick }: { label: string; options: [T, string][]; value: T; onPick(v: T): void }) {
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
