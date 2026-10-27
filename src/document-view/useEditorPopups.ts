import { type KeyboardEvent, type MouseEvent, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { contextMenuTarget } from "../editor/editor-menu";
import { usePopupDismiss } from "./usePopupDismiss";
import { useEditorWindowEvents } from "./useEditorWindowEvents";
import { useTextusAiOff } from "./useTextusAiOff";
import type { EditorMenuState } from "./EditorContextMenu";
import type { EditorSetup } from "./useEditorSetup";
import type { EditorChat } from "./useEditorChat";
import { useFindReplace } from "../editor/find/useFindReplace";
import { useModeSwitchCaret } from "../editor/modes/useModeSwitchCaret";
import { useTabJump } from "../editor/useTabJump";
import { useTabCaret } from "../editor/useTabCaret";
import { useFocusModeRefresh } from "../editor/modes/useFocusModeRefresh";
import { useGrammarPopover } from "../ai/writing/useGrammarPopover";
import type { Settings } from "../settings/SettingsContext";
import type { Strings } from "../i18n/strings";
import type { TourAi } from "../utils/events";
import { revealPlace } from "./plugins/plugin-edits";

/** Where the caret goes as the tab or the view mode changes. */
export function useEditorCarets({
  setup,
  tabId,
  isActive,
  initialValue,
  typewriter,
}: {
  setup: EditorSetup;
  tabId: string;
  isActive: boolean;
  initialValue: string;
  typewriter: boolean;
}) {
  const { run, reporting } = setup;
  useModeSwitchCaret(run, isActive, initialValue);
  useTabJump(run, tabId, isActive, initialValue, typewriter, revealPlace);
  useTabCaret(
    run,
    tabId,
    isActive,
    () => reporting.reportedMarkdownRef.current ?? initialValue,
  );
  useFocusModeRefresh(run, isActive, typewriter);
}

/** Portals' text fields keep the native Cut/Copy/Paste menu, whose Paste
 *  would otherwise go into the document. */
const ownsMenu = (target: EventTarget | null) =>
  !(target as HTMLElement | null)?.closest?.(
    ".inline-chat, .find-replace-bar, input, textarea",
  );

/**
 * What opens over one tab's editor: its menu, the table dialog, the grammar
 * card, the find bar, and the window events that reach this editor.
 */
export function useEditorPopups({
  setup,
  chat,
  filePath,
  phone,
  settings,
  tour,
  t,
}: {
  setup: EditorSetup;
  chat: EditorChat;
  filePath: string | null;
  phone: boolean;
  settings: Settings;
  tour: TourAi | null;
  t: Strings;
}) {
  const { run, inlineChat } = setup;
  const [menu, setMenu] = useState<EditorMenuState>(null);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);

  const grammar = useGrammarPopover(run, () => t.grammarApplyStale);
  // A phone has no hover or arrow keys, so the caret opens a suggestion only
  // right after a touch. The check waits a frame: the listener fires before
  // the view holds the new selection.
  const lastTouchRef = useRef(0);
  const onGrammarCaret = grammar.onCaretMove;
  setup.grammarCaretRef.current = () => {
    if (!phone) onGrammarCaret();
    else if (Date.now() - lastTouchRef.current < 800)
      requestAnimationFrame(onGrammarCaret);
  };
  const findReplace = useFindReplace(run);
  useTextusAiOff(run, settings.textusAi, {
    quickAsk: inlineChat.hide,
    grammarCard: grammar.hide,
  });

  // A phone shows the menu and the grammar card as action sheets, which
  // usePopupDismiss leaves alone.
  usePopupDismiss({
    anyPopup: !phone && (menu !== null || grammar.popover !== null),
    setMenu,
    hideGrammar: grammar.hide,
    settingsRef: setup.settingsRef,
  });

  const { clipboard } = setup;
  useEditorWindowEvents({
    run,
    settings,
    tour,
    triggerCompletion: setup.triggerCompletion,
    triggerGrammarCheck: setup.triggerGrammarCheck,
    toggleAgentConversation: chat.controls.toggleAgentConversation,
    findReplace,
    clipboard,
    openTableDialog: () => setTableDialogOpen(true),
    setMenu,
    conversation: chat.conversation,
    agentPanel: chat.agentPanel,
    docPath: filePath,
  });

  /** The menu at the caret, with the focus in it: Shift+F10 or the Menu
   *  key. */
  function openMenuAtCaret(target: EventTarget | null) {
    const at = run((ctx) => {
      const view = ctx.get(editorViewCtx);
      return view.coordsAtPos(view.state.selection.head);
    });
    setMenu({
      x: at?.left ?? 0,
      y: at?.bottom ?? 0,
      keyboard: true,
      ...contextMenuTarget(run, { target }, filePath),
    });
  }

  // Taken here: Chromium turns Shift+F10 and the Menu key into contextmenu,
  // but WebKit never does.
  function onKeyDown(e: KeyboardEvent) {
    if (!((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu")) return;
    if (e.altKey || e.ctrlKey || e.metaKey || !ownsMenu(e.target)) return;
    e.preventDefault();
    openMenuAtCaret(e.target);
  }

  function onContextMenu(e: MouseEvent) {
    if (!ownsMenu(e.target)) return;
    e.preventDefault();
    // A key that still arrives as a contextmenu event (no mouse button).
    if (e.button !== 2) {
      openMenuAtCaret(e.target);
      return;
    }
    setMenu({
      x: e.clientX,
      y: e.clientY,
      ...contextMenuTarget(run, e, filePath),
    });
  }

  return {
    menu,
    setMenu,
    tableDialogOpen,
    setTableDialogOpen,
    grammar,
    lastTouchRef,
    findReplace,
    onKeyDown,
    onContextMenu,
  };
}

export type EditorPopups = ReturnType<typeof useEditorPopups>;
