import { useState } from "react";
import { useSettings } from "../prefs/SettingsContext";
import { useMenuButton } from "../engine/controls/useMenuButton";
import { Presence } from "../engine/motion/usePresence";
import { MoreIcon } from "../engine/controls/icons";
import { Tooltip } from "../engine/controls/Tooltip";
import { emitMenuEvent } from "../platform/menu-events";
import { sendAppEvent, TOGGLE_FIND_REPLACE_EVENT } from "../utils/events";
import { OutlineMenu } from "./OutlineMenu";

/**
 * The document's own actions, behind a phone's ⋯: its outline, find and
 * replace, source mode and the share sheet. They are the same commands the
 * menus run, so nothing here is a second way to change the document.
 */
export function DocumentMenu({
  title,
  content,
  tabId,
}: {
  /** The document's name, over its actions. */
  title: string;
  /** Its text, for the outline. */
  content: string;
  /** The tab whose editor the outline scrolls. */
  tabId: string;
}) {
  const { t } = useSettings();
  const [outlineAt, setOutlineAt] = useState<{
    x: number;
    y: number;
    anchor: HTMLElement | null;
  } | null>(null);
  const [button, setButton] = useState<HTMLElement | null>(null);
  const more = useMenuButton(
    () => [
      {
        label: t.outlineTab,
        onSelect: () => {
          const box = button?.getBoundingClientRect();
          if (box)
            setOutlineAt({ x: box.right, y: box.bottom + 4, anchor: button });
        },
      },
      {
        label: t.menuFindReplace,
        onSelect: () => sendAppEvent(TOGGLE_FIND_REPLACE_EVENT),
      },
      {
        label: t.menuToggleSourceMode,
        onSelect: () => emitMenuEvent("toggle-source-mode"),
      },
      { label: t.menuShare, onSelect: () => emitMenuEvent("share") },
    ],
    { title, alignEnd: true },
  );
  return (
    <>
      <Tooltip text={t.docMore} description={null}>
        <button
          type="button"
          className="window-bar-toggle document-menu-button"
          aria-label={t.docMore}
          {...more.button}
          ref={(el) => {
            more.button.ref(el);
            setButton(el);
          }}
        >
          <MoreIcon />
        </button>
      </Tooltip>
      {more.menu}
      <Presence show={outlineAt !== null}>
        {outlineAt && (
          <OutlineMenu
            content={content}
            tabId={tabId}
            at={outlineAt}
            onClose={() => setOutlineAt(null)}
          />
        )}
      </Presence>
    </>
  );
}
