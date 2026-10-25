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
import { revealPlace } from "./plugin-edits";

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

/** Portals (Quick Ask, the find bar) bubble React events through here:
 *  their text fields keep the native Cut/Copy/Paste menu instead of the
 *  editor's, whose Paste would have gone into the document. */
const ownsMenu = (target: EventTarget | null) =>
  !(target as HTMLElement | null)?.closest?.(
    ".inline-chat, .find-replace-bar, input, textarea",
  );

/**
 * What opens over one tab's editor: its menu (right-click, Shift+F10, the
 * Menu key), the table dialog, the grammar card, the find bar - and the
 * window events (menu commands, shortcuts, the iPhone toolbar) that reach
 * this editor.
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
  // A phone has no hover and no arrow keys - a tap on an underline is the
  // way in, so there the caret opens the suggestion only right after a
  // touch, not whenever typing happens to end against a flagged word (the
  // ranges include their edges). The listener reports the selection while
  // the transaction is still being applied, before the view holds it, so
  // the phone's check waits a frame to see where the tap put the caret.
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
    insertText: clipboard.insertText,
    copyOrCut: clipboard.copyOrCut,
    copyAsMarkdown: clipboard.copyAsMarkdown,
    paste: clipboard.paste,
    selectAll: clipboard.selectAll,
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

  // Shift+F10 and the Menu key are taken here rather than left to the
  // browser: Chromium turns them into a contextmenu event, but WebKit -
  // every Mac, and WebKitGTK on Linux - never does, so the keyboard's way
  // to the menu did nothing there.
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
