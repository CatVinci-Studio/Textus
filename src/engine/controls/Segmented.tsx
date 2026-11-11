import { useRef, type KeyboardEvent } from "react";

/**
 * One of a few choices side by side (components.css .tx-segmented): a row
 * of tabs, one tab stop, the arrows moving between them as they choose.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  /** What the choice is about, for a screen reader. */
  label: string;
  className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = options.findIndex((o) => o.id === value);
    const next = options[(at + step + options.length) % options.length];
    onChange(next.id);
    row.current
      ?.querySelector<HTMLElement>(`[data-segment="${next.id}"]`)
      ?.focus();
  };
  return (
    <div
      ref={row}
      className={className ? `tx-segmented ${className}` : "tx-segmented"}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          className="tx-segment"
          data-segment={option.id}
          aria-selected={option.id === value}
          tabIndex={option.id === value ? 0 : -1}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
