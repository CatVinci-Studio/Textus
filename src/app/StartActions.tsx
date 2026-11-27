import { emitToThisWindow } from "../platform/menu-events";
import { formatCombo } from "../utils/shortcuts";
import {
  FolderOpenIcon,
  GenericFileIcon,
  NewDocumentIcon,
} from "../engine/controls/icons";
import { Tooltip } from "../engine/controls/Tooltip";
import { canOpenFolder } from "../platform/capabilities";
import type { Strings } from "../i18n/strings";

/**
 * The three ways to begin - a new document, a file, a folder - as capsule
 * buttons named alike (no menu's "…"), their keys in their tips: the start page's (the first the
 * primary), or one alone where a sidebar panel is empty. Run here as the
 * menu items' events, not through the native menu: in a window-per-document
 * setup that would open another window.
 */
export function StartActions({
  t,
  only,
  primary = true,
}: {
  t: Strings;
  /** These of the three alone, by their events. */
  only?: readonly string[];
  /** The first in the accent, as the start page's call to begin. */
  primary?: boolean;
}) {
  const all = [
    {
      label: t.menuNewFile,
      event: "menu-new-file",
      combo: "mod+n",
      icon: <NewDocumentIcon />,
    },
    {
      label: t.startOpenFile,
      event: "menu-open-file",
      combo: "mod+o",
      icon: <GenericFileIcon />,
    },
    ...(canOpenFolder
      ? [
          {
            label: t.startOpenFolder,
            event: "menu-open-folder",
            combo: undefined,
            icon: <FolderOpenIcon />,
          },
        ]
      : []),
  ];
  const actions = only ? all.filter((a) => only.includes(a.event)) : all;
  return (
    <div className="start-page-buttons">
      {actions.map((a, i) => {
        const button = (
          <button
            key={a.event}
            type="button"
            className={primary && i === 0 ? "tx-button primary" : "tx-button"}
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
}
