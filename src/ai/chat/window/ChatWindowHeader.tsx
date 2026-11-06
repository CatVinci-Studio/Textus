import { ChatHistoryMenu } from "../ChatHistoryMenu";
import { reopenConversation, type ReopenTarget } from "../reopen-conversation";
import type { ChatContext } from "./chat-bridge";
import { PinIcon, PlusIcon } from "../../../ui/icons";
import { WindowCaptionButtons } from "../../../ui/WindowCaptionButtons";
import { IconButton } from "../../../ui/IconButton";
import { PanelHeader } from "../../../ui/PanelHeader";
import type { Strings } from "../../../i18n/strings";

/**
 * The chat window's top row and only chrome: it is the drag handle, and on
 * Windows the caption with the close button. Drawn in every state, so a chat
 * whose handoff never arrived can still be moved and closed.
 */
export function ChatWindowHeader({
  context,
  busy,
  pinned,
  reopenTarget,
  onNewConversation,
  onPin,
  t,
}: {
  context: ChatContext | null;
  busy: boolean;
  pinned: boolean;
  reopenTarget: ReopenTarget;
  onNewConversation: () => void;
  onPin: () => void;
  t: Strings;
}) {
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
      <ChatHistoryMenu
        buttonClassName="inline-chat-header-button"
        disabled={busy || !context}
        onReopen={(entry) => void reopenConversation(entry, t, reopenTarget)}
      />
      <IconButton
        className="inline-chat-header-button"
        label={t.chatNewConversation}
        disabled={busy}
        onClick={onNewConversation}
      >
        <PlusIcon />
      </IconButton>
      <IconButton
        className={`inline-chat-header-button ${pinned ? "chat-window-pin-on" : ""}`}
        label={t.chatWindowPin}
        hint={pinned ? t.chatWindowUnpinHint : t.chatWindowPinHint}
        pressed={pinned}
        onClick={onPin}
      >
        <PinIcon />
      </IconButton>
      <WindowCaptionButtons />
    </PanelHeader>
  );
}
