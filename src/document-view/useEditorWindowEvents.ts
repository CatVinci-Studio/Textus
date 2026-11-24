import { flushDomSelection } from "../editor/modes/mode-switch";
import { editorInUse } from "../editor/editor-in-use";
import { useCallback, useEffect } from "react";
import { insertMarkdown } from "../editor/markdown/parse-markdown-source";
import { editorViewCtx } from "@milkdown/kit/core";
import { undoCommand, redoCommand } from "@milkdown/kit/plugin/history";
import { closeHistory } from "@milkdown/kit/prose/history";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { EditorClipboard } from "../editor/clipboard/useEditorClipboard";
import { applyBlockKind, runCommand } from "../editor/blocks/block-kinds";
import {
  deleteImage,
  selectedImagePos,
  setImageWidth,
} from "../editor/editor-menu-images";
import { runTableAction } from "../editor/editor-menu-tables";
import { caretLink } from "../editor/editor-menu-links";
import {
  BOLD,
  HIGHLIGHT,
  ITALIC,
  STRIKETHROUGH,
  insertLink,
  toggleCodeSpan,
  toggleFormat,
} from "../editor/keys/format-shortcut-plugin";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  cycleHeading,
  toggleBlockquote,
  toggleList,
} from "../editor/keys/block-toggles";
import type { FindReplace } from "../editor/find/useFindReplace";
import type { EditorMenuState } from "./EditorContextMenu";
import type { AgentConversation } from "../ai/chat/conversation/conversation-types";
import type { AgentPanelFrame } from "../ai/chat/panel/agent-panel";
import { claimChatRestore } from "../ai/chat/chat-restore";
import { useLatest } from "../utils/hooks/useLatest";
import type { Settings } from "../prefs/SettingsContext";
import { aiFeatures } from "../prefs/ai-features";
import { useWindowEvent } from "../utils/hooks/useWindowEvent";
import {
  TRIGGER_COMPLETION_EVENT,
  TRIGGER_GRAMMAR_CHECK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  TOGGLE_FIND_REPLACE_EVENT,
  CLOSE_FIND_REPLACE_EVENT,
  RESTORE_CHAT_EVENT,
  INSERT_BLOCK_EVENT,
  BLOCK_MENU_EVENT,
  type BlockMenuRequest,
  INSERT_MARKDOWN_EVENT,
  TOGGLE_BLOCK_EVENT,
  TOGGLE_MARK_EVENT,
  SHOW_REPLACE_EVENT,
  FIND_NEXT_EVENT,
  INSERT_LINK_EVENT,
  TABLE_ACTION_EVENT,
  IMAGE_ACTION_EVENT,
  EDITOR_MORE_EVENT,
  EDIT_ACTION_EVENT,
  type TourAi,
} from "../utils/events";

/** The Edit menu's clipboard items, as the right-click menu runs them. */
const CLIPBOARD_ACTIONS: Record<string, (clipboard: EditorClipboard) => void> =
  {
    cut: (c) => c.copyOrCut(true),
    copy: (c) => c.copyOrCut(false),
    "copy-as-plain-text": (c) => c.copyAsPlainText(),
    paste: (c) => c.paste(),
    "paste-as-plain-text": (c) => c.pasteAsPlainText(),
    "select-all": (c) => c.selectAll(),
  };

/** The window events one tab's editor answers: menu commands, shortcuts,
 *  the iPhone keyboard toolbar and the sidebar panels. */

type EditorEvents = {
  run: EditorRunner;
  settings: Settings;
  /** The tour's AI while this is its practice tab, else null. */
  tour: TourAi | null;
  triggerCompletion: () => void;
  triggerGrammarCheck: () => void;
  toggleAgentConversation: () => void;
  findReplace: FindReplace;
  clipboard: EditorClipboard;
  openTableDialog: () => void;
  setMenu: (menu: EditorMenuState) => void;
  conversation: AgentConversation;
  /** Replacing the conversation, asked first while edits are undecided. */
  guardConversation: (replace: () => void) => void;
  agentPanel: AgentPanelFrame;
  /** This editor's document; null for one never saved. */
  docPath: string | null;
};

type Events = EditorEvents & { isOnScreen: () => boolean };

