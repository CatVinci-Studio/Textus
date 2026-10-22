/**
 * The time a reply spent thinking, and what the provider let us read of it -
 * the "Thinking · 8 seconds" row above a reply (ThoughtRow). An exchange can
 * think more than once (before each tool step), so the row adds the phases
 * up: a phase starts with the first thinking event and ends with the first
 * event that isn't one (prose, a tool call, a landed turn). Kept for the
 * session only, never in the saved conversation.
 */
export interface Thought {
  /** Readable reasoning, as streamed; empty where the provider shows none. */
  text: string;
  /** Milliseconds of the phases already over. */
  ms: number;
  /** When the phase in progress started (Date.now()), or null between
   *  phases and once the exchange is done. */
  since: number | null;
}

/** A thinking event: start a phase if none is running, add its text. */
export function thinkingEvent(
  thought: Thought | null,
  text: string,
  now: number,
): Thought {
  const prev = thought ?? { text: "", ms: 0, since: null };
  return { text: prev.text + text, ms: prev.ms, since: prev.since ?? now };
}

/** Any other event, or the end of the exchange: close the running phase. */
export function thinkingDone(
  thought: Thought | null,
  now: number,
): Thought | null {
  if (!thought || thought.since === null) return thought;
  return { ...thought, ms: thought.ms + (now - thought.since), since: null };
}

/** Whole seconds thought so far - at least 1, so a short think doesn't
 *  read "0 seconds". */
export function thoughtSeconds(thought: Thought, now: number): number {
  const ms = thought.ms + (thought.since === null ? 0 : now - thought.since);
  return Math.max(1, Math.round(ms / 1000));
}

/** The live tail of a thought: its last few lines, at most `chars` long, so
 *  a long think shows where it is now without growing the panel (or the
 *  DOM) with all of it. Cut at a word where it can be. */
export function thoughtTail(text: string, lines = 4, chars = 360): string {
  const kept = text
    .split("\n")
    .filter((line) => line.trim())
    .slice(-lines)
    .join("\n");
  if (kept.length <= chars) return kept;
  const cut = kept.slice(kept.length - chars);
  const space = cut.search(/\s/);
  return "…" + (space >= 0 && space < 40 ? cut.slice(space + 1) : cut);
}
