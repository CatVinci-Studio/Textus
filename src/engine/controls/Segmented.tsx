import {
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/**
 * One of a few choices side by side (components.css .tx-segmented), one
 * tab stop, the arrows moving between them as they choose. `tabs` switch
 * what shows below; a `choice` is a value (radios). An option with an icon
 * shows only the icon, its label its name. `equal`: segments of one width,
 * a thumb sliding between them, so nothing is measured.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  kind = "tabs",
  equal = false,
  className,
}: {
  options: readonly { id: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  /** What the choice is about, for a screen reader. */
  label: string;
  kind?: "tabs" | "choice";
  equal?: boolean;
  className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const at = options.findIndex((o) => o.id === value);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = options[(at + step + options.length) % options.length];
    onChange(next.id);
    row.current
      ?.querySelector<HTMLElement>(`[data-segment="${next.id}"]`)
      ?.focus();
  };
  const tabs = kind === "tabs";
  const style = equal
    ? ({
        "--segment-count": options.length,
        "--segment-at": Math.max(at, 0),
      } as CSSProperties)
    : undefined;
  return (
    <div
      ref={row}
      className={["tx-segmented", equal && "is-equal", className]
        .filter(Boolean)
        .join(" ")}
      style={style}
      role={tabs ? "tablist" : "radiogroup"}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const on = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role={tabs ? "tab" : "radio"}
            className={option.icon ? "tx-segment is-icon" : "tx-segment"}
            data-segment={option.id}
            aria-selected={tabs ? on : undefined}
            aria-checked={tabs ? undefined : on}
            aria-label={option.icon ? option.label : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => {
              if (!on) onChange(option.id);
            }}
          >
            {option.icon ?? option.label}
          </button>
        );
      })}
    </div>
  );
}
