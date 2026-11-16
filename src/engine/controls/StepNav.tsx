import type { ReactNode } from "react";
import type { BubbleSide } from "./Bubble";
import { IconButton } from "./IconButton";
import { ChevronIcon } from "./icons";

/** "‹ 2/5 ›": back and on through a list of places, and where it is. */
export function StepNav({
  previous,
  next,
  position,
  onStep,
  disabled,
  hintSide,
  className = "",
}: {
  /** The buttons' names ("Previous edit"). */
  previous: string;
  next: string;
  position: ReactNode;
  onStep: (step: -1 | 1) => void;
  disabled?: boolean;
  hintSide?: BubbleSide;
  className?: string;
}) {
  return (
    <span className={`tx-step-nav ${className}`}>
      <IconButton
        label={previous}
        hintSide={hintSide}
        disabled={disabled}
        onClick={() => onStep(-1)}
      >
        <ChevronIcon className="tx-step-nav-back" />
      </IconButton>
      <span className="tx-step-nav-pos">{position}</span>
      <IconButton
        label={next}
        hintSide={hintSide}
        disabled={disabled}
        onClick={() => onStep(1)}
      >
        <ChevronIcon />
      </IconButton>
    </span>
  );
}
