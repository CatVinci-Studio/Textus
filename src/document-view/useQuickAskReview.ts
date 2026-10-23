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

/** Quick Ask's nav bar (Next/Previous/Accept/Reject over the pending
 *  edits): each step selects the edit, scrolls to it and moves the zone
 *  widget along, and gives the focus back where review-focus.ts says. */
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
  /** iPad: whether the editor had focus at the last press anywhere in the
   *  page - see editorFocusedBeforeAction. */
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

  /** Scrolls to a pending edit and, while Quick Ask is the active surface,
   *  moves its zone widget to follow - the direct, synchronous result of a
   *  nav-bar click (Next/Previous/Accept/Reject), never a background
   *  reaction to something else changing (see the call sites below).
   *  `editorHadFocus`: whether the editor had focus when the step began
   *  (by default: now, or at the press that started it). */
  function revealPreview(
    preview: PendingPreview,
    editorHadFocus = editorHadFocusBeforeAction(),
    arriving = false,
  ) {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { doc } = view.state;
      // Edits arriving mid-answer, the first already on screen: the panel
      // stays where it is. Moved to the edit's block, it jumped from under
      // the selection to above it in one frame and pushed the text down.
      const stay = arriving && !phone && previewOnScreen(view, preview.from);
      // near(), not create(): an anchored proposal's `from` is the position
      // BEFORE a block node, which is not a valid text position - create()
      // throws there. near() snaps to the closest one it can select.
      let tr = view.state.tr.setSelection(
        TextSelection.near(doc.resolve(preview.from)),
      );
      if (!stay) tr = tr.scrollIntoView();
      if (inlineChat.visible && !phone && !stay) {
        tr = setQuickAskWidget(tr, blockPositionAfter(doc, preview.from));
      }
      view.dispatch(tr);
      // Docked on a phone, the panel covers the bottom of the scroll area
      // that scrollIntoView counted as visible.
      if (inlineChat.visible && phone) {
        requestAnimationFrame(() => keepClearOfDock(view, preview.from, true));
      }
      // Back into the document, except out of a text field, on a phone, or
      // on an iPad whose user wasn't typing in it (review-focus.ts).
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

  // Accept/reject-focused change WHICH preview is decidable (not just the
  // pointer within a fixed set, unlike Next/Previous above), so where the
  // pointer lands next depends on usePendingEdits' own reindex effect
  // running first - there's no new preview to reveal synchronously here.
  // `revealArmed` bridges that one-render gap: armed right before the
  // action, consumed by the effect below once `focusedPreview` actually
  // updates. The same flag is armed once per batch of edits arriving (0 ->
  // >0 pending), so the first edit is revealed without the user having to
  // click Next first - after that, only an explicit nav/decide action moves
  // the panel again (see [[ui-no-auto-jump-preference]]).
  const revealArmed = useRef(false);
  /** Whether the editor had focus when the Accept/Reject that armed the
   *  reveal was pressed - by the time the reveal runs, a render later, that
   *  is history - and when. Null when edits arriving armed it. */
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
        // The press that armed it, if it was just now; otherwise (edits
        // arriving, or an arming that never led to a reveal until much
        // later) nobody pressed anything for this reveal - only whether
        // the editor has focus now counts.
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