/** The AI's keys, with the same feature toggles as the context menu;
 *  the typing-assistance ones ignored while the tour mutes the AI. */
function useAiKeys(events: Events) {
  const {
    settings,
    tour,
    triggerCompletion,
    triggerGrammarCheck,
    toggleAgentConversation,
    isOnScreen,
  } = events;
  // Shortcuts respect the same feature toggles as the context menu. The
  // typing-assistance triggers are also ignored while the tour mutes the AI.
  const features = aiFeatures(settings, tour !== null);
  useWindowEvent(
    TRIGGER_COMPLETION_EVENT,
    () =>
      isOnScreen() &&
      tour !== "muted" &&
      features.completion &&
      triggerCompletion(),
  );
  useWindowEvent(
    TRIGGER_GRAMMAR_CHECK_EVENT,
    () =>
      isOnScreen() &&
      tour !== "muted" &&
      features.grammar &&
      triggerGrammarCheck(),
  );
  useWindowEvent(
    TOGGLE_FLOATING_CHAT_EVENT,
    () => isOnScreen() && features.chat && toggleAgentConversation(),
  );
}

/** Find and Replace, from the menu and its keys. */
function useFindKeys(events: Events) {
  const { findReplace, isOnScreen } = events;
  useWindowEvent(
    TOGGLE_FIND_REPLACE_EVENT,
    () => isOnScreen() && findReplace.show(),
  );
  useWindowEvent(CLOSE_FIND_REPLACE_EVENT, () => findReplace.dismiss());
  useWindowEvent(
    SHOW_REPLACE_EVENT,
    () => isOnScreen() && findReplace.showReplace(),
  );
  useWindowEvent(FIND_NEXT_EVENT, () => isOnScreen() && findReplace.findNext());
}

/** Formatting from the native Format menu, the heading shortcuts and the
 *  iPhone keyboard toolbar: each as its key or the right-click menu does it. */
function useFormatEvents(events: Events) {
  const { run, openTableDialog, isOnScreen } = events;
  // Native Format menu clicks and the heading shortcuts ("paragraph" for
  // body text): the same commands as the right-click Insert submenu.
  useWindowEvent(INSERT_BLOCK_EVENT, (e) => {
    if (!isOnScreen()) return;
    applyBlockKind(run, (e as CustomEvent<string>).detail, openTableDialog);
  });

  // The iPhone keyboard toolbar's block buttons, which toggle rather than
  // only insert.
  useWindowEvent(TOGGLE_BLOCK_EVENT, (e) => {
    if (!isOnScreen()) return;
    const kind = (e as CustomEvent<string>).detail;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      flushDomSelection(view);
      if (kind === "heading") cycleHeading(view);
      else if (kind === "bullet-list") toggleList(view, "bullet_list");
      else if (kind === "ordered-list") toggleList(view, "ordered_list");
      else if (kind === "blockquote") toggleBlockquote(view);
      view.focus();
    });
  });

  // The iPhone keyboard toolbar's bold and italic, and Format › Highlight,
  // Strikethrough, Inline Code and Link: each as its key does it.
  useWindowEvent(TOGGLE_MARK_EVENT, (e) => {
    if (!isOnScreen()) return;
    const toggle = MARKS[(e as CustomEvent<string>).detail];
    if (!toggle) return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      // A selection made by keys just now reaches the editor late.
      flushDomSelection(view);
      toggle(view);
      view.focus();
    });
  });
  useWindowEvent(INSERT_MARKDOWN_EVENT, (e) => {
    if (!isOnScreen()) return;
    const markdown = (e as CustomEvent<string>).detail;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      // Its own undo step, apart from what was typed just before.
      view.dispatch(
        insertMarkdown(
          closeHistory(view.state.tr),
          ctx,
          markdown,
        ).scrollIntoView(),
      );
      view.focus();
    });
  });
  useWindowEvent(INSERT_LINK_EVENT, () => {
    if (!isOnScreen()) return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      insertLink(view);
      view.focus();
    });
  });
}

/** The iPhone keyboard toolbar's table and image buttons and its "More", a
 *  block handle's menu, and the app-drawn menu's Edit items. */
