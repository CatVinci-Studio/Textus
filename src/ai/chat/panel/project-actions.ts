import { openDocument } from "../../../utils/open-document";
import { explainError } from "../../../utils/error-explain";
import { fill } from "../../../i18n/fill";
import { useState } from "react";
import { ai, exportDoc } from "../../../platform/ipc";
import type { LibraryEntry, Memory, MemoryScope } from "../../../platform/ipc";
import { useSettings } from "../../../prefs/SettingsContext";
import { useActiveProvider } from "../../provider-catalog";
import { showConfirm } from "../../../engine/controls/app-dialog";
import { libraryEntryId } from "./memory-text";

const openInTab = (path: string) => openDocument(path);

/** A library entry's file name: the name as typed, minus characters no
 *  file system accepts. Kept readable (CJK and all) - it is what the user
 *  sees in the folder. */
function libraryFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return `${cleaned || "entry"}.md`;
}

/**
 * What the project bar and the Memory tab can do with a project: pick its
 * folder, learn a style, import references, open or create its files, and
 * edit what it remembers. Each runs with a status line while it works and
 * a message when it ends or fails.
 */
export function useProjectActions({
  docPath,
  root,
  reload,
  endNaming,
}: {
  docPath: string | null;
  root: string | null;
  /** Re-reads the project once an action ends. */
  reload: () => void;
  endNaming: () => void;
}) {
  const { t, settings, setSettings } = useSettings();
  const provider = useActiveProvider();
  const workspaceRoot = settings.agentWorkspaceRoot || null;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /** `label`: what to show while it runs; null for something instant. */
  async function run(label: string | null, work: () => Promise<void>) {
    setBusy(label);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      setMessage(explainError(err, t));
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

  const importReferences = (folder: boolean) =>
    run(t.projectImportingReferences, async () => {
      const done = await ai.importReferences(docPath, workspaceRoot, folder);
      if (!done) return;
      setMessage(
        fill(
          done.skipped > 0
            ? t.projectReferencesImportedSkipped
            : t.projectReferencesImported,
          { n: String(done.imported), skipped: String(done.skipped) },
        ),
      );
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
      endNaming();
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

  const openGlobalInstructions = () =>
    run(t.projectOpening, async () => {
      openInTab(await ai.ensureGlobalAgentMd(t.agentInstructionsTemplate));
    });

  /** Deletes a memory or library entry once the user confirms. */
  const remove = async (id: string, question: string) => {
    const ok = await showConfirm(question, {
      okLabel: t.memoryDelete,
      cancelLabel: t.cancel,
      danger: true,
    });
    if (ok) await run(null, () => ai.memoryDelete(docPath, workspaceRoot, id));
  };

  /** What the Memory tab does with memories and library entries. */
  const memoryActions = {
    onOpenFile: openInTab,
    onRevealFile: (path: string) => void exportDoc.revealInDir(path),
    onOpenEntry: (entry: LibraryEntry) =>
      root &&
      openInTab(
        `${root.replace(/[\\/]+$/, "")}/${entry.file.replace(/^[\\/]+/, "")}`,
      ),
    onDeleteMemory: (m: Memory) => void remove(m.id, t.memoryDeleteConfirm),
    onDeleteEntry: (entry: LibraryEntry) =>
      void remove(
        libraryEntryId(entry),
        fill(t.memoryDeleteEntryConfirm, { name: entry.name }),
      ),
    onRestoreForgotten: (id: string) =>
      void run(null, async () => {
        await ai.memoryRestore(docPath, workspaceRoot, id);
      }),
    onMoveMemory: (m: Memory, scope: MemoryScope) =>
      void run(null, async () => {
        await ai.memoryMove(docPath, workspaceRoot, m.id, scope);
      }),
  };

  return {
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
  };
}
