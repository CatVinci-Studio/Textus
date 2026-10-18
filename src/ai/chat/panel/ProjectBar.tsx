import { useCallback, useEffect, useRef, useState } from "react";
import { ai, exportDoc, type AgentWorkspaceInfo } from "../../../platform/ipc";
import {
  canPickFolder,
  canRevealInFileManager,
} from "../../../platform/capabilities";
import { useSettings } from "../../../settings/SettingsContext";
import { useActiveProvider } from "../../provider-catalog";
import { useCloseOnOutsideClick } from "../../../utils/hooks/useCloseOnOutsideClick";
import { Presence, PresenceDiv } from "../../../ui/usePresence";
import { errorText } from "../../../utils/error-text";
import { OPEN_FILE_IN_TAB_EVENT } from "../../../utils/events";
import { basename } from "../../../utils/path";
import { knownDocumentsDir } from "../../../platform/documents-path";
import { APP_NAME } from "../../../i18n/names";
import { ChevronIcon, FolderIcon } from "../../../ui/icons";
import { ActionSheet, type ActionSheetItem } from "../../../ui/ActionSheet";
import { usePhoneLayout } from "../../../ui/usePhoneLayout";
import { MemorySections } from "./MemoryView";
import { convertLevisProject, offerLevisConversion } from "./levis-project";

function openInTab(path: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_FILE_IN_TAB_EVENT, { detail: path }),
  );
}

/** A library entry's file name: the name as typed, minus characters no
 *  file system accepts. Kept readable (CJK and all) - it is what the user
 *  sees in the folder. */
export function libraryFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return `${cleaned || "entry"}.md`;
}

/**
 * The project the conversation works in, under the AI panel's header: the
 * project folder Textus AI may read (and search, and @-mention), and the
 * project-level files kept in its .textus/ folder - the style profile, the
 * library of people, places and terms (src-tauri ai::project) and the
 * project's writing instructions (.textus/agent.md). The names follow
 * docs/design/ai-concepts.md. The folder used to be a setting three screens deep;
 * this is where it actually matters.
 */
export function ProjectBar({
  docPath,
  memory = false,
  documentText = "",
}: {
  docPath: string | null;
  /** The AI panel's Memory tab: the folder row without its chips, then
   *  everything the project keeps (MemoryView.tsx). */
  memory?: boolean;
  /** The open document's text, to mark the library entries it mentions. */
  documentText?: string;
}) {
  const { t, settings, setSettings } = useSettings();
  const provider = useActiveProvider();
  const workspaceRoot = settings.agentWorkspaceRoot || null;
  // undefined until the first load answers: "no root" means unsaved or too
  // broad, which mustn't be said before anyone has looked.
  const [info, setInfo] = useState<AgentWorkspaceInfo | null | undefined>(
    undefined,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [entryName, setEntryName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const phone = usePhoneLayout();
  // Not on a phone: the action sheet is portalled outside this row, so a
  // tap on one of its items would count as "outside" and close the menu
  // before the item's click arrived. The sheet dismisses itself.
  const menuRef = useCloseOnOutsideClick<HTMLDivElement>(
    closeMenu,
    true,
    menuOpen && !phone,
  );
  const nameInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    ai.loadAgentWorkspace(docPath, workspaceRoot)
      .then((ws) => setInfo(ws ?? null))
      .catch(() => setInfo(null));
  }, [docPath, workspaceRoot]);
  useEffect(reload, [reload]);
  // A Levis project's .levis/: asked once whether to convert it.
  const levisRoot = info?.levis_project ? info.root : null;
  useEffect(() => {
    if (!levisRoot) return;
    void offerLevisConversion(t, levisRoot, docPath, workspaceRoot).then(
      (converted) => converted && reload(),
    );
  }, [levisRoot, t, docPath, workspaceRoot, reload]);
  // Files under .textus/ change outside this component (edited in a tab):
  // re-read whenever the window regains focus.
  useEffect(() => {
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);
  useEffect(() => {
    if (naming) nameInput.current?.focus();
  }, [naming]);

  const root = info?.root ?? null;

  async function run(label: string, work: () => Promise<void>) {
    setMenuOpen(false);
    setBusy(label);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      const text = errorText(err);
      setMessage(
        text === "TOO_BROAD"
          ? t.projectTooBroad
          : text === "NO_SAMPLES"
            ? t.projectNoSamples
            : text === "NO_PROJECT"
              ? t.projectNeedsSave
              : text,
      );
    } finally {
      setBusy(null);
      reload();
    }
  }

  const pickFolder = () =>
    run(t.projectPicking, async () => {
      const picked = await ai.pickWorkspaceRoot();
      if (picked) setSettings({ agentWorkspaceRoot: picked });
    });

  const learnStyle = () =>
    run(t.projectLearningStyle, async () => {
      const files = await ai.pickTextFiles();
      if (!files || files.length === 0) return;
      const path = await ai.learnStyle({
        provider: settings.aiProvider,
        model:
          settings.agentModels[settings.aiProvider] ||
          provider?.agentDefaultModel ||
          null,
        docPath,
        workspaceRoot,
        files,
      });
      openInTab(path);
      setMessage(t.projectStyleLearned);
    });

  const openStyle = () =>
    run(t.projectOpening, async () => {
      openInTab(
        await ai.ensureProjectFile(
          docPath,
          workspaceRoot,
          "style.md",
          t.projectStyleTemplate,
        ),
      );
    });

  const openInstructions = () =>
    run(t.projectOpening, async () => {
      openInTab(
        await ai.ensureProjectFile(
          docPath,
          workspaceRoot,
          "agent.md",
          t.projectInstructionsTemplate,
        ),
      );
    });

  const createEntry = (name: string) =>
    run(t.projectOpening, async () => {
      setNaming(false);
      setEntryName("");
      const template = t.projectLibraryTemplate
        .split("{name}")
        .join(name.trim());
      openInTab(
        await ai.ensureProjectFile(
          docPath,
          workspaceRoot,
          `library/${libraryFileName(name)}`,
          template,
        ),
      );
    });

  // Still loading: say nothing. The answer takes one IPC round trip, long
  // enough on an iPhone for "too broad" to flash every time the panel
  // opened, or the app started with it open.
  const openGlobalInstructions = () =>
    run(t.projectOpening, async () => {
      openInTab(await ai.ensureGlobalAgentMd(t.agentInstructionsTemplate));
    });

  if (info === undefined) return null;
  // An unsaved draft simply has no project yet - nothing to say about it
  // up front (the Memory tab says why it is empty). A folder too broad to
  // read is worth saying, once.
  if (!root) {
    if (memory)
      return (
        <div className="project-bar project-bar-empty memory-no-project">
          {docPath ? t.projectTooBroad : t.memoryNeedsSave}
        </div>
      );
    if (!docPath) return null;
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
            label: t.projectUseDocFolder,
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
          <button
            type="button"
            className="project-bar-chip"
            title={t.projectOpenStyle}
            onClick={openStyle}
          >
            {t.projectStyleChip}
          </button>
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
          documentText={documentText}
          onOpenStyle={openStyle}
          onLearnStyle={learnStyle}
          onNewEntry={() => setNaming(true)}
          onOpenEntry={(entry) =>
            openInTab(`${trimmed}/${entry.file.replace(/^[\\/]+/, "")}`)
          }
          onOpenInstructions={openInstructions}
          onOpenGlobalInstructions={openGlobalInstructions}
          onConvertLevis={() =>
            void convertLevisProject(t, docPath, workspaceRoot).then(reload)
          }
        />
      )}
    </div>
  );
}
