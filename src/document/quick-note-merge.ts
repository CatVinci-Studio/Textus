import { toEditorText } from "./file-format";

// A quick note written to a file a tab here has open (src/quick-note/,
// src-tauri/src/commands/quick_note/): what the tab does about it. Never
// overwrite either side silently - a tab with unsaved edits takes the note
// in only when that is unambiguous, and otherwise the save-time conflict
// prompt says a quick note is at stake (useSaveTabs.ts).

/** `existing` with `block` added at the end, one blank line between them.
 *  Mirrors join_entry in src-tauri/src/commands/quick_note/naming.rs, which
 *  wrote the same block to the file - keep the two the same. */
export function joinEntry(existing: string, block: string): string {
  const kept = existing.trimEnd();
  return kept ? `${kept}\n\n${block}` : block;
}

export type QuickNoteSync =
  /** The file reads as the tab last saved it: nothing to take in. */
  | { kind: "unchanged" }
  /** No unsaved edits here: the tab simply shows the file again. */
  | { kind: "reload" }
  /** Unsaved edits, and the file only gained an entry at its end: the
   *  same entry goes at the end of the tab, which stays unsaved. */
  | { kind: "merge"; content: string; savedContent: string }
  /** Unsaved edits, and the file changed in some other way: left for the
   *  save-time prompt, which names the note. */
  | { kind: "conflict" };

/** What a tab with `content` (as typed) and `savedContent` (as last read or
 *  saved) does about a quick note that left its file reading `after` -
 *  with `entry` added at the end, when that was all it did. */
export function syncWithQuickNote(
  tab: { content: string; savedContent: string },
  written: { after: string; entry: string | null },
): QuickNoteSync {
  const after = toEditorText(written.after);
  if (after === tab.savedContent) return { kind: "unchanged" };
  if (tab.content === tab.savedContent) return { kind: "reload" };
  // The file is exactly what this tab saved plus the entry: disk == saved
  // + appended. Anything else means the file moved on in a way this tab
  // can't account for.
  if (written.entry !== null) {
    const entry = toEditorText(written.entry);
    if (joinEntry(tab.savedContent, entry) === after)
      return {
        kind: "merge",
        content: joinEntry(tab.content, entry),
        savedContent: after,
      };
  }
  return { kind: "conflict" };
}

/** The first words of a note, for the conflict prompt. */
export function notePreview(text: string, max = 80): string {
  const plain = text
    .replace(/^#{1,6}\s+\d{1,2}:\d{2}\s*/m, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
