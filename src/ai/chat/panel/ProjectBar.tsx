import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "../../../ui/Tooltip";
import { ai, exportDoc, type AgentWorkspaceInfo } from "../../../platform/ipc";
import type { LibraryUse } from "../../../platform/ipc";
import {
  canPickFolder,
  canRevealInFileManager,
  isDesktopApp,
} from "../../../platform/capabilities";
import { useSettings } from "../../../prefs/SettingsContext";
import { useCloseOnOutsideClick } from "../../../utils/hooks/useCloseOnOutsideClick";
import { Presence, PresenceDiv } from "../../../engine/motion/usePresence";
import { basename } from "../../../utils/path";
import { knownDocumentsDir } from "../../../platform/documents-path";
import { APP_NAME } from "../../../i18n/names";
import { ChevronIcon, FolderIcon } from "../../../ui/icons";
import { ActionSheet, type ActionSheetItem } from "../../../ui/ActionSheet";
import { usePhoneLayout } from "../../../ui/usePhoneLayout";
import { MemorySections } from "./MemoryView";
import { RememberedSection } from "./RememberedSection";
import { useProjectActions } from "./project-actions";

/** The folder row's menu. Not closed by an outside click on a phone: a tap
 *  on the portalled action sheet would count as outside. */
function useProjectMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const phone = usePhoneLayout();
  const menuRef = useCloseOnOutsideClick<HTMLDivElement>(
    closeMenu,
    true,
    menuOpen && !phone,
  );
  return { menuOpen, setMenuOpen, closeMenu, menuRef, phone };
}

/** The project the document belongs to: undefined until the first load
 *  answers, so "no root" is never said before anyone has looked. */
