import { useState, type KeyboardEvent } from "react";
import {
  inRange,
  readTyped,
  stepFrom,
  type StepRange,
} from "../utils/step-range";
import { isImeKeydown } from "../utils/ime";
import { UndoIcon } from "./icons";
import { Tooltip } from "./Tooltip";
import "./NumberStepper.css";

/** Labels a stepper reads out, in the UI's language. */
export interface StepperLabels {
  /** The setting's name. */
  label: string;
  /** What not set means: "Theme's". */
  unset: string;
  decrease: string;
  increase: string;
  /** The button that clears the value. */
  reset: string;
}

/** A number typed in, or stepped with − and + or the arrow keys, within a
 *  range. `null` is "not set": the field shows `from()`, the value in effect
 *  now, dimmed, and the first step starts there. Emptying the field or the
 *  reset button beside it sets null again. */
export function NumberStepper({
  value,
  range,
  unit,
  from,
  onChange,
  labels,
}: {
  value: number | null;
  range: StepRange;
  unit?: string;
  from: () => number;
  onChange: (value: number | null) => void;
  labels: StepperLabels;
}) {
  // What is typed, until Enter or leaving the field commits it.
  const [draft, setDraft] = useState<string | null>(null);
  const format = (n: number) =>
    n.toLocaleString(document.documentElement.lang || undefined, {
      maximumFractionDigits: 3,
      useGrouping: false,
    });
  const typed = draft === null ? value : readTyped(draft);
  // Read only while unset: what the theme gives, as the document shows it.
  const shown = value ?? inRange(from(), range);
  const base = typeof typed === "number" ? typed : shown;

  const commit = (next: number | null) => {
    setDraft(null);
    const kept = next === null ? null : inRange(next, range);
    if (kept !== value) onChange(kept);
  };
  // From what is typed, if it is a number: the step the user sees.
  const step = (by: -1 | 1) => commit(stepFrom(base, by, range));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isImeKeydown(e)) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      step(e.key === "ArrowUp" ? 1 : -1);
    } else if (e.key === "Enter" && draft !== null) {
      commit(typed === undefined ? value : typed);
    } else if (e.key === "Escape" && draft !== null) {
      // Only the typing is undone; the dialog it is in stays open.
      e.preventDefault();
      setDraft(null);
    }
  };

  const valueText = `${format(shown)} ${unit ?? ""}`.trim();
  return (
    <div className="number-stepper-row">
      {value !== null && (
        <Tooltip text={labels.reset}>
          <button
            type="button"
            className="tx-icon-button"
            aria-label={labels.reset}
            onClick={() => commit(null)}
          >
            <UndoIcon />
          </button>
        </Tooltip>
      )}
      <div className={`number-stepper${unit ? " has-unit" : ""}`}>
        <button
          type="button"
          className="tx-icon-button"
          tabIndex={-1}
          aria-label={labels.decrease}
          disabled={base <= range.min}
          // The field keeps the focus, and what is typed in it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => step(-1)}
        >
          −
        </button>
        <input
          className="number-stepper-field"
          role="spinbutton"
          inputMode="decimal"
          aria-label={labels.label}
          aria-valuemin={range.min}
          aria-valuemax={range.max}
          aria-valuenow={shown}
          aria-valuetext={
            value === null ? `${labels.unset}, ${valueText}` : valueText
          }
          placeholder={format(shown)}
          value={draft ?? (value === null ? "" : format(value))}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() =>
            draft !== null && commit(typed === undefined ? value : typed)
          }
          onKeyDown={onKeyDown}
        />
        {unit && (
          <span className="number-stepper-unit" aria-hidden="true">
            {unit}
          </span>
        )}
        <button
          type="button"
          className="tx-icon-button"
          tabIndex={-1}
          aria-label={labels.increase}
          disabled={base >= range.max}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => step(1)}
        >
          +
        </button>
      </div>
    </div>
  );
}
