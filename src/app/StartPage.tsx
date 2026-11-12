import { fill } from "../i18n/fill";
import { PathText } from "../engine/controls/PathText";
import { useEffect, useState, type ReactNode } from "react";
import { emitToThisWindow } from "../platform/menu-events";
import { NO_RECENTS, type RecentLists } from "../registry/menu/app-menu-model";
import { readRecents } from "./menu/recents";
import { menuIpc } from "../platform/ipc-app";
import { basename, dirname } from "../utils/path";
import {
  CloseIcon,
  FolderIcon,
  MarkdownFileIcon,
} from "../engine/controls/icons";
import { Tooltip } from "../engine/controls/Tooltip";
import type { Strings } from "../i18n/strings";
import mark from "../../src-tauri/icons/128x128.png";
import { openingDocuments } from "./start-project";
import "./start-page.css";
import { StartActions } from "./StartActions";

/** Recent folders and files each list this many at most. */
const RECENT_SHOWN = 5;

/** The recent projects and files, read once as the page opens. */
function useRecents(): [RecentLists, (path: string) => void] {
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
  // Taken off the list here at once, and off the stored lists and the menu.
  const remove = (path: string) => {
    setRecents((now) => ({
      files: now.files.filter((p) => p !== path),
      folders: now.folders.filter((p) => p !== path),
    }));
    void menuIpc.removeRecent(path).catch(() => {});
  };
  return [recents, remove];
}

/** Where a recent item is: the home folder as ~ (PathText gives way in
 *  its middle). */
export function shortPlace(path: string): string {
  const parent = dirname(path.replace(/[\\/]+$/, ""));
  return parent.replace(
    /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/,
    "~",
  );
}

function RecentList({
  title,
  paths,
  event,
  icon,
  then,
  onRemove,
  removeLabel,
}: {
  title: string;
  paths: string[];
  /** The menu event that opens one, here. */
  event: string;
  icon: ReactNode;
  /** What else opening one does. */
  then?: (path: string) => void;
  onRemove: (path: string) => void;
  removeLabel: string;
}) {
  if (paths.length === 0) return null;
  return (
    <section className="start-page-recent" aria-label={title}>
      <h2 className="start-page-heading">{title}</h2>
      <ul>
        {paths.slice(0, RECENT_SHOWN).map((path) => (
          <li key={path} className="start-page-row">
            <Tooltip text={path} description={null}>
              <button
                type="button"
                className="start-page-open"
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
                <span className="start-page-where">
                  <PathText path={shortPlace(path)} tip={false} />
                </span>
              </button>
            </Tooltip>
            <button
              type="button"
              className="start-page-remove"
              aria-label={`${removeLabel}: ${basename(path)}`}
              onClick={() => onRemove(path)}
            >
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The recent folders as a row of capsules, each its name, its place in
 *  its tip. */
function FolderChips({
  title,
  paths,
  onOpen,
}: {
  title: string;
  paths: string[];
  onOpen: (path: string) => void;
}) {
  if (paths.length === 0) return null;
  return (
    <section className="start-page-recent" aria-label={title}>
      <h2 className="start-page-heading">{title}</h2>
      <div className="start-page-chips">
        {paths.slice(0, RECENT_SHOWN).map((path) => (
          <Tooltip key={path} text={path} description={null}>
            <button
              type="button"
              className="tx-button small start-page-chip"
              onClick={() => onOpen(path)}
            >
              <FolderIcon />
              {basename(path.replace(/[\\/]+$/, "")) || path}
            </button>
          </Tooltip>
        ))}
      </div>
    </section>
  );
}

/**
 * What a window shows with nothing open in it, when the user chose so: one
 * column - the mark and the name, new and open, the recent folders as
 * capsules, the recent files. Anything opened here takes
 * its place.
 */
export function StartPage({ t }: { t: Strings }) {
  const [recents, removeRecent] = useRecents();
  const [empty, setEmpty] = useState<string | null>(null);
  // Run here as the menu items' events, not through the native menu: in a
  // window-per-document setup that would open another window.
  const anyRecent = recents.folders.length > 0 || recents.files.length > 0;
  // A project with nothing to open: its files are in the sidebar.
  if (empty)
    return (
      <div
        className="start-page tx-scroll-reveal"
        role="region"
        aria-label={t.startPageTab}
      >
        <div className="tx-empty">
          {fill(t.startPagePickDocument, {
            folder: basename(empty.replace(/[\\/]+$/, "")),
          })}
        </div>
      </div>
    );
  return (
    <div
      className="start-page tx-scroll-reveal"
      role="region"
      aria-label={t.startPageTab}
    >
      <div className="start-page-body">
        <header className="start-page-brand">
          <img
            className="start-page-mark"
            src={mark}
            alt=""
            width={128}
            height={128}
          />
          <h1 className="start-page-title">Textus</h1>
        </header>
        <StartActions t={t} look="buttons" />
        {anyRecent && (
          <div className="start-page-recents">
            <FolderChips
              title={t.startPageRecentProjects}
              paths={recents.folders}
              // A folder shows a document of its own too: the sidebar
              // alone changing left the start page looking untouched.
              onOpen={(folder) => {
                emitToThisWindow("menu-open-recent-folder", folder);
                void openingDocuments(folder, recents.files).then((docs) =>
                  docs.length
                    ? emitToThisWindow("open-project-documents", docs)
                    : setEmpty(folder),
                );
              }}
            />
            <RecentList
              title={t.startPageRecentFiles}
              paths={recents.files}
              event="menu-open-recent"
              icon={<MarkdownFileIcon />}
              onRemove={removeRecent}
              removeLabel={t.startPageRemoveRecent}
            />
          </div>
        )}
      </div>
    </div>
  );
}
