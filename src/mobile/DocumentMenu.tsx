import { useState } from "react";
import { useSettings } from "../prefs/SettingsContext";
import { ActionSheet } from "../engine/controls/ActionSheet";
import { Presence } from "../engine/motion/usePresence";
import { MoreIcon } from "../engine/controls/icons";
import { Tooltip } from "../engine/controls/Tooltip";
import { emitMenuEvent } from "../platform/menu-events";
import { sendAppEvent, TOGGLE_FIND_REPLACE_EVENT } from "../utils/events";

/**
 * The document's own actions, behind a phone's ⋯: its outline, find and
 * replace, source mode and the share sheet. They are the same commands the
 * menus run, so nothing here is a second way to change the document.
 */
export function DocumentMenu({
  title,
  onOutline,
}: {
  /** The document's name, over its actions. */
  title: string;
  /** Its outline: the window's sidebar, on its Outline tab. */
  onOutline: () => void;
}) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip text={t.docMore} description={null}>
        <button
          type="button"
          className="window-bar-toggle document-menu-button"
          aria-label={t.docMore}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <MoreIcon />
        </button>
      </Tooltip>
      <Presence show={open}>
        {open && (
          <ActionSheet
            title={title}
            items={[
              { label: t.outlineTab, onSelect: onOutline },
              {
                label: t.menuFindReplace,
                onSelect: () => sendAppEvent(TOGGLE_FIND_REPLACE_EVENT),
              },
              {
                label: t.menuToggleSourceMode,
                onSelect: () => emitMenuEvent("toggle-source-mode"),
              },
              { label: t.menuShare, onSelect: () => emitMenuEvent("share") },
            ]}
            onClose={() => setOpen(false)}
          />
        )}
      </Presence>
    </>
  );
}
