import { useEffect, useState } from "react";

/**
 * What would replace a conversation - New, or one reopened from History -
 * while edits it proposed are still undecided: asked first (the confirm
 * bar), run once the writer goes on; at once with nothing waiting. The one
 * rule for the panel, the AI island and the chat window.
 */
export function useConversationGuard(pending: number) {
  const [waiting, setWaiting] = useState<(() => void) | null>(null);
  // Everything decided meanwhile: nothing left to ask about.
  useEffect(() => {
    if (pending === 0) setWaiting(null);
  }, [pending]);
  return {
    asking: waiting !== null,
    /** Runs `replace` now, or once confirmed. */
    guard: (replace: () => void) => {
      if (pending > 0) setWaiting(() => replace);
      else replace();
    },
    /** Confirmed: what was waiting runs. */
    proceed: () => {
      const run = waiting;
      setWaiting(null);
      run?.();
    },
    cancel: () => setWaiting(null),
  };
}
