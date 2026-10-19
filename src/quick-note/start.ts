import type {
  QuickNoteSession,
  QuickNoteStamp,
  QuickNoteTarget,
} from "../platform/ipc";

/** What the window opens with. */
export type QuickNoteStart =
  | { kind: "blank" }
  /** What was being typed when the window last went away without saving
   *  (a crash, a forced quit) - the note it was continuing included. */
  | { kind: "draft"; text: string; target: QuickNoteTarget | null }
  /** The note saved a moment ago, to go on with. */
  | { kind: "continue"; text: string; target: QuickNoteTarget };

/**
 * A draft first: it is unsaved writing. Then the last note, when it was
 * saved within the last `continueMinutes` (0: never) and is the same kind
 * of note the setting asks for now - an entry of a day's file, or a file of
 * its own; switching the setting starts afresh. Otherwise a blank note.
 */
export function chooseStart(
  session: QuickNoteSession,
  nowMs: number,
  continueMinutes: number,
  perDay: boolean,
): QuickNoteStart {
  const { draft, last } = session;
  if (draft && draft.text.trim())
    return { kind: "draft", text: draft.text, target: draft.target };
  if (!last || continueMinutes <= 0) return { kind: "blank" };
  const age = nowMs - last.savedAtMs;
  // A clock set back reads as a future save: not "a moment ago".
  if (age < 0 || age > continueMinutes * 60_000) return { kind: "blank" };
  if ((last.heading !== null) !== perDay) return { kind: "blank" };
  return {
    kind: "continue",
    text: last.text,
    target: { path: last.path, heading: last.heading, base: last.text },
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The user's wall clock as Rust wants it for names and headings (it has
 *  no time zone of its own - naming.rs's Stamp). */
export function localStamp(date: Date): QuickNoteStamp {
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}
