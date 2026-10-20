import { useEffect, useMemo, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { EditorRunner } from "../../editor/useEditorRunner";
import { revealPosition } from "../../editor/reveal-position";
import {
  commentCalls,
  numberNotes,
  reviewNotesKey,
  type ReviewNote,
} from "./review-notes-plugin";
import type { MarginItem } from "./ReviewMargin";
import { setMarginAvailable } from "./margin-room";
import { blockAt, holdBlock } from "../../ui/hold-line";
import type { AgentConversation } from "../chat/useAgentConversation";
import type { AgentPanelFrame } from "../chat/panel/agent-panel";
import {
  locateAnchor,
  type usePendingEdits,
} from "../revision/usePendingEdits";
import {
  pendingEditKey,
  reviewChanges,
  type HotSentence,
  type PendingPreview,
  type PendingSentence,
} from "../revision/pending-edit-plugin";
import type { RevisionDisplay } from "../../settings/SettingsContext";
import type { Strings } from "../../i18n/strings";
import { useLatest } from "../../utils/hooks/useLatest";

/** A proposal shown whole as a margin card's change: what it replaces and
 *  with what. Null for new text alone, which has no original. */
function wholeChange(p: PendingPreview): PendingSentence | null {
  const { action, anchor, text } = p.proposal;
  if (
    action !== "replace" &&
    action !== "replace_selection" &&
    action !== "delete"
  )
    return null;
  return {
    from: p.strikeFrom ?? p.from,
    to: p.strikeTo ?? p.to,
    before: anchor ?? p.expectedText,
    after: action === "delete" ? "" : (text ?? ""),
    take: null,
  };
}

/** Review notes (review-notes-plugin.ts, ReviewMargin.tsx): every
 *  add_comment of this tab's conversations, pinned to its passage and
 *  drawn in the margin - until it is marked done, or its conversation is
 *  cleared. Also the margin's revision cards, which share its hover. */
export function useReviewNotes({
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
}: {
  run: EditorRunner;
  /** The plugin's ref-indirected callbacks (see useTextusEditor). */
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
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const notesRef = useLatest(notes);
  // Behind numbered badges (no room for a margin): the chat's note cards
  // then carry the same numbers.
  const [noMargin, setNoMargin] = useState(false);
  const [hotNote, setHotNote] = useState<string | null>(null);
  // The same, at once: two pointer events can land before a render.
  const hotRef = useRef<string | null>(null);
  const [openNote, setOpenNote] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const doneNotes = useRef(new Set<string>());
  const lostNotes = useRef(new Set<string>());
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  useEffect(() => {
    reviewNotesRef.current = {
      onChange: setNotes,
      onBadge: (id, el) => {
        const r = el.getBoundingClientRect();
        setOpenNote({ id, x: r.left, y: r.bottom + 6 });
      },
    };
  }, [reviewNotesRef]);
  const panelTurns = conversation.streaming?.turns;
  const quickTurns = quickConversation.streaming?.turns;
  const comments = useMemo(
    () =>
      commentCalls([
        ...conversation.history,
        ...(panelTurns ?? []),
        ...quickConversation.history,
        ...(quickTurns ?? []),
      ]),
    [conversation.history, panelTurns, quickConversation.history, quickTurns],
  );
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      setEditorView(view);
      const current = reviewNotesKey.getState(view.state)?.notes ?? [];
      const wanted = comments.filter((c) => !doneNotes.current.has(c.id));
      const keep = current.filter((n) => wanted.some((w) => w.id === n.id));
      const added: Omit<ReviewNote, "num">[] = [];
      for (const c of wanted) {
        if (keep.some((n) => n.id === c.id) || lostNotes.current.has(c.id))
          continue;
        const range = locateAnchor(ctx, view.state.doc, c.anchor, c.context);
        if (!range || range.from >= range.to) {
          lostNotes.current.add(c.id);
          continue;
        }
        added.push({ id: c.id, ...range, comment: c.comment });
      }
      if (added.length === 0 && keep.length === current.length) return;
      view.dispatch(
        view.state.tr.setMeta(reviewNotesKey, {
          type: "set",
          notes: numberNotes(keep, added).sort((a, b) => a.from - b.from),
        }),
      );
    });
  }, [comments, run]);

  // What the pointer is on - a margin card or its passage ("note:<id>",
  // "rev:<callId>:<index>"): both light up together.
  function setNoteHot(key: string | null) {
    hotRef.current = key;
    setHotNote(key);
    const id = key?.startsWith("note:") ? key.slice(5) : null;
    let sentence: HotSentence | null = null;
    if (key?.startsWith("rev:")) {
      const [, callId, index] = key.split(":");
      sentence = { callId, index: Number(index) };
    }
    // Through the plugins, never a class written onto the text: see
    // pending-edit-plugin's hotDecorations.
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(
        view.state.tr
          .setMeta(reviewNotesKey, { type: "hot", id })
          .setMeta(pendingEditKey, { type: "hot", sentence }),
      );
    });
  }

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
    const key = anchor?.dataset.note
      ? `note:${anchor.dataset.note}`
      : sentence?.dataset.call
        ? `rev:${sentence.dataset.call}:${sentence.dataset.index}`
        : null;
    if (key !== hotRef.current) setNoteHot(key);
  }

  function doneNote(id: string) {
    doneNotes.current.add(id);
    setOpenNote(null);
    hotRef.current = null;
    setHotNote(null);
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
    setOpenNote(null);
    agentPanel.setOpen(true);
    const text = t.reviewNoteAskPrefix.replace("{comment}", note.comment);
    window.setTimeout(() => {
      const box = document.querySelector<HTMLTextAreaElement>(
        ".agent-panel-view textarea",
      );
      if (!box) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(box, text);
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.focus();
      box.setSelectionRange(text.length, text.length);
    }, 60);
  }

  // No room for a margin: notes go behind badges and a rewrite's
  // replacements back into the text.
  function onNoMargin(next: boolean) {
    setMarginAvailable(!next);
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
      // Sentences moving into or out of the text reflow it: the first
      // block wholly on screen stays put rather than the page jumping
      // under the reader as a panel opens or closes. (Not the block the
      // top edge cuts: that may be the very paragraph that reflows.)
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
  function locateText(anchor: string, context?: string) {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const range = locateAnchor(ctx, view.state.doc, anchor, context);
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
        window.setTimeout(() => setNoteHot(null), 1600);
      }
    });
  }

  // The margin's items: the notes, then each pending sentence numbered in
  // the review bar's order - or a proposal shown whole, as one card (index
  // -1). New text alone (Write) has no original to set beside it: it stays
  // in the text, and gets no card.
  const marginItems = useMemo<MarginItem[]>(() => {
    const items: MarginItem[] = notes.map((note) => ({
      kind: "note",
      key: `note:${note.id}`,
      note,
    }));
    const display = revisionDisplay;
    pendingEdits.reviewStops.forEach((stop, i) => {
      if (display !== "original" && display !== "new") return;
      const preview = pendingEdits.reviewed.find(
        (p) => p.callId === stop.callId,
      );
      if (!preview) return;
      const c =
        stop.index < 0
          ? wholeChange(preview)
          : reviewChanges(preview)?.[stop.index];
      if (!c) return;
      items.push({
        kind: "revision",
        key: `rev:${stop.callId}:${stop.index}`,
        callId: stop.callId,
        index: stop.index,
        num: i + 1,
        from: c.from,
        to: c.to,
        after: c.after,
        before: c.before,
        shows: display,
        take: c.take,
        streaming: !!preview.streaming,
      });
    });
    return items;
  }, [notes, pendingEdits.reviewStops, pendingEdits.reviewed, revisionDisplay]);

  // The margin card of the sentence the review bar points at.
  const { focusedStop } = pendingEdits;
  const focusedItem = focusedStop
    ? `rev:${focusedStop.callId}:${focusedStop.index}`
    : null;

  const openNoteData = openNote
    ? (notes.find((n) => n.id === openNote.id) ?? null)
    : null;

  return {
    notes,
    noMargin,
    hotNote,
    focusedItem,
    openNote,
    setOpenNote,
    openNoteData,
    editorView,
    marginItems,
    setNoteHot,
    hoverNotes,
    doneNote,
    askAboutNote,
    onNoMargin,
    locateText,
  };
}
