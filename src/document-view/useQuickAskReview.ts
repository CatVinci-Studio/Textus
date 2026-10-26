import { useCallback, useEffect, useRef } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { EditorRunner } from "../editor/useEditorRunner";
import {
  editorFocusedBeforeAction,
  PRESS_WINDOW_MS,
  refocusAfterReview,
} from "../editor/review-focus";
import type { PendingEdits } from "./useEditorProposals";
import {
  blockPositionAfter,
  type useInlineChat,
} from "../ai/chat/quick-ask/useInlineChat";
import { setQuickAskWidget } from "../ai/chat/quick-ask/quick-ask-widget-plugin";
import { keepClearOfDock } from "../ai/chat/quick-ask/quick-ask-dock";
import type { PendingPreview } from "../ai/revision/pending-edit-plugin";
import { isIOSApp } from "../platform/capabilities";

/** Whether document position `pos` shows inside its editor's scroller. */
function previewOnScreen(view: EditorView, pos: number): boolean {
  const scroller = view.dom.closest(".editor-scroll");
  if (!scroller) return false;
  try {
    const at = view.coordsAtPos(Math.min(pos + 1, view.state.doc.content.size));
    const box = scroller.getBoundingClientRect();
    return at.top >= box.top && at.bottom <= box.bottom;
  } catch {
    return false;
  }
}

/** Quick Ask's nav bar over the pending edits: each step selects the edit,
 *  scrolls to it, moves the zone widget along and restores the focus. */
export function useQuickAskReview({
  run,
  pendingEdits,
  inlineChat,
  phone,
  isActive,
}: {
  run: EditorRunner;
  pendingEdits: PendingEdits;
  inlineChat: ReturnType<typeof useInlineChat>;
  phone: boolean;
  isActive: boolean;
}) {
  /** iPad: whether the editor had focus at the last press anywhere. */
  const focusAtPress = useRef<{ focused: boolean; at: number } | null>(null);
  const editorHasFocus = useCallback(
    () => run((ctx) => ctx.get(editorViewCtx).hasFocus()) === true,
    [run],
  );
  useEffect(() => {
    // The active tab's editor only: the others take no review steps.
    if (!isIOSApp || phone || !isActive) return;
    const record = () => {
      focusAtPress.current = { focused: editorHasFocus(), at: Date.now() };
    };
    // Capture, so it runs before the press can move the focus anywhere.
    window.addEventListener("pointerdown", record, true);
    return () => window.removeEventListener("pointerdown", record, true);
  }, [phone, isActive, editorHasFocus]);
  function editorHadFocusBeforeAction(): boolean {
    return editorFocusedBeforeAction(
      editorHasFocus(),
      focusAtPress.current,
      Date.now(),
    );
  }

  /** Scrolls to a pending edit and moves Quick Ask's zone widget to follow;
   *  only ever the direct result of a nav-bar click. `editorHadFocus`
   *  defaults to now, or the press that started the step. */
  function revealPreview(
    preview: PendingPreview,
    editorHadFocus = editorHadFocusBeforeAction(),
    arriving = false,
  ) {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { doc } = view.state;
      // Edits arriving mid-answer, the first already on screen: the panel
      // stays put rather than jumping above the selection.
      const stay = arriving && !phone && previewOnScreen(view, preview.from);
      // near(), not create(): an anchored proposal's `from` sits before a
      // block node, where create() throws.
      let tr = view.state.tr.setSelection(
        TextSelection.near(doc.resolve(preview.from)),
      );
      if (!stay) tr = tr.scrollIntoView();
      if (inlineChat.visible && !phone && !stay) {
        tr = setQuickAskWidget(tr, blockPositionAfter(doc, preview.from));
      }
      view.dispatch(tr);
      // Docked on a phone, the panel covers the bottom of the scroll area.
      if (inlineChat.visible && phone) {
        requestAnimationFrame(() => keepClearOfDock(view, preview.from, true));
      }
      // Back into the document, except out of a text field, on a phone, or
      // on an iPad whose user wasn't typing in it.
      const active = document.activeElement;
      if (
        refocusAfterReview({
          phone,
          ios: isIOSApp,
          editorHadFocus,
          textFieldFocused:
            active instanceof HTMLTextAreaElement ||
            active instanceof HTMLInputElement,
        })
      )
        view.focus();
    });
  }

  function handleFocusNext() {
    const preview = pendingEdits.focusNext();
    if (preview) revealPreview(preview);
  }

  function handleFocusPrevious() {
    const preview = pendingEdits.focusPrevious();
    if (preview) revealPreview(preview);
  }

  // Accept/Reject change which preview is decidable, so the next one is
  // known only after usePendingEdits reindexes. `revealArmed` bridges that
  // render; it is also armed when a batch of edits arrives, so the first is
  // revealed without a click. Nothing else moves the panel.
  const revealArmed = useRef(false);
  /** Whether the editor had focus when the Accept/Reject that armed the
   *  reveal was pressed, and when. Null when arriving edits armed it. */
  const revealArmedFocus = useRef<{ focused: boolean; at: number } | null>(
    null,
  );
  const hadPendingRef = useRef(false);
  useEffect(() => {
    const hasPending = pendingEdits.decidable.length > 0;
    if (hasPending && !hadPendingRef.current) {
      revealArmed.current = true;
      revealArmedFocus.current = null;
    }
    hadPendingRef.current = hasPending;
  }, [pendingEdits.decidable.length]);
  // This render's way to reveal; the pointer moving is what it waits for.
  const { focusedPreview } = pendingEdits;
  const reveal = useLatest({ revealPreview, editorHasFocus });
  useEffect(() => {
    if (!revealArmed.current) return;
    revealArmed.current = false;
    const armed = revealArmedFocus.current;
    revealArmedFocus.current = null;
    if (focusedPreview)
      reveal.current.revealPreview(
        focusedPreview,
        // The press that armed it, if recent; otherwise only whether the
        // editor has focus now counts.
        armed && Date.now() - armed.at < PRESS_WINDOW_MS
          ? armed.focused
          : reveal.current.editorHasFocus(),
        armed === null,
      );
  }, [focusedPreview, reveal]);

  function armReveal() {
    revealArmed.current = true;
    revealArmedFocus.current = {
      focused: editorHadFocusBeforeAction(),
      at: Date.now(),
    };
  }

  function handleAcceptFocused() {
    armReveal();
    pendingEdits.acceptFocused();
  }

  function handleRejectFocused() {
    armReveal();
    pendingEdits.rejectFocused();
  }

  return {
    handleFocusNext,
    handleFocusPrevious,
    handleAcceptFocused,
    handleRejectFocused,
  };
}
