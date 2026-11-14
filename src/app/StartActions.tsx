import { emitToThisWindow } from "../platform/menu-events";
import { formatCombo } from "../utils/shortcuts";
import {
  FolderOpenIcon,
  GenericFileIcon,
  NewDocumentIcon,
} from "../engine/controls/icons";
import { Tooltip } from "../engine/controls/Tooltip";
import { canOpenFolder, isMobileApp } from "../platform/capabilities";
import type { Strings } from "../i18n/strings";

/**
 * The three ways to begin - a new document, a file, a folder: the start
 * page's capsule buttons (the first the primary, its keys in its tip), or
 * the sidebar's rows of an icon, a name and its keys when no folder is open
 * (start-page.css). Run here as the menu items' events, not through the
 * native menu: in a window-per-document setup that would open another
 * window.
 */
export function StartActions({
  t,
  look = "rows",
}: {
  t: Strings;
  look?: "rows" | "buttons";
}) {
  const actions = [
    {
      label: t.menuNewFile,
      event: "menu-new-file",
      combo: "mod+n",
      icon: <NewDocumentIcon />,
    },
    {
      label: t.menuOpenFile,
      event: "menu-open-file",
      combo: "mod+o",
      icon: <GenericFileIcon />,
    },
    ...(canOpenFolder
      ? [
          {
            label: t.menuOpenFolder,
            event: "menu-open-folder",
            combo: undefined,
            icon: <FolderOpenIcon />,
          },
        ]
      : []),
  ];
  if (look === "buttons")
    return (
      <div className="start-page-buttons">
        {actions.map((a, i) => {
          const button = (
            <button
              key={a.event}
              type="button"
              className={i === 0 ? "tx-button primary" : "tx-button"}
              onClick={() => emitToThisWindow(a.event)}
            >
              {a.icon}
              {a.label}
            </button>
          );
          return a.combo ? (
            <Tooltip key={a.event} text={formatCombo(a.combo)}>
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </div>
    );
  return (
    <ul className="start-page-actions">
      {actions.map((a) => (
        <li key={a.event}>
          <button
            type="button"
            className="start-page-action"
            onClick={() => emitToThisWindow(a.event)}
          >
            <span className="start-page-action-icon" aria-hidden="true">
              {a.icon}
            </span>
            <span className="start-page-action-label">{a.label}</span>
            {/* A touch screen's keys are its own. */}
            {a.combo && !isMobileApp && (
              <kbd className="start-page-action-keys">
                {formatCombo(a.combo)}
              </kbd>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
