import { ChatHistoryMenu } from "../ChatHistoryMenu";
import { reopenConversation, type ReopenTarget } from "../reopen-conversation";
import type { ChatContext } from "./chat-bridge";
import { PinIcon, PlusIcon } from "../../../ui/icons";
import { WindowCaptionButtons } from "../../../ui/WindowCaptionButtons";
import { Tooltip } from "../../../ui/Tooltip";
import type { Strings } from "../../../i18n/strings";

/**
 * The chat window's top row, and the only chrome it draws. It sits where
 * the title bar would be (see build_with_app_chrome), so it doubles as the
 * drag handle - without one, a window with no title bar of its own can't
 * be moved. Content is right-aligned so it clears the traffic lights on
 * macOS without a hardcoded platform-specific inset.
 *
 * On Windows there is no frame at all, so this row also carries the
 * caption - including the close button, which is what sends the
 * conversation back to the editor to be re-embedded.
 *
 * Drawn in every state of the window, not just the loaded one: a chat
 * whose handoff never arrived (or whose editor went away) must still be
 * movable and closable.
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
    <div className="chat-window-header" data-tauri-drag-region>
      <span className="chat-window-doc" title={context?.docPath ?? undefined}>
        {context?.docTitle ?? ""}
      </span>
      <ChatHistoryMenu
        buttonClassName="inline-chat-header-button"
        disabled={busy || !context}
        onReopen={(entry) => void reopenConversation(entry, t, reopenTarget)}
      />
      <Tooltip text={t.chatNewConversation}>
        <button
          type="button"
          className="inline-chat-header-button"
          aria-label={t.chatNewConversation}
          disabled={busy}
          onClick={onNewConversation}
        >
          <PlusIcon />
        </button>
      </Tooltip>
      <Tooltip text={pinned ? t.chatWindowUnpinHint : t.chatWindowPinHint}>
        <button
          type="button"
          className={`inline-chat-header-button ${pinned ? "chat-window-pin-on" : ""}`}
          aria-pressed={pinned}
          aria-label={t.chatWindowPin}
          onClick={onPin}
        >
          <PinIcon />
        </button>
      </Tooltip>
      <WindowCaptionButtons />
    </div>
  );
}
