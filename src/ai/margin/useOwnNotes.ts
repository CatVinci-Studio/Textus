import { useEffect, useRef } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { EditorRunner } from "../../editor/useEditorRunner";
import { ownNotes as ownNotesIpc } from "../../platform/ipc";
import { showPrompt } from "../../ui/app-dialog";
import type { Strings } from "../../i18n/strings";
import { useLatest } from "../../utils/hooks/useLatest";
import {
  numberNotes,
  reviewNotesKey,
  type ReviewNote,
} from "./review-notes-plugin";
import { locateOwnNote, parseOwnNotes, storedOwnNote } from "./own-notes";

/** A moment after the last change, the notes are written. */
const WRITE_AFTER = 400;

function setNotes(view: EditorView, notes: ReviewNote[]) {
  view.dispatch(
    view.state.tr.setMeta(reviewNotesKey, {
      type: "set",
      notes: [...notes].sort((a, b) => a.from - b.from),
    }),
  );
}

/**
 * The writer's own notes (`by: "me"`): put in the same margin as the AI's,
 * through the same plugin, which keeps them on their passage as the text
 * changes. Loaded when the document opens, and written beside the app's
 * data a moment after any change - one added, edited or deleted, or its
 * passage edited (own_notes.rs). A new document keeps them in memory until
 * it is saved; one saved under a new name takes them along.
 */
export function useOwnNotes({
  run,
  filePath,
  notes,
  t,
}: {
  run: EditorRunner;
  filePath: string | null;
  /** All the plugin's notes, the AI's too. */
  notes: ReviewNote[];
  t: Strings;
}) {
  // The path the notes in the editor are for: until it is loaded, nothing
  // is written (an empty list would delete the kept file).
  const loadedFor = useRef<string | null>(null);
  const written = useRef<string | null>(null);
  const notesRef = useLatest(notes);

  useEffect(() => {
    if (!filePath || loadedFor.current === filePath) return;
    const ready = run((ctx) => ctx.get(editorViewCtx));
    if (!ready) return;
    // Saved under a new name with notes already on it: they go along.
    if (
      loadedFor.current === null &&
      notesRef.current.some((n) => n.by === "me")
    ) {
      loadedFor.current = filePath;
      return;
    }
    if (loadedFor.current !== null) {
      loadedFor.current = filePath;
      written.current = null;
      return;
    }
    let alive = true;
    void ownNotesIpc
      .read(filePath)
      .catch(() => null)
      .then((text) => {
        if (!alive) return;
        const kept = parseOwnNotes(text);
        run((ctx) => {
          const view = ctx.get(editorViewCtx);
          const current = reviewNotesKey.getState(view.state)?.notes ?? [];
          const placed = kept.flatMap((note) => {
            const range = locateOwnNote(view.state.doc, note);
            return range
              ? [
                  {
                    id: note.id,
                    ...range,
                    comment: note.comment,
                    by: "me" as const,
                  },
                ]
              : [];
          });
          if (placed.length) setNotes(view, numberNotes(current, placed));
        });
        written.current = text;
        loadedFor.current = filePath;
      });
    return () => {
      alive = false;
    };
  }, [filePath, run, notesRef]);

  useEffect(() => {
    if (!filePath || loadedFor.current !== filePath) return;
    const list = run((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc;
      return notes
        .filter((n) => n.by === "me")
        .map((n) => storedOwnNote(doc, n));
    });
    if (!list) return;
    const text = JSON.stringify(list);
    if (text === (written.current ?? "[]")) return;
    const timer = window.setTimeout(() => {
      written.current = text;
      void ownNotesIpc.write(filePath, text).catch(() => {
        written.current = null;
      });
    }, WRITE_AFTER);
    return () => window.clearTimeout(timer);
  }, [filePath, notes, run]);

  /** Asks for a note on the selection - inside its paragraph - and puts it
   *  in the margin. */
  async function addNote() {
    const range = run((ctx) => {
      const { selection } = ctx.get(editorViewCtx).state;
      if (selection.empty) return null;
      const $from = selection.$from;
      if (!$from.parent.isTextblock) return null;
      return { from: selection.from, to: Math.min(selection.to, $from.end()) };
    });
    if (!range || range.from >= range.to) return;
    const comment = (
      await showPrompt(t.ownNotePrompt, "", {
        title: t.ownNoteAdd,
        okLabel: t.ownNoteSave,
        cancelLabel: t.cancel,
      })
    )?.trim();
    if (!comment) return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const current = reviewNotesKey.getState(view.state)?.notes ?? [];
      const id = `me-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      setNotes(
        view,
        numberNotes(current, [{ id, ...range, comment, by: "me" }]),
      );
    });
  }

  /** Changes an own note's words. */
  async function editNote(note: ReviewNote) {
    const comment = (
      await showPrompt(t.ownNotePrompt, note.comment, {
        title: t.ownNoteEditTitle,
        okLabel: t.ownNoteSave,
        cancelLabel: t.cancel,
      })
    )?.trim();
    if (!comment || comment === note.comment) return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const current = reviewNotesKey.getState(view.state)?.notes ?? [];
      setNotes(
        view,
        current.map((n) => (n.id === note.id ? { ...n, comment } : n)),
      );
    });
  }

  return { addNote, editNote };
}
