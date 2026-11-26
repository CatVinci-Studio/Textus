import { useEffect, useState, type KeyboardEvent } from "react";
import { IconButton } from "./IconButton";

/** `n` inside the range, to two decimals: what a typed value settles on. */
export function clampToRange(n: number, min: number, max: number): number {
  return Number(Math.min(max, Math.max(min, n)).toFixed(2));
}

/** `n` on `step`'s grid from `min`, inside the range: where − and + land. */
function clampToStep(
  n: number,
  min: number,
  max: number,
  step: number,
): number {
  const snapped = Math.round((n - min) / step) * step + min;
  const places = (String(step).split(".")[1] ?? "").length;
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(places));
}

/**
 * A number typed or stepped, with its unit after it and − / + beside it.
 * Empty is "not set" (null): the placeholder shows what applies then, and a
 * step starts from it. Typed values settle on Enter or leaving the field,
 * kept inside the range; − / + and the arrow keys move along the step.
 */
export function NumberField({
  value,
  placeholder,
  min,
  max,
  step,
  unit,
  label,
  decreaseLabel,
  increaseLabel,
  onChange,
}: {
  value: number | null;
  /** What applies while it is empty. */
  placeholder: number | null;
  min: number;
  max: number;
  step: number;
  unit?: string;
  label: string;
  decreaseLabel: string;
  increaseLabel: string;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const typed = text.trim();
    const n = Number(typed.replace(",", "."));
    const next =
      typed === "" || !Number.isFinite(n) ? null : clampToRange(n, min, max);
    setText(next === null ? "" : String(next));
    if (next !== value) onChange(next);
  };
  const stepBy = (by: number) => {
    const from = value ?? placeholder ?? min;
    onChange(clampToStep(from + by * step, min, max, step));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    const by = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    stepBy(by);
  };
  return (
    <span className="tx-number">
      <IconButton
        label={decreaseLabel}
        className="tx-icon-button tx-number-step"
        disabled={value !== null && value <= min}
        onClick={() => stepBy(-1)}
      >
        <span className="tx-icon" data-icon="minus" aria-hidden="true" />
      </IconButton>
      <input
        className="tx-input tx-square tx-number-input"
        inputMode="decimal"
        aria-label={label}
        value={text}
        placeholder={placeholder === null ? "" : String(placeholder)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <span className="tx-number-unit" aria-hidden={!unit}>
        {unit}
      </span>
      <IconButton
        label={increaseLabel}
        className="tx-icon-button tx-number-step"
        disabled={value !== null && value >= max}
        onClick={() => stepBy(1)}
      >
        <span className="tx-icon" data-icon="plus" aria-hidden="true" />
      </IconButton>
    </span>
  );
}
