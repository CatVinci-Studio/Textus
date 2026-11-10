import { useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../../editor/useEditorRunner";
import { revealPosition } from "../../editor/reveal-position";
import type { ReviewNote } from "./review-notes-plugin";

/** The notes bar's state: the note it points at and the notes picked. The
 *  pointer yields when the review bar's changes, as one card opens at a time. */
export function useNotesBar({
  notes,
  run,
  revisionFocus,
  onDone,
  onAsk,
}: {
  notes: ReviewNote[];
  run: EditorRunner;
  /** The review bar's own pointer, by its key: a new one takes over. */
  revisionFocus: string | null;
  onDone: (id: string) => void;
  /** Into the AI panel's composer, for the writer to finish. */
  onAsk: (picked: ReviewNote[]) => void;
}) {
  const [pointer, setPointer] = useState<{
    id: string;
    over: string | null;
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

  /** Points at note `id` and brings it into view. */
  function pointAt(id: string) {
    const note = ordered.find((n) => n.id === id);
    if (!note) return;
    setPointer({ id, over: revisionFocus });
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
    /** The notes, top to bottom. */
    ordered,
    pointAt,
    /** The bar moved off the notes (to a change): none pointed at. */
    clearPointer: () => setPointer(null),
    /** Where the pointer is among the notes, -1 before the first step. */
    position: ordered.findIndex((n) => n.id === focused),
    /** The key of the note's card it points at, for the margin. */
    focusedItem: focused ? `note:${focused}` : null,
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
