import { useEffect, useState } from "react";
import { thoughtSeconds, type Thought } from "./thought";

export interface ThoughtRowLabels {
  /** "Thinking · {n} seconds", while the model thinks. */
  thinkingFor: (seconds: number) => string;
  /** "Thought for {n} seconds", once it has. */
  thoughtFor: (seconds: number) => string;
}

/**
 * One grey line above a reply: how long the model is thinking, then thought.
 * It opens on readable reasoning where the provider streams it. Starts
 * closed: open on streaming reasoning, it would jump with every piece.
 */
export function ThoughtRow({
  thought,
  labels,
}: {
  thought: Thought;
  labels: ThoughtRowLabels;
}) {
  const live = thought.since !== null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  const [open, setOpen] = useState(false);
  const seconds = thoughtSeconds(thought, now);
  const label = live ? labels.thinkingFor(seconds) : labels.thoughtFor(seconds);
  const text = thought.text.trim();

  return (
    <div className={`agent-thought${live ? " is-live" : ""}`}>
      {text ? (
        <button
          type="button"
          className="agent-thought-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
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
      {open && text && <div className="agent-thought-text">{text}</div>}
    </div>
  );
}
