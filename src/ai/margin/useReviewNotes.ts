import { fill } from "../../i18n/fill";
import { askInComposer } from "../chat/composer-asks";
import { useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorRunner } from "../../editor/useEditorRunner";
import { revealPosition } from "../../editor/reveal-position";
import { reviewNotesKey, type ReviewNote } from "./review-notes-plugin";
import { blockAt, holdBlock } from "../../engine/controls/scroll-hold";
import type { AgentConversation } from "../chat/conversation/conversation-types";
import type { AgentPanelFrame } from "../chat/panel/agent-panel";
import { type usePendingEdits } from "../revision/usePendingEdits";
import { locateTarget } from "../revision/pending-place";
import { pendingEditKey } from "../revision/pending-types";
import type { RevisionDisplay } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import { useNotesBar } from "./useNotesBar";
import {
  useConversationNotes,
  useHotItem,
  useLitItem,
  useNoteCallbacks,
  useNotes,
  useOwnWork,
} from "./useReviewNoteParts";
import { OWN_CHANGES } from "./own-revision-plugin";
import { duration } from "../../engine/motion/motion";
import { noteOfAnchor } from "./review-notes-plugin";

/** Review notes, the AI's and the writer's own, until done or cleared; also
 *  the margin's revision cards, which share their hover. */
