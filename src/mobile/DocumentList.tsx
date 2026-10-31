import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../prefs/SettingsContext";
import { localeOf, plural } from "../i18n/strings";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { showConfirm, showMessage, showPrompt } from "../ui/app-dialog";
import {
  CloseIcon,
  FolderOpenIcon,
  GridViewIcon,
  ListViewIcon,
  MoreIcon,
} from "../ui/icons";
import { Presence, usePresenceProps } from "../ui/usePresence";
import { animate } from "../ui/motion";
import { ListMotion } from "../ui/flip";
import { fs } from "../platform/ipc";
import { getUiState, setUiState } from "../storage/ui-state";
import { basename, dirname } from "../utils/path";
import { useLongPress } from "../utils/hooks/useLongPress";
import { iosFiles } from "../platform/ios-files";
import {
  deleteIOSDocument,
  forgetIOSDocument,
  inIOSDocuments,
  recentIOSDocuments,
  renameIOSDocument,
} from "../document/ios-recents";
import "./DocumentList.css";

/**
 * The iPhone's list of documents opened in Textus, newest first, as rows or
 * thumbnails. A document picked elsewhere in Files only granted access to the
 * file itself, so it can't be renamed or deleted.
 */
interface Entry {
  path: string;
  local: boolean;
  /** Last modified; null for a picked file (no stat through its URL). */
  mtime: number | null;
  /** The opening lines as plain text, for the thumbnail. */
  preview: string;
}

type View = "list" | "grid";
function loadView(): View {
  return getUiState("documentListView") === "grid" ? "grid" : "list";
}

/** The first lines of a Markdown document with its syntax mostly gone -
 *  enough to recognise it by, not a rendering. */