function useToolbarEvents(events: Events) {
  const { run, clipboard, setMenu, docPath, isOnScreen } = events;
  // The iPhone keyboard toolbar's table buttons: the right-click menu's
  // insert and delete items, for the table under the caret.
  useWindowEvent(TABLE_ACTION_EVENT, (e) => {
    if (!isOnScreen()) return;
    runTableAction(run, (e as CustomEvent<string>).detail);
  });

  // The iPhone keyboard toolbar's image buttons: the right-click menu's
  // width presets, and delete, for the image the selection is on.
  useWindowEvent(IMAGE_ACTION_EVENT, (e) => {
    if (!isOnScreen()) return;
    const pos = selectedImagePos(run);
    if (pos === null) return;
    const action = (e as CustomEvent<string>).detail;
    if (action === "delete") {
      deleteImage(run, pos);
      return;
    }
    const width = /^width:(auto|\d+)$/.exec(action)?.[1];
    // Still selected afterwards, so another preset is a tap away.
    if (width)
      setImageWidth(run, pos, width === "auto" ? null : Number(width), true);
  });

  // A block handle's ⋮⋮ in this editor: the menu for that block.
  useWindowEvent(BLOCK_MENU_EVENT, (e) => {
    const { dom, x, y, pos } = (e as CustomEvent<BlockMenuRequest>).detail;
    if (run((ctx) => ctx.get(editorViewCtx).dom) !== dom) return;
    setMenu({ x, y, imagePos: null, block: { pos } });
  });

  // The phone's format bar's "More": the editor's menu for where the caret
  // is, hung from the button.
  useWindowEvent(EDITOR_MORE_EVENT, (e) => {
    if (!isOnScreen()) return;
    const button = (e as CustomEvent<HTMLElement>).detail;
    const box = button.getBoundingClientRect();
    setMenu({
      x: box.left,
      y: box.bottom + 4,
      imagePos: selectedImagePos(run),
      link: caretLink(run, docPath),
      phone: button,
    });
  });

  // The app-drawn menu's Edit submenu: these native items are predefined and
  // have no id, so they arrive as an event.
  useWindowEvent(EDIT_ACTION_EVENT, (e) => {
    if (!isOnScreen()) return;
    switch ((e as CustomEvent<string>).detail) {
      case "undo":
        runCommand(run, undoCommand.key);
        break;
      case "redo":
        runCommand(run, redoCommand.key);
        break;
      default:
        CLIPBOARD_ACTIONS[(e as CustomEvent<string>).detail]?.(clipboard);
    }
  });
}

/** A conversation reopened from history becomes the live one in its
 *  document's editor: this one if open, or a tab opened for it on mount. */
function useChatRestore(events: Events) {
  const { conversation, guardConversation, agentPanel, docPath, isOnScreen } =
    events;
  const claimRestore = useLatest(() => {
    const restore = claimChatRestore(docPath, isOnScreen);
    if (!restore) return;
    agentPanel.setOpen(true);
    guardConversation(() => conversation.restore(restore.id, restore.turns));
  });
  useWindowEvent(RESTORE_CHAT_EVENT, () => claimRestore.current());
  useEffect(() => claimRestore.current(), [docPath, claimRestore]);
}

/** The marks a menu or toolbar toggles by name. */
const MARKS: Record<string, (view: EditorView) => unknown> = {
  bold: (view) => toggleFormat(view, BOLD),
  italic: (view) => toggleFormat(view, ITALIC),
  highlight: (view) => toggleFormat(view, HIGHLIGHT),
  strikethrough: (view) => toggleFormat(view, STRIKETHROUGH),
  code: toggleCodeSpan,
};

export function useEditorWindowEvents(editor: EditorEvents) {
  const { run } = editor;
  // Every tab's editor stays mounted, hidden with display:none, and a split
  // shows several: these events mean the one in use - the one with focus,
  // else the one in the island in use. Without this guard each fired in
  // every editor shown, and the last took the selection.
  const isOnScreen = useCallback(
    () => run((ctx) => editorInUse(ctx.get(editorViewCtx).dom)) ?? false,
    [run],
  );

  const events = { ...editor, isOnScreen };
  useAiKeys(events);
  useFindKeys(events);
  useFormatEvents(events);
  useToolbarEvents(events);
  useChatRestore(events);
}
