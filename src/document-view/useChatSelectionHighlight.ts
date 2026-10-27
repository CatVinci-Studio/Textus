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
 * Keeps the passage a chat is about highlighted while its composer shows
 * the selection chip; the live selection only while the editor lacks focus,
 * since it shows itself there. Returns the chip handlers: hover strengthens
 * the highlight, click scrolls to it.
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
  // Shown until its composer says otherwise, so the passage is marked as the
  // bar opens.
  const [quickChip, setQuickChip] = useState<SelectionChip>({
    shown: true,
    hot: false,
  });
  const [panelChip, setPanelChip] = useState<SelectionChip>(HIDDEN);
  const editorFocused = useEditorFocus(run, tracking);

  // Only while Quick Ask's panel is on screen, or a stale range stays lit.
  const quickRange =
    inlineChat.visible && quickChip.shown
      ? (inlineChat.chatInfo?.range ?? null)
      : null;
  const liveRange =
    tracking && panelChip.shown && !editorFocused ? panelRange : null;
  // Only on a change of range: Quick Ask's is mapped through every edit, and
  // setting it again would undo that.
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
