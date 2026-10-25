import { useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../../editor/useEditorRunner";
import { revealPosition } from "../../editor/reveal-position";
import type { ReviewNote } from "./review-notes-plugin";

/**
 * The notes bar's state (NotesBar.tsx): the note it points at, stepped
 * through in the order of the text, and the notes picked to ask about
 * together. The note pointed at holds only until the review bar points at
 * a revision (`revisionFocus` changes): the margin opens one card at a
 * time.
 */
export function useNotesBar({
  notes,
  run,
  revisionFocus,
  onDone,
  onAsk,
}: {
  notes: ReviewNote[];
  run: EditorRunner;
  /** The review bar's own pointer, whatever it is: a new one takes over. */
  revisionFocus: unknown;
  onDone: (id: string) => void;
  /** Into the AI panel's composer, for the writer to finish. */
  onAsk: (picked: ReviewNote[]) => void;
}) {
  const [pointer, setPointer] = useState<{
    id: string;
    over: unknown;
  } | null>(null);
  // Null while not picking.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const ordered = [...notes].sort((a, b) => a.from - b.from);
  const focused =
    pointer &&
    pointer.over === revisionFocus &&
    notes.some((n) => n.id === pointer.id)
      ? pointer.id
      : null;

  function step(by: 1 | -1) {
    if (ordered.length === 0) return;
    const at = ordered.findIndex((n) => n.id === focused);
    const next =
      at < 0
        ? by > 0
          ? 0
          : ordered.length - 1
        : (at + by + ordered.length) % ordered.length;
    const note = ordered[next];
    setPointer({ id: note.id, over: revisionFocus });
    run((ctx) => revealPosition(ctx.get(editorViewCtx), note.from));
  }

  function togglePick(id: string) {
    if (!picked) return;
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    setPicked(next);
  }

  return {
    count: ordered.length,
    /** Where the pointer is among the notes, -1 before the first step. */
    position: ordered.findIndex((n) => n.id === focused),
    /** The key of the note's card it points at, for the margin. */
    focusedItem: focused ? `note:${focused}` : null,
    step,
    /** Every AI note marked done. The writer's own notes stay: each is
     *  deleted on its card. */
    allDone() {
      for (const note of ordered) if (note.by !== "me") onDone(note.id);
      setPointer(null);
      setPicked(null);
    },
    picked,
    startPicking: () => setPicked(new Set()),
    stopPicking: () => setPicked(null),
    togglePick,
    askPicked() {
      if (!picked) return;
      const chosen = ordered.filter((n) => picked.has(n.id));
      setPicked(null);
      if (chosen.length > 0) onAsk(chosen);
    },
  };
}

export type NotesBarState = ReturnType<typeof useNotesBar>;