function useProjectWorkspace(
  docPath: string | null,
  workspaceRoot: string | null,
) {
  const [info, setInfo] = useState<AgentWorkspaceInfo | null | undefined>(
    undefined,
  );
  const reload = useCallback(() => {
    ai.loadAgentWorkspace(docPath, workspaceRoot)
      .then((ws) => setInfo(ws ?? null))
      .catch(() => setInfo(null));
  }, [docPath, workspaceRoot]);
  useEffect(reload, [reload]);
  // Files under .textus/ change outside this component (edited in a tab):
  // re-read whenever the window regains focus.
  useEffect(() => {
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);
  return { info, reload };
}

/** The Memory tab's "used" marks: which library entries Rust sent. Asked
 *  once typing rests: the text is only the guess before any request. */
function useLibraryUse(
  memory: boolean,
  info: AgentWorkspaceInfo | null | undefined,
  docPath: string | null,
  workspaceRoot: string | null,
  documentText: string,
) {
  const [libraryUse, setLibraryUse] = useState<LibraryUse | null>(null);
  useEffect(() => {
    if (!memory || !info?.root) return;
    let live = true;
    // Once typing rests: the text is only the guess before any request.
    const timer = setTimeout(() => {
      ai.libraryUse(docPath, workspaceRoot, documentText)
        .then((use) => live && setLibraryUse(use))
        .catch(() => live && setLibraryUse(null));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [memory, info, docPath, workspaceRoot, documentText]);
  return libraryUse;
}

/** A new library entry being named: the field, focused as it opens. */
function useEntryNaming() {
  const [naming, setNaming] = useState(false);
  const [entryName, setEntryName] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (naming) nameInput.current?.focus();
  }, [naming]);
  return { naming, setNaming, entryName, setEntryName, nameInput };
}

/**
 * The project the conversation works in, under the AI panel's header: the
 * folder Textus AI may read, and the files kept in its .textus/ folder.
 */
export function ProjectBar({
  docPath,
  memory = false,
  documentText = "",
}: {
  docPath: string | null;
  /** The AI panel's Memory tab: the folder row without its chips, then
   *  everything the project keeps. */
  memory?: boolean;
  /** The open document's text, to mark the library entries it mentions. */
  documentText?: string;
}) {
  const { t, settings, setSettings } = useSettings();
  const workspaceRoot = settings.agentWorkspaceRoot || null;
  const { menuOpen, setMenuOpen, closeMenu, menuRef, phone } = useProjectMenu();
  const { info, reload } = useProjectWorkspace(docPath, workspaceRoot);
  const libraryUse = useLibraryUse(
    memory,
    info,
    docPath,
    workspaceRoot,
    documentText,
  );
  const { naming, setNaming, entryName, setEntryName, nameInput } =
    useEntryNaming();
  const root = info?.root ?? null;
  const {
    busy,
    message,
    pickFolder,
    learnStyle,
    importReferences,
    openStyle,
    openInstructions,
    createEntry,
    openGlobalInstructions,
    memoryActions,
  } = useProjectActions({
    docPath,
    root,
    reload,
    closeMenu,
    endNaming: () => {
      setNaming(false);
      setEntryName("");
    },
  });

  // Still loading: say nothing, or "too broad" flashes on a slow device each
  // time the panel opens.
  if (info === undefined) return null;
  // No folder open simply means no project yet: nothing to say up front. A
  // folder too broad to read is worth saying, once.
  if (!root) {
    const tooBroad = info?.root_source === "tooBroad";
    if (memory)
      return (
        <>
          <div className="project-bar project-bar-empty memory-no-project">
            {tooBroad ? t.projectTooBroad : t.memoryNeedsSave}
          </div>
          {info && info.memories.items.length > 0 && (
            <div className="project-bar project-bar-memory">
              <RememberedSection
                info={info}
                t={t}
                lang={settings.language}
                {...memoryActions}
              />
            </div>
          )}
        </>
      );
    if (!tooBroad) return null;
    return (
      <div className="project-bar project-bar-empty">{t.projectTooBroad}</div>
    );
  }

  // One list for both forms: a dropdown under the folder name, or on a
  // phone the same items as an action sheet headed by the folder.
  const hasFolderItems =
    canPickFolder || !!workspaceRoot || canRevealInFileManager;
  const menuItems: (ActionSheetItem | "separator")[] = [
    ...(canPickFolder
      ? [{ label: t.projectPickFolder, onSelect: pickFolder }]
      : []),
    ...(workspaceRoot
      ? [
          {
            label: t.projectNoFolder,
            onSelect: () => {
              setMenuOpen(false);
              setSettings({ agentWorkspaceRoot: "" });
            },
          },
        ]
      : []),
    ...(canRevealInFileManager
      ? [
          {
            label: t.projectReveal,
            onSelect: () => {
              setMenuOpen(false);
              void exportDoc.revealInDir(root);
            },
          },
        ]
      : []),
    ...(hasFolderItems ? (["separator"] as const) : []),
    { label: t.projectLearnStyle, onSelect: learnStyle },
    {
      label: info?.style ? t.projectOpenStyle : t.projectCreateStyle,
      onSelect: openStyle,
    },
    {
      label: t.projectNewEntry,
      onSelect: () => {
        setMenuOpen(false);
        setNaming(true);
      },
    },
    { label: t.projectEditInstructions, onSelect: openInstructions },
    "separator",
    {
      label: t.projectImportReferences,
      onSelect: () => void importReferences(false),
    },
    // The folder picker this uses is the desktop dialog's.
    ...(isDesktopApp
      ? [
          {
            label: t.projectImportReferenceFolder,
            onSelect: () => void importReferences(true),
          },
        ]
      : []),
  ];
  // iOS: the app's own Documents folder is "Textus" in the Files app, and
  // "Documents" was English in every language.
  const trimmed = root.replace(/[\\/]+$/, "");
  const documents = knownDocumentsDir()?.replace(/[\\/]+$/, "");
  const folderName =
    documents && trimmed === documents ? APP_NAME : basename(trimmed) || root;

  return (
    <div className={`project-bar${memory ? " project-bar-memory" : ""}`}>
      <div className="project-bar-row" ref={menuRef}>
        <button
          type="button"
          className="project-bar-folder"
          title={t.projectFolderTitle.replace("{path}", root)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <FolderIcon className="project-bar-icon" />
          <span className="project-bar-name">{folderName}</span>
          <ChevronIcon className="project-bar-chevron" />
        </button>
        {info?.style && !memory && (
          <Tooltip text={t.projectOpenStyle}>
            <button
              type="button"
              className="project-bar-chip"
              onClick={openStyle}
            >
              {t.projectStyleChip}
            </button>
          </Tooltip>
        )}
        {(info?.library.length ?? 0) > 0 && !memory && (
          <span className="project-bar-chip project-bar-chip-static">
            {t.projectLibraryChip.replace(
              "{n}",
              String(info?.library.length ?? 0),
            )}
          </span>
        )}
        <Presence show={menuOpen && !phone} exitMs={120}>
          {menuOpen && !phone && (
            <PresenceDiv
              className="project-bar-menu floating-surface"
              role="menu"
            >
              {menuItems.map((item, i) =>
                item === "separator" ? (
                  <div key={i} className="project-bar-menu-sep" />
                ) : (
                  <button key={i} role="menuitem" onClick={item.onSelect}>
                    {item.label}
                  </button>
                ),
              )}
            </PresenceDiv>
          )}
        </Presence>
      </div>
      <Presence show={menuOpen && phone} exitMs={250}>
        {menuOpen && phone && (
          <ActionSheet
            title={folderName}
            items={menuItems}
            onClose={closeMenu}
          />
        )}
      </Presence>
      {naming && (
        <form
          className="project-bar-naming"
          onSubmit={(e) => {
            e.preventDefault();
            if (entryName.trim()) createEntry(entryName);
          }}
        >
          <input
            ref={nameInput}
            value={entryName}
            placeholder={t.projectEntryPlaceholder}
            aria-label={t.projectEntryPlaceholder}
            onChange={(e) => setEntryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setNaming(false);
              }
            }}
          />
          <button type="submit" disabled={!entryName.trim()}>
            {t.projectEntryCreate}
          </button>
        </form>
      )}
      {(busy || message) && (
        <div className="project-bar-status" role="status">
          {busy ?? message}
        </div>
      )}
      {memory && info && (
        <MemorySections
          info={info}
          t={t}
          lang={settings.language}
          libraryUse={libraryUse}
          onOpenStyle={openStyle}
          onLearnStyle={learnStyle}
          onNewEntry={() => setNaming(true)}
          onOpenInstructions={openInstructions}
          onOpenGlobalInstructions={openGlobalInstructions}
          {...memoryActions}
        />
      )}
    </div>
  );
}