export function useReviewNotes({
  isActive,
  run,
  reviewNotesRef,
  noMarginRef,
  conversation,
  quickConversation,
  pendingEdits,
  revisionDisplay,
  agentPanel,
  t,
  showAiNotice,
  filePath,
}: {
  /** The document on screen: the one Track My Changes' menu acts on. */
  isActive: boolean;
  run: EditorRunner;
  /** The document's file, whose own notes are kept for it. */
  filePath: string | null;
  /** The plugin's ref-indirected callbacks. */
  reviewNotesRef: {
    current: {
      onChange: (notes: ReviewNote[]) => void;
      onBadge: (id: string, el: HTMLElement) => void;
    };
  };
  noMarginRef: { current: boolean };
  conversation: AgentConversation;
  quickConversation: AgentConversation;
  pendingEdits: ReturnType<typeof usePendingEdits>;
  revisionDisplay: RevisionDisplay;
  agentPanel: AgentPanelFrame;
  t: Strings;
  showAiNotice: (message: string | null) => void;
}) {
  const { notes, setNotes, notesRef } = useNotes();
  // Behind numbered badges (no room for a margin): the chat's note cards
  // then carry the same numbers.
  const [noMargin, setNoMargin] = useState(false);
  const { hotNote, hotRef, setNoteHot } = useHotItem();
  const [openNote, setOpenNote] = useNoteCallbacks(reviewNotesRef, setNotes);
  const { editorView, doneNotes } = useConversationNotes(
    run,
    conversation,
    quickConversation,
  );

  /** The pointer moving over the document: lights up the note or pending
   *  sentence under it, together with its margin card. */
  function hoverNotes(target: HTMLElement) {
    // The margin's cards are portaled out but bubble here: they set their
    // own hover.
    if (target.closest?.(".review-note")) return;
    const anchor = target.closest?.(".review-anchor") as HTMLElement | null;
    const sentence = target.closest?.(
      "[data-call][data-index]",
    ) as HTMLElement | null;
    const note = anchor && noteOfAnchor(anchor, notes);
    const key = note
      ? `note:${note}`
      : sentence?.dataset.call
        ? `rev:${sentence.dataset.call}:${sentence.dataset.index}`
        : null;
    if (key !== hotRef.current) setNoteHot(key);
  }

  function doneNote(id: string) {
    doneNotes.current.add(id);
    setOpenNote(null);
    setNoteHot(null);
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(
        view.state.tr.setMeta(reviewNotesKey, { type: "remove", id }),
      );
    });
  }

  // "Ask about it": into the AI panel's composer, the note quoted, for the
  // writer to finish the question.
  function askAboutNote(note: ReviewNote) {
    askInPanel(fill(t.reviewNoteAskPrefix, { comment: note.comment }));
  }

  // The notes bar's picked notes, asked about together.
  function askAboutNotes(picked: ReviewNote[]) {
    if (picked.length === 1) return askAboutNote(picked[0]);
    askInPanel(
      fill(t.reviewNotesAskPrefix, {
        notes: picked.map((n) => `“${n.comment}”`).join("\n"),
      }),
    );
  }

  const { own, revisions } = useOwnWork({ isActive, run, filePath, notes, t });

  const bar = useNotesBar({
    notes,
    run,
    // By its key: the stop object is made again as the previews change.
    revisionFocus: pendingEdits.focusedStop
      ? `${pendingEdits.focusedStop.callId}:${pendingEdits.focusedStop.index}`
      : null,
    onDone: doneNote,
    onAsk: askAboutNotes,
  });

  // `text` into the AI panel's composer, the caret after it.
  function askInPanel(text: string) {
    setOpenNote(null);
    agentPanel.setOpen(true);
    void askInComposer(text);
  }

  // No room for a margin: notes go behind badges and a rewrite's
  // replacements back into the text.
  function onNoMargin(next: boolean) {
    if (next === noMarginRef.current) return;
    noMarginRef.current = next;
    setNoMargin(next);
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const redraw = () => {
        view.dispatch(
          view.state.tr.setMeta(reviewNotesKey, {
            type: "compact",
            compact: next,
          }),
        );
        view.dispatch(
          view.state.tr.setMeta(pendingEditKey, { type: "refocus" }),
        );
      };
      // The text reflows: keep the first block wholly on screen still, not
      // the one the top edge cuts, which may be the one reflowing.
      const scroller = view.dom.closest<HTMLElement>(".editor-scroll");
      const top = scroller?.getBoundingClientRect().top ?? 0;
      const under = blockAt(view.dom, top);
      const block =
        under && under.getBoundingClientRect().top < top
          ? (under.nextElementSibling ?? under)
          : under;
      if (scroller && block)
        holdBlock(scroller, block, block.getBoundingClientRect().top, redraw);
      else redraw();
    });
    if (!next) setOpenNote(null);
  }

  // A comment card's "Show in document": select the passage and bring it
  // into view, so the feedback can be read against the text it is about.
  function locateText(anchor: string, block?: string) {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const range = locateTarget(ctx, view.state.doc, { block, anchor });
      if (!range) {
        showAiNotice(t.commentNotFound);
        return;
      }
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, range.from, range.to),
        ),
      );
      view.focus();
      revealPosition(view, range.from);
      // Its note in the margin lights up with it for a moment.
      const note = notesRef.current.find(
        (n) => n.from < range.to && range.from < n.to,
      );
      if (note) {
        setNoteHot(`note:${note.id}`);
        window.setTimeout(() => setNoteHot(null), duration("--dur-linger"));
      }
    });
  }

  // A card's ✓ / ✕: the writer's own change, or the AI's sentence.
  function decide(callId: string, index: number, take: boolean | null) {
    if (callId === OWN_CHANGES) revisions.decide(index, take);
    else pendingEdits.decide(callId, index, take);
  }

  const { marginItems, focusedItem, lit, setClicked, pointed } = useLitItem({
    run,
    notes,
    pendingEdits,
    revisionDisplay,
    ownChanges: revisions.changes,
    barFocus: bar.focusedItem,
    hotNote,
  });

  // A card clicked: selected, and its passage brought into view and
  // pulsed, so the eye goes from the note to what it is about.
  function selectCard(key: string | null) {
    setClicked(key ? { key, over: pointed } : null);
    const item = key ? marginItems.find((i) => i.key === key) : undefined;
    // A change of the writer's own has no card in the inline view.
    const from = item
      ? item.kind === "note"
        ? item.note.from
        : item.from
      : revisions.changes?.find((c) => `rev:${OWN_CHANGES}:${c.index}` === key)
          ?.from;
    if (from === undefined) return;
    run((ctx) => revealPosition(ctx.get(editorViewCtx), from));
  }

  const openNoteData = openNote
    ? (notes.find((n) => n.id === openNote.id) ?? null)
    : null;

  return {
    notes,
    noMargin,
    hotNote: lit,
    focusedItem,
    selectCard,
    openNote,
    setOpenNote,
    openNoteData,
    editorView,
    marginItems,
    setNoteHot,
    hoverNotes,
    doneNote,
    askAboutNote,
    addNote: own.addNote,
    editNote: own.editNote,
    decide,
    revisions,
    /** The editor menu's own items. */
    menu: {
      addNote: () => void own.addNote(),
      ownChanges: revisions.changes?.length ? revisions : undefined,
    },
    onNoMargin,
    locateText,
    bar,
  };
}
