import { useCallback, useEffect } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import {
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
} from "@milkdown/kit/preset/commonmark";
import { undoCommand, redoCommand } from "@milkdown/kit/plugin/history";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { EditorClipboard } from "../editor/clipboard/useEditorClipboard";
import {
  deleteImage,
  insertHeading,
  insertList,
  runCommand,
  runTableAction,
  selectedImagePos,
  setImageWidth,
} from "../editor/editor-menu";
import { toggleSpan } from "../editor/marks/span-commands";
import {
  insertMathBlock,
  insertRule,
  makeTasks,
} from "../editor/insert-blocks";
import {
  cycleHeading,
  toggleBlockquote,
  toggleList,
} from "../editor/keys/block-toggles";
import type { FindReplace } from "../editor/find/useFindReplace";
import type { EditorMenuState } from "./EditorContextMenu";
import type { AgentConversation } from "../ai/chat/useAgentConversation";
import type { AgentPanelFrame } from "../ai/chat/panel/agent-panel";
import { claimChatRestore } from "../ai/chat/chat-restore";
import { useLatest } from "../utils/hooks/useLatest";
import type { Settings } from "../prefs/SettingsContext";
import { aiFeatures } from "../settings/textus-ai";
import { useWindowEvent } from "../utils/hooks/useWindowEvent";
import {
  TRIGGER_COMPLETION_EVENT,
  TRIGGER_GRAMMAR_CHECK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  TOGGLE_FIND_REPLACE_EVENT,
  CLOSE_FIND_REPLACE_EVENT,
  INSERT_CLIPBOARD_TEXT_EVENT,
  RESTORE_CHAT_EVENT,
  INSERT_BLOCK_EVENT,
  TOGGLE_BLOCK_EVENT,
  TOGGLE_MARK_EVENT,
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
export function useEditorWindowEvents({
  run,
  settings,
  tour,
  triggerCompletion,
  triggerGrammarCheck,
  toggleAgentConversation,
  findReplace,
  clipboard,
  openTableDialog,
  setMenu,
  conversation,
  agentPanel,
  docPath,
}: {
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
  agentPanel: AgentPanelFrame;
  /** This editor's document; null for one never saved. */
  docPath: string | null;
}) {
  // Every tab's editor stays mounted, hidden with display:none, but these
  // events mean the editor on screen; without this guard each fires in
  // every tab.
  const isOnScreen = useCallback(
    () =>
      run((ctx) => ctx.get(editorViewCtx).dom.offsetParent !== null) ?? false,
    [run],
  );

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
  useWindowEvent(
    TOGGLE_FIND_REPLACE_EVENT,
    () => isOnScreen() && findReplace.show(),
  );
  useWindowEvent(CLOSE_FIND_REPLACE_EVENT, () => findReplace.dismiss());

  // Clipboard-history panel clicks, with the text as detail.
  useWindowEvent(INSERT_CLIPBOARD_TEXT_EVENT, (e) => {
    if (!isOnScreen()) return;
    const text = (e as CustomEvent<string>).detail;
    if (typeof text === "string" && text) clipboard.insertText(text);
  });

  // Native Format menu clicks and the heading shortcuts ("paragraph" for
  // body text): the same commands as the right-click Insert submenu.
  useWindowEvent(INSERT_BLOCK_EVENT, (e) => {
    if (!isOnScreen()) return;
    const kind = (e as CustomEvent<string>).detail;
    const headingMatch = /^h([1-6])$/.exec(kind);
    if (headingMatch) {
      insertHeading(run, Number(headingMatch[1]));
      return;
    }
    if (kind === "paragraph") {
      // Milkdown's WrapInHeading turns a level below 1 into a paragraph.
      insertHeading(run, 0);
      return;
    }
    switch (kind) {
      case "bullet-list":
        insertList(run, "bullet_list");
        break;
      case "ordered-list":
        insertList(run, "ordered_list");
        break;
      case "blockquote":
        runCommand(run, wrapInBlockquoteCommand.key);
        break;
      case "code-block":
        runCommand(run, createCodeBlockCommand.key);
        break;
      case "task-list":
        insertList(run, "bullet_list");
        run((ctx) => makeTasks(ctx.get(editorViewCtx)));
        break;
      case "math-block":
        run((ctx) => insertMathBlock(ctx.get(editorViewCtx)));
        run((ctx) => ctx.get(editorViewCtx).focus());
        break;
      case "rule":
        run((ctx) => insertRule(ctx.get(editorViewCtx)));
        run((ctx) => ctx.get(editorViewCtx).focus());
        break;
      case "table":
        openTableDialog();
        break;
    }
  });

  // The iPhone keyboard toolbar's block buttons, which toggle rather than
  // only insert.
  useWindowEvent(TOGGLE_BLOCK_EVENT, (e) => {
    if (!isOnScreen()) return;
    const kind = (e as CustomEvent<string>).detail;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (kind === "heading") cycleHeading(view);
      else if (kind === "bullet-list") toggleList(view, "bullet_list");
      else if (kind === "ordered-list") toggleList(view, "ordered_list");
      else if (kind === "blockquote") toggleBlockquote(view);
      view.focus();
    });
  });

  // The iPhone keyboard toolbar's bold and italic.
  useWindowEvent(TOGGLE_MARK_EVENT, (e) => {
    if (!isOnScreen()) return;
    const mark = (e as CustomEvent<string>).detail;
    if (mark !== "bold" && mark !== "italic") return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      toggleSpan(view, mark === "bold" ? 2 : 1);
      view.focus();
    });
  });

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

  // The iPhone keyboard toolbar's "More": the editor's menu for where the
  // caret is, as an action sheet.
  useWindowEvent(EDITOR_MORE_EVENT, () => {
    if (!isOnScreen()) return;
    setMenu({ x: 0, y: 0, imagePos: selectedImagePos(run), phone: true });
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

  // A conversation reopened from history becomes the live one in its
  // document's editor: this one if open, or a tab opened for it on mount.
  const claimRestore = useLatest(() => {
    const restore = claimChatRestore(docPath, isOnScreen);
    if (!restore) return;
    conversation.restore(restore.id, restore.turns);
    agentPanel.setOpen(true);
  });
  useWindowEvent(RESTORE_CHAT_EVENT, () => claimRestore.current());
  useEffect(() => claimRestore.current(), [docPath, claimRestore]);
}
