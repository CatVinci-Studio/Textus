import { Suspense, useCallback, useState } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import type { ChatSummary } from "./chat-history";
import { HistoryIcon } from "../../engine/controls/icons";
import { Presence, PresenceDiv } from "../../engine/motion/usePresence";
import { useCloseOnOutsideClick } from "../../utils/hooks/useCloseOnOutsideClick";
import { Tooltip } from "../../engine/controls/Tooltip";
import { lazyComponent } from "../../lazy/lazy-component";
import { lazyModule } from "../../lazy/lazy-module";
import "./chat-history-menu.css";

// The list loads as History first opens: it searches, groups and deletes,
// none of it needed before.
const ChatHistoryList = lazyComponent(
  lazyModule("chat-history-list", () => import("./ChatHistoryList")),
  (m) => m.ChatHistoryList,
);

/**
 * The history button in a chat header and the saved conversations it opens,
 * grouped by project folder. Picking one hands it to `onReopen`.
 */
export function ChatHistoryMenu({
  buttonClassName,
  disabled,
  onReopen,
}: {
  buttonClassName: string;
  disabled?: boolean;
  onReopen: (entry: ChatSummary) => void;
}) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useCloseOnOutsideClick<HTMLDivElement>(close, true, open);
  return (
    <div className="chat-history-anchor" ref={ref}>
      <Tooltip text={t.chatHistoryOpen}>
        <button
          type="button"
          className={buttonClassName}
          aria-label={t.chatHistoryOpen}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen(!open)}
        >
          <HistoryIcon />
        </button>
      </Tooltip>
      <Presence show={open}>
        {open && (
          <PresenceDiv
            className="chat-history-menu floating-surface"
            role="dialog"
            aria-label={t.chatHistoryOpen}
          >
            <Suspense fallback={null}>
              <ChatHistoryList
                onReopen={(entry) => {
                  close();
                  onReopen(entry);
                }}
              />
            </Suspense>
          </PresenceDiv>
        )}
      </Presence>
    </div>
  );
}
