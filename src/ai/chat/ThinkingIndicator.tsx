import { useEffect, useState } from "react";

/** The three-dot "thinking" row. Shared with ChatBody's quick variant so the
 *  two chat surfaces can't drift on this markup. */
export function ThinkingIndicator({
  label,
  after = false,
  soon = false,
  waitedFor,
}: {
  label: string;
  /** Under a streaming reply: shows only once it has paused a moment. */
  after?: boolean;
  /** Before anything has come back: shows after a beat. */
  soon?: boolean;
  /** Counts the seconds once nothing has moved for WAIT_SHOWN: a model
   *  that sends no thinking, or a call whose text comes whole, looked
   *  stuck with dots alone (rc.6). The row is re-keyed by each piece of
   *  progress, so it counts from the last one. */
  waitedFor?: (seconds: number) => string;
}) {
  const seconds = useSecondsSince(waitedFor !== undefined);
  return (
    <div
      className={`agent-thinking${after ? " agent-thinking-after" : soon ? " agent-thinking-soon" : ""}`}
    >
      {/* The dots say "still going": the label's own ellipsis would say
          it twice. */}
      <span className="agent-thinking-label">
        {label.replace(TRAILING_DOTS, "")}
      </span>
      <span className="agent-thinking-dots">
        <span />
        <span />
        <span />
      </span>
      {waitedFor && seconds >= WAIT_SHOWN && (
        <span className="agent-thinking-waited">{waitedFor(seconds)}</span>
      )}
    </div>
  );
}

/** A label's closing ellipsis ("Thinking…", "思考中..."). */
const TRAILING_DOTS = /\s*(…|\.\.\.)$/;

/** Seconds of stillness after which the indicator counts them. */
const WAIT_SHOWN = 5;

/** Whole seconds since mount, ticking each second while `on`. */
function useSecondsSince(on: boolean): number {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return Math.floor((now - start) / 1000);
}
