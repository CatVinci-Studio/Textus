import { useEffect, useState, type ReactNode } from "react";
import { emitToThisWindow } from "../platform/menu-events";
import { NO_RECENTS, type RecentLists } from "./menu/app-menu-model";
import { readRecents } from "./menu/recents";
import { basename, dirname } from "../utils/path";
import { formatCombo } from "../utils/shortcuts";
import {
  FolderIcon,
  GenericFileIcon,
  OpenFolderIcon,
  PlusIcon,
  ProjectIcon,
} from "../ui/icons";
import { Tooltip } from "../ui/Tooltip";
import type { Strings } from "../i18n/strings";
import mark from "../../src-tauri/icons/128x128.png";
import { openingDocuments } from "./start-project";
import "./start-page.css";

/** Recent projects and files each list this many at most. */
const RECENT_SHOWN = 6;

/** The recent projects and files, read once as the page opens. */
function useRecents(): RecentLists {
  const [recents, setRecents] = useState(NO_RECENTS);
  useEffect(() => {
    let alive = true;
    void readRecents()
      .then((found) => {
        if (alive) setRecents(found);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return recents;
}

/** Where a recent item is, short: the home folder as ~ and only the last
 *  two folders, so the name stays readable. */
export function shortPlace(path: string): string {
  const parent = dirname(path.replace(/[\\/]+$/, ""));
  const home = parent.replace(
    /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/,
    "~",
  );
  const sep = home.includes("\\") && !home.includes("/") ? "\\" : "/";
  const parts = home.split(sep).filter(Boolean);
  return parts.length > 3 ? `…${sep}${parts.slice(-2).join(sep)}` : home;
}

function RecentList({
  title,
  paths,
  event,
  icon,
  then,
}: {
  title: string;
  paths: string[];
  /** The menu event that opens one, here. */
  event: string;
  icon: ReactNode;
  /** What else opening one does. */
  then?: (path: string) => void;
}) {
  if (paths.length === 0) return null;
  return (
    <section className="start-page-recent" aria-label={title}>
      <h2 className="start-page-heading">{title}</h2>
      {paths.slice(0, RECENT_SHOWN).map((path) => (
        <Tooltip key={path} text={path} description={null}>
          <button
            type="button"
            className="start-page-row"
            onClick={() => {
              emitToThisWindow(event, path);
              then?.(path);
            }}
          >
            <span className="start-page-row-icon" aria-hidden="true">
              {icon}
            </span>
            <span className="start-page-name">
              {basename(path.replace(/[\\/]+$/, "")) || path}
            </span>
            <span className="start-page-where">{shortPlace(path)}</span>
          </button>
        </Tooltip>
      ))}
    </section>
  );
}

/**
 * What a window shows with nothing open in it, when the user chose so:
 * new, open and the recent projects and files. Anything opened here takes
 * its place.
 */
export function StartPage({ t }: { t: Strings }) {
  const recents = useRecents();
  const [empty, setEmpty] = useState<string | null>(null);
  // Run here as the menu items' events, not through the native menu: in a
  // window-per-document setup that would open another window.
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
    {
      label: t.menuOpenFolder,
      event: "menu-open-folder",
      icon: <ProjectIcon />,
    },
  ];
  const anyRecent = recents.folders.length > 0 || recents.files.length > 0;
  // A project with nothing to open: its files are in the sidebar.
  if (empty)
    return (
      <div className="start-page" role="region" aria-label={t.startPageTab}>
        <div className="tx-empty">
          {t.startPagePickDocument.replace(
            "{folder}",
            basename(empty.replace(/[\\/]+$/, "")),
          )}
        </div>
      </div>
    );
  return (
    <div className="start-page" role="region" aria-label={t.startPageTab}>
      <div className="start-page-body">
        <h1 className="start-page-title">
          <img src={mark} alt="" width={64} height={64} />
          Textus
        </h1>
        <div className="start-page-actions">
          {actions.map((a) => (
            <button
              key={a.event}
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
          ))}
        </div>
        {anyRecent && (
          <div className="start-page-recents">
            <RecentList
              title={t.startPageRecentProjects}
              paths={recents.folders}
              event="menu-open-recent-folder"
              icon={<FolderIcon />}
              // A project shows a document of its own too: the sidebar
              // alone changing left the start page looking untouched.
              then={(folder) =>
                void openingDocuments(folder, recents.files).then((docs) =>
                  docs.length
                    ? emitToThisWindow("open-project-documents", docs)
                    : setEmpty(folder),
                )
              }
            />
            <RecentList
              title={t.startPageRecentFiles}
              paths={recents.files}
              event="menu-open-recent"
              icon={<GenericFileIcon />}
            />
          </div>
        )}
      </div>
    </div>
  );
}
