import { useRef, type CSSProperties } from "react";
import { useViewportClamp } from "../../utils/hooks/useViewportClamp";
import { usePresenceProps } from "../../ui/usePresence";
import { ChevronIcon } from "../../ui/icons";
import type { GrammarKind } from "./grammar-kind";
import { Tooltip } from "../../ui/Tooltip";
import "./GrammarPopover.css";

export interface GrammarPopoverInfo {
  x: number;
  y: number;
  from: number;
  to: number;
  issue: string;
  suggestion: string;
  /** Exact text the range must still contain for Apply to act. */
  original?: string;
  /** What kind of slip it is (grammar-kind.ts), for the label. */
  kind: GrammarKind;
  /** How the card shows the fix when it differs from what is replaced (a
   *  one-character CJK fix, shown with its neighbour). */
  shownOriginal?: string;
  shownSuggestion?: string;
  /** Where it stands among the paragraph's underlines. */
  index: number;
  count: number;
}

export interface GrammarPopoverLabels {
  grammarKinds: Record<GrammarKind, string>;
  /** "Change to “{s}”". */
  grammarApplyTo: string;
  grammarApply: string;
  grammarIgnore: string;
  grammarPrevious: string;
  grammarNext: string;
}

interface GrammarPopoverProps {
  info: GrammarPopoverInfo;
  labels: GrammarPopoverLabels;
  /** Why the last Apply click did nothing (stale text) - shown in place of the button. */
  error: string | null;
  onApply: () => void;
  onIgnore: () => void;
  onStep: (delta: 1 | -1) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/** "Change to “毕竟”" - or plain "Apply" for a fix that deletes, or one too
 *  long to name on a button. */
export function applyLabel(
  labels: Pick<GrammarPopoverLabels, "grammarApplyTo" | "grammarApply">,
  suggestion: string,
): string {
  const s = suggestion.trim();
  return s && [...s].length <= 16
    ? labels.grammarApplyTo.replace("{s}", s)
    : labels.grammarApply;
}

/**
 * The card under a grammar underline: what kind of slip it is, the wrong
 * words → the fix, the checker's note, then the fix itself as the button
 * (Alt+Enter, written on it) beside Ignore. With more than one underline
 * in the paragraph, ‹ 1/3 › steps between them.
 */
export function GrammarPopover({
  info,
  labels,
  error,
  onApply,
  onIgnore,
  onStep,
  onMouseEnter,
  onMouseLeave,
}: GrammarPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pos = useViewportClamp(rootRef, info.x, info.y);
  const presence = usePresenceProps(rootRef);
  // It grows out of the underline it explains: from its top edge, or its
  // bottom one when the window's edge pushed it up over the line.
  const origin = {
    "--transform-origin": `${Math.max(0, info.x - pos.left)}px ${pos.top < info.y - 0.5 ? "100%" : "0"}`,
  } as CSSProperties;
  return (
    <div
      {...presence}
      className="grammar-popover floating-surface"
      style={{ ...pos, ...origin }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="grammar-popover-head">
        <span className={`grammar-kind grammar-kind-${info.kind}`}>
          {labels.grammarKinds[info.kind]}
        </span>
        <span className="grammar-popover-fix">
          {info.original && <s>{info.shownOriginal ?? info.original}</s>}
          {info.original && <span aria-hidden="true"> → </span>}
          <b>{info.shownSuggestion ?? (info.suggestion || "\u2205")}</b>
        </span>
        {info.count > 1 && (
          <span className="grammar-popover-nav">
            <Tooltip text={labels.grammarPrevious}>
              <button
                type="button"
                aria-label={labels.grammarPrevious}
                onClick={() => onStep(-1)}
              >
                <ChevronIcon className="grammar-popover-prev" />
              </button>
            </Tooltip>
            <span>
              {info.index + 1}/{info.count}
            </span>
            <Tooltip text={labels.grammarNext}>
              <button
                type="button"
                aria-label={labels.grammarNext}
                onClick={() => onStep(1)}
              >
                <ChevronIcon />
              </button>
            </Tooltip>
          </span>
        )}
      </div>
      {info.issue && <div className="grammar-popover-issue">{info.issue}</div>}
      {error ? (
        <div className="grammar-popover-error">{error}</div>
      ) : (
        <div className="grammar-popover-actions">
          <button className="grammar-popover-apply" onClick={onApply}>
            {applyLabel(labels, info.shownSuggestion ?? info.suggestion)}
            <kbd>Alt+Enter</kbd>
          </button>
          <button className="grammar-popover-ignore" onClick={onIgnore}>
            {labels.grammarIgnore}
          </button>
        </div>
      )}
    </div>
  );
}
