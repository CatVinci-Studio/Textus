import { emitToThisWindow } from "../platform/menu-events";
import { formatCombo } from "../utils/shortcuts";
import {
  OpenFolderIcon,
  PlusIcon,
  ProjectIcon,
} from "../engine/controls/icons";
import { canOpenFolder } from "../platform/capabilities";
import type { Strings } from "../i18n/strings";

/**
 * The three ways to begin - a new document, a file, a folder - as rows of an
 * icon, a name and its keys: the start page's, and the sidebar's when no
 * folder is open (one look in both, start-page.css). Run here as the menu
 * items' events, not through the native menu: in a window-per-document setup
 * that would open another window.
 */
export function StartActions({ t }: { t: Strings }) {
  const actions = [
    {
      label: t.menuNewFile,
      event: "menu-new-file",
      combo: "mod+n",
      icon: <PlusIcon />,
    },
    {
      label: t.menuOpenFile,
      event: "menu-open-file",
      combo: "mod+o",
      icon: <OpenFolderIcon />,
    },
    ...(canOpenFolder
      ? [
          {
            label: t.menuOpenFolder,
            event: "menu-open-folder",
            combo: undefined,
            icon: <ProjectIcon />,
          },
        ]
      : []),
  ];
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
            {a.combo && (
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
