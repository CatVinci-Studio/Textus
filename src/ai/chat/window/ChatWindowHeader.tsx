import type { ReactNode } from "react";
import { ChatHistoryMenu } from "../ChatHistoryMenu";
import { reopenConversation, type ReopenTarget } from "../reopen-conversation";
import type { ChatContext } from "./chat-bridge";
import { PinIcon, PlusIcon } from "../../../engine/controls/icons";
import { WindowCaptionButtons } from "../../../engine/controls/WindowCaptionButtons";
import { IconButton } from "../../../engine/controls/IconButton";
import { PanelHeader } from "../../../engine/controls/PanelHeader";
import { IslandRow } from "../../../engine/layout/Island";
import type { Strings } from "../../../i18n/strings";

/** The AI island's row of conversations, drawn by the app layer. */
export type ChatTabs = (props: {
  scope: string | null;
  onNew: () => void;
  end: ReactNode;
  t: Strings;
}) => ReactNode;

/**
 * The chat window's top row and only chrome: it is the drag handle, and on
 * Windows the caption with the close button. Drawn in every state, so a chat
 * whose handoff never arrived can still be moved and closed. With `tabs`,
 * the row is the AI island's, as in the editor's window: its conversations,
 * then history and pin.
 */
export function ChatWindowHeader({
  context,
  scope,
  tabs,
  busy,
  pinned,
  reopenTarget,
  onNewConversation,
  onPin,
  t,
}: {
  context: ChatContext | null;
  scope: string | null;
  tabs?: ChatTabs;
  busy: boolean;
  pinned: boolean;
  reopenTarget: ReopenTarget;
  onNewConversation: () => void;
  onPin: () => void;
  t: Strings;
}) {
  const history = (
    <ChatHistoryMenu
      buttonClassName="inline-chat-header-button"
      disabled={busy || !context}
      onReopen={(entry) => void reopenConversation(entry, t, reopenTarget)}
    />
  );
  const pin = (
    <IconButton
      className={`inline-chat-header-button ${pinned ? "chat-window-pin-on" : ""}`}
      label={t.chatWindowPin}
      hint={pinned ? t.chatWindowUnpinHint : t.chatWindowPinHint}
      pressed={pinned}
      onClick={onPin}
    >
      <PinIcon />
    </IconButton>
  );
  if (tabs)
    return (
      <div
        className="chat-window-header chat-window-tabs"
        data-tauri-drag-region
      >
        {/* The traffic lights' room, for the row to clear. */}
        <span className="window-bar-lead chat-window-lights" aria-hidden />
        <IslandRow kind="ai">
          {tabs({
            scope,
            onNew: () => !busy && onNewConversation(),
            end: (
              <>
                {history}
                {pin}
              </>
            ),
            t,
          })}
        </IslandRow>
        <WindowCaptionButtons />
      </div>
    );
  return (
    <PanelHeader
      className="chat-window-header"
      actionsClassName="chat-window-actions"
      dragRegion
      title={
        <span className="chat-window-doc" title={context?.docPath ?? undefined}>
          {context?.docTitle ?? ""}
        </span>
      }
    >
      {history}
      <IconButton
        className="inline-chat-header-button"
        label={t.chatNewConversation}
        disabled={busy}
        onClick={onNewConversation}
      >
        <PlusIcon />
      </IconButton>
      {pin}
      <WindowCaptionButtons />
    </PanelHeader>
  );
}
