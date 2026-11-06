import { useEffect, useState } from "react";
import { readRecents } from "./menu/recents";
import { emitToThisWindow } from "../platform/menu-events";
import { NO_RECENTS, type RecentLists } from "./menu/app-menu-model";
import { basename, dirname } from "../utils/path";
import { formatCombo } from "../utils/shortcuts";
import type { Strings } from "../i18n/strings";
import "./start-page.css";

/** Recent projects and files each list this many at most. */
const RECENT_SHOWN = 5;

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

function RecentList({
  title,
  paths,
  event,
}: {
  title: string;
  paths: string[];
  /** The menu event that opens one, here. */
  event: string;
}) {
  if (paths.length === 0) return null;
  return (
    <section className="start-page-recent" aria-label={title}>
      <h2 className="start-page-heading">{title}</h2>
      {paths.slice(0, RECENT_SHOWN).map((path) => (
        <button
          key={path}
          type="button"
          className="start-page-row"
          onClick={() => emitToThisWindow(event, path)}
        >
          <span className="start-page-name">
            {basename(path.replace(/[\\/]+$/, "")) || path}
          </span>
          <span className="start-page-where">{dirname(path)}</span>
        </button>
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
  // Run here as the menu items' events, not through the native menu: in a
  // window-per-document setup that would open another window.
  const actions: { label: string; event: string; combo?: string }[] = [
    { label: t.menuNewFile, event: "menu-new-file", combo: "mod+n" },
    { label: t.menuOpenFile, event: "menu-open-file", combo: "mod+o" },
    { label: t.menuOpenFolder, event: "menu-open-folder" },
  ];
  return (
    <div className="start-page" role="region" aria-label={t.startPageTab}>
      <div className="start-page-body">
        <h1 className="start-page-title">Textus</h1>
        <div className="start-page-actions">
          {actions.map((a) => (
            <button
              key={a.event}
              type="button"
              className="start-page-row"
              onClick={() => emitToThisWindow(a.event)}
            >
              <span className="start-page-name">{a.label}</span>
              {a.combo && (
                <span className="start-page-where">{formatCombo(a.combo)}</span>
              )}
            </button>
          ))}
        </div>
        <RecentList
          title={t.startPageRecentProjects}
          paths={recents.folders}
          event="menu-open-recent-folder"
        />
        <RecentList
          title={t.startPageRecentFiles}
          paths={recents.files}
          event="menu-open-recent"
        />
      </div>
    </div>
  );
}
