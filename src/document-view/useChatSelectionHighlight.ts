import { useCallback, useEffect, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { useInlineChat } from "../ai/chat/quick-ask/useInlineChat";
import type {
  SelectionChip,
  SelectionChipHandlers,
} from "../ai/chat/ChatComposer";
import {
  chatSelectionRange,
  setChatSelection,
  setChatSelectionHot,
} from "../ai/chat/quick-ask/chat-selection-plugin";
import { revealPosition } from "../editor/reveal-position";

type Range = { from: number; to: number };

const HIDDEN: SelectionChip = { shown: false, hot: false };

/**
 * Keeps the passage a chat is about highlighted in the document
 * (chat-selection-plugin) for as long as its composer shows the selection
 * chip: Quick Ask's captured range while its panel is on screen, else the
 * live selection the AI panel's or the chat window's chip refers to - that
 * one only while the editor doesn't have the focus, since the selection
 * shows itself there. The chip going away (✕, a send that used the
 * selection, the selection collapsing, another tab) clears it.
 *
 * Returns the chip handlers for the two composers: hovering a chip
 * strengthens the highlight, clicking it scrolls the passage into view.
 */
export function useChatSelectionHighlight({
  run,
  inlineChat,
  panelRange,
  tracking,
}: {
  run: EditorRunner;
  inlineChat: ReturnType<typeof useInlineChat>;
  /** The live selection the panel's and the chat window's chip show. */
  panelRange: Range | null;
  /** Whether a panel or chat window is about this editor's selection. */
  tracking: boolean;
}) {
  // Shown until its composer says otherwise: the passage is marked as the
  // bar opens, not a render later.
  const [quickChip, setQuickChip] = useState<SelectionChip>({
    shown: true,
    hot: false,
  });
  const [panelChip, setPanelChip] = useState<SelectionChip>(HIDDEN);
  const editorFocused = useEditorFocus(run, tracking);

  // Only while Quick Ask's panel is on screen: a detached or hidden one
  // left its old range highlighted while the window was talking about a
  // different passage.
  const quickRange =
    inlineChat.visible && quickChip.shown
      ? (inlineChat.chatInfo?.range ?? null)
      : null;
  const liveRange =
    tracking && panelChip.shown && !editorFocused ? panelRange : null;
  // Only on a change of range: Quick Ask's has been mapped through every
  // edit since it was set, and setting it again would undo that.
  const target = quickRange ?? liveRange;
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(setChatSelection(view.state.tr, target));
    });
  }, [target, run]);

  const hot = (quickRange !== null && quickChip.hot) || panelChip.hot;
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(setChatSelectionHot(view.state.tr, hot));
    });
  }, [hot, run]);

  const reveal = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const range = chatSelectionRange(view.state);
      if (range) revealPosition(view, range.from);
    });
  }, [run]);

  const quickChipHandlers: SelectionChipHandlers = {
    onChange: setQuickChip,
    onReveal: reveal,
  };
  const panelChipHandlers: SelectionChipHandlers = {
    onChange: setPanelChip,
    onReveal: reveal,
  };
  return { quickChipHandlers, panelChipHandlers };
}

/** Whether the editor has the keyboard focus, in a focused window: moving
 *  into the composer, or into the chat window, takes it away. */
function useEditorFocus(run: EditorRunner, tracking: boolean): boolean {
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    if (!tracking) return;
    const check = () =>
      setFocused(
        document.hasFocus() &&
          run((ctx) => ctx.get(editorViewCtx).hasFocus()) === true,
      );
    check();
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    window.addEventListener("focus", check);
    window.addEventListener("blur", check);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("blur", check);
    };
  }, [run, tracking]);
  return focused;
}
