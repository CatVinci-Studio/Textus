import { useEffect, useState } from "react";
import { thoughtSeconds, thoughtTail, type Thought } from "./thought";

export interface ThoughtRowLabels {
  /** "Thinking · {n} seconds", while the model thinks. */
  thinkingFor: (seconds: number) => string;
  /** "Thought for {n} seconds", once it has. */
  thoughtFor: (seconds: number) => string;
}

/**
 * One grey line above a reply: how long the model has been thinking, live,
 * then how long it thought. Where the provider streams readable reasoning
 * (a summary, or the reasoning itself), the line opens to show it; where it
 * only says that it thinks, the line is just the time.
 *
 * While the model thinks, the row stands open on the last few lines of it,
 * so a long wait reads as work going on; it closes once the reply or an
 * edit starts. A click decides for this row from then on, and closing a
 * live one keeps the conversation's next thoughts closed too (`follow`).
 */
export function ThoughtRow({
  thought,
  labels,
  follow = true,
  onFollow,
}: {
  thought: Thought;
  labels: ThoughtRowLabels;
  /** Whether a live thought opens on its tail (the conversation's choice). */
  follow?: boolean;
  onFollow?: (follow: boolean) => void;
}) {
  const live = thought.since !== null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  // Null until the user clicks: the row follows the thinking.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const seconds = thoughtSeconds(thought, now);
  const label = live ? labels.thinkingFor(seconds) : labels.thoughtFor(seconds);
  const text = thought.text.trim();
  const tailing = chosen === null && live && follow;
  const open = chosen ?? tailing;
  const toggle = () => {
    setChosen(!open);
    if (live) onFollow?.(!open);
  };

  return (
    <div className={`agent-thought${live ? " is-live" : ""}`}>
      {text ? (
        <button
          type="button"
          className="agent-thought-toggle"
          aria-expanded={open}
          onClick={toggle}
        >
          <span className="agent-thought-label">{label}</span>
          <svg
            className="agent-thought-chevron"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
      ) : (
        <span className="agent-thought-label">{label}</span>
      )}
      {open && text && (
        <div className={`agent-thought-text${tailing ? " is-tail" : ""}`}>
          {tailing ? thoughtTail(text) : text}
        </div>
      )}
    </div>
  );
}