export function previewText(markdown: string): string {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .split("\n")
    .slice(0, 24)
    .map((line) =>
      line
        .replace(/^\s{0,3}((#{1,6}|>|[-*+]|\d+[.)])(\s+|$))+/, "")
        // A task's box: "[ ] Milk" read as raw syntax in the thumbnail.
        .replace(/^\[[ xX]\]\s+/, "")
        .replace(/(^|[^\\])[*_`~]+/g, "$1")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1"),
    )
    .join("\n")
    .trim()
    .slice(0, 600);
}

export interface DocumentListProps {
  activePath: string | null;
  onClose: () => void;
  onOpen: (path: string) => void;
  /** A document was renamed: open tabs follow it to its new path. */
  onRenamed: (from: string, to: string) => void;
  /** A document was deleted: an open tab keeps its text, unsaved. */
  onDeleted: (path: string) => void;
  /** Open a document from elsewhere in Files (the system picker). */
  onOpenOther: () => void;
}

/** The recent documents with where each lives, when it changed and how it
 *  begins; `seen` is what the list already showed, so a later arrival (a
 *  rename's new name) appears by itself; the first load just shows. */
function useRecentDocuments() {
  const [entries, setEntries] = useState<Entry[] | null>(null);

  // The list at once; each document's date and opening lines as they are
  // read, which for a file picked in Files goes through the system.
  const reload = useCallback(async () => {
    const paths = await recentIOSDocuments();
    const local = await Promise.all(paths.map(inIOSDocuments));
    setEntries(
      paths.map((path, i) => ({
        path,
        local: local[i],
        mtime: null,
        preview: "",
      })),
    );
    for (const path of paths)
      void Promise.all([
        fs.fileMtimeMs(path).catch(() => null),
        fs.readTextFile(path).then(previewText, () => ""),
      ]).then(([mtime, preview]) =>
        setEntries(
          (now) =>
            now?.map((entry) =>
              entry.path === path ? { ...entry, mtime, preview } : entry,
            ) ?? now,
        ),
      );
  }, []);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (entries) seen.current = new Set(entries.map((entry) => entry.path));
  }, [entries]);

  useEffect(() => {
    void reload();
  }, [reload]);
  return { entries, reload, seen };
}

export function DocumentList({
  activePath,
  onClose,
  onOpen,
  onRenamed,
  onDeleted,
  onOpenOther,
}: DocumentListProps) {
  const { t, settings } = useSettings();
  const [view, setView] = useState<View>(loadView);
  // Rendered inside a Presence: it goes back down as it closes.
  const presence = usePresenceProps<HTMLDivElement>();

  // Switching between rows and tiles crossfades the body rather than moving
  // each document.
  const bodyRef = useRef<HTMLDivElement>(null);
  const { entries, reload, seen } = useRecentDocuments();
  function switchView(next: View) {
    if (next === view) return;
    setView(next);
    setUiState("documentListView", next);
    if (bodyRef.current)
      animate(bodyRef.current, [{ opacity: 0 }, { opacity: 1 }], {
        duration: "--dur-fast",
        easing: "--ease-out",
      });
  }

  const dateFormat = new Intl.DateTimeFormat(localeOf(settings.language), {
    dateStyle: "medium",
  });
  const timeFormat = new Intl.DateTimeFormat(localeOf(settings.language), {
    timeStyle: "short",
  });
  const when = (mtime: number | null) => {
    if (mtime === null) return "";
    const d = new Date(mtime);
    return d.toDateString() === new Date().toDateString()
      ? timeFormat.format(d)
      : dateFormat.format(d);
  };

  const fail = (error: unknown) =>
    showMessage(String(error), { title: t.docActionFailed, tone: "error" });

  async function rename(entry: Entry) {
    const name = await showPrompt(t.docRenamePrompt, basename(entry.path), {
      title: t.docRename,
      okLabel: t.docRenameOk,
      cancelLabel: t.closePromptCancel,
    });
    if (!name || name === basename(entry.path)) return;
    try {
      const to = await renameIOSDocument(entry.path, name);
      onRenamed(entry.path, to);
      await reload();
    } catch (error) {
      await fail(error);
    }
  }

  async function remove(entry: Entry) {
    const ok = await showConfirm(
      t.docDeleteConfirm.replace("{name}", basename(entry.path)),
      {
        title: t.docDelete,
        tone: "warning",
        okLabel: t.docDeleteOk,
        cancelLabel: t.closePromptCancel,
        danger: true,
      },
    );
    if (!ok) return;
    try {
      await deleteIOSDocument(entry.path);
      onDeleted(entry.path);
      await reload();
    } catch (error) {
      await fail(error);
    }
  }

  function actions(entry: Entry): ContextMenuItem[] {
    return [
      { label: t.treeOpen, onSelect: () => onOpen(entry.path) },
      {
        label: t.menuShare,
        onSelect: () => void iosFiles.share(entry.path).catch(fail),
      },
      ...(entry.local
        ? [
            { label: t.docRename, onSelect: () => void rename(entry) },
            {
              label: t.docDelete,
              danger: true,
              onSelect: () => void remove(entry),
            },
          ]
        : [
            {
              label: t.docForget,
              onSelect: () => void forgetIOSDocument(entry.path).then(reload),
            },
          ]),
    ];
  }

  return (
    <div
      {...presence}
      className="document-list"
      role="dialog"
      aria-label={t.docListTitle}
    >
      <header className="document-list-header">
        <button
          type="button"
          className="document-list-icon-button"
          aria-label={t.docListClose}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
        <h2>{t.docListTitle}</h2>
        <button
          type="button"
          className="document-list-icon-button document-list-open-other"
          aria-label={t.docListOpenOther}
          onClick={onOpenOther}
        >
          <FolderOpenIcon />
        </button>
      </header>
      <div className="document-list-toolbar">
        <span className="document-list-count">
          {entries && entries.length > 0
            ? plural(t.docCount, entries.length, settings.language)
            : ""}
        </span>
        <div className="document-list-views" role="radiogroup" data-view={view}>
          {(
            [
              ["list", t.docViewList, <ListViewIcon key="l" />],
              ["grid", t.docViewGrid, <GridViewIcon key="g" />],
            ] as const
          ).map(([v, label, icon]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              aria-label={label}
              className="document-list-view-button"
              onClick={() => switchView(v)}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>
      <div ref={bodyRef} className={`document-list-body document-list-${view}`}>
        {/* A deleted document fades out where it was while the rest move
            up into its place. */}
        <ListMotion
          ids={entries?.map((entry) => entry.path) ?? []}
          container={bodyRef}
          ghostClass="document-item-ghost"
          exitMs={150}
          ghostsUnder={false}
        />
        {entries !== null && entries.length === 0 && (
          <p className="document-list-empty">{t.docListEmpty}</p>
        )}
        {entries?.map((entry) => (
          <DocumentItem
            key={entry.path}
            view={view}
            entry={entry}
            active={entry.path === activePath}
            fresh={seen.current !== null && !seen.current.has(entry.path)}
            detail={[
              when(entry.mtime),
              entry.local ? "Textus" : basename(dirname(entry.path)),
            ]
              .filter(Boolean)
              .join(" · ")}
            date={when(entry.mtime)}
            onOpen={() => onOpen(entry.path)}
            actions={() => actions(entry)}
            moreLabel={t.docMore}
          />
        ))}
      </div>
    </div>
  );
}

function DocumentItem({
  view,
  entry,
  active,
  fresh,
  detail,
  date,
  onOpen,
  actions,
  moreLabel,
}: {
  view: View;
  entry: Entry;
  active: boolean;
  /** New since the list first loaded. */
  fresh: boolean;
  /** Date and location, for a row. */
  detail: string;
  /** Date alone, under a thumbnail. */
  date: string;
  onOpen: () => void;
  actions: () => ContextMenuItem[];
  moreLabel: string;
}) {
  const press = useLongPress();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const at = menuAt ?? press.at;
  const name = basename(entry.path);
  const page = (
    <span className="document-page" aria-hidden>
      <span className="document-page-text">{entry.preview}</span>
    </span>
  );
  return (
    <div
      data-flip-id={entry.path}
      className={`document-item document-item-${view}${active ? " document-item-active" : ""}${fresh ? " document-item-new" : ""}`}
    >
      <button
        type="button"
        className="document-item-main"
        onClick={() => {
          if (!press.consumeClick()) onOpen();
        }}
        {...press.handlers}
      >
        {page}
        <span className="document-item-text">
          <span className="document-item-name">{name}</span>
          <span className="document-item-detail">
            {view === "grid" ? date : detail}
          </span>
        </span>
      </button>
      {view === "list" && (
        <button
          type="button"
          className="document-list-icon-button"
          aria-label={moreLabel}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ x: r.left, y: r.bottom });
          }}
        >
          <MoreIcon />
        </button>
      )}
      <Presence show={!!at} exitMs={250}>
        {at && (
          <ContextMenu
            x={at.x}
            y={at.y}
            title={name}
            items={actions()}
            onClose={() => {
              setMenuAt(null);
              press.close();
            }}
          />
        )}
      </Presence>
    </div>
  );
}
