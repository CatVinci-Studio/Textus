import { openDocumentAt } from "../registry/open-documents";
import { hasWillSave, runWillSave } from "../plugins/contributions/will-save";
import { announceFileCreated } from "../utils/events";
import { fill } from "../i18n/fill";
import {
  showChoice,
  showConfirm,
  showMessage,
} from "../engine/controls/app-dialog";
import { placesSaved } from "../document/last-places";
import { takeDiskText } from "../document/useExternalChangeReload";
import { migrateDraftImages } from "../editor/images/image-migration";
import { basename } from "../utils/path";
import { isDocumentName } from "../files/document-name";
import {
  readDocText,
  fileExists,
  statMtime,
  tabIsDirty,
  writeDocFile,
  type DocTab,
} from "../document/doc-tabs";
import {
  fileTextFor,
  setTrackedWriter,
  writeRevisions,
} from "../document/tracked-file";
import type { SaveOutcome } from "../document/autosave";
import { session } from "../platform/ipc";
import { moveConversations } from "../ai/chat/chat-history";
import { emitPluginEvent } from "../plugins/app-bridge";
import type { Strings } from "../i18n/strings";
import type { TabState } from "./tabs/useTabState";
import { errorText } from "../utils/error-text";
import { explainError } from "../utils/error-explain";

import { useCallback, useEffect } from "react";
import type { Serialized } from "./useAutosaveTab";

/** Writes a document, or says why it couldn't and resolves false. */
type WriteOrReport = (
  path: string,
  content: string,
  from?: string | null,
) => Promise<boolean>;

/** Writing a document's file, or saying why it couldn't, and a draft's
 *  first file (or a document's new one) adopted by its tab. */
export function useFileWrites({
  tabState,
  t,
  imageFolder,
}: {
  tabState: TabState;
  t: Strings;
  imageFolder: string;
}) {
  const { liveTabs, updateTab } = tabState;
  // Writes a document, or says why it couldn't and resolves false; the tab
  // stays dirty, so nothing is lost. A tracked document's file gets its
  // original, its changes going beside it; `from` is where it was tracked.
  const writeOrReport = useCallback(
    async (
      path: string,
      content: string,
      from: string | null = path,
    ): Promise<boolean> => {
      try {
        await writeDocFile(path, fileTextFor(from, content));
        await writeRevisions(path, content, from);
        return true;
      } catch (err) {
        const lines = [
          fill(t.saveFailedMessage, { name: basename(path) }),
          /read-only|permission denied/i.test(errorText(err))
            ? t.saveReadOnlyHint
            : explainError(err, t),
        ];
        await showMessage(lines.join("\n"), {
          title: t.saveFailedTitle,
          tone: "error",
        });
        return false;
      }
    },
    [t],
  );

  // A draft's first file, or a document's new one: written, its images
  // brought along, and the tab pointed at it. The model has the path at
  // once, so an autosave right behind this one doesn't save it again.
  const adoptFile = useCallback(
    async (tab: DocTab, picked: string, auto: boolean): Promise<boolean> => {
      // Saved over a file already there: not a new one to plugins.
      const existed = await fileExists(picked);
      if (!(await writeOrReport(picked, tab.content, tab.path))) return false;
      void session.addRecentFile(picked);
      if (!existed) announceFileCreated(picked);
      // Pasted images in a first-saved draft move into its image folder with
      // relative paths; saved to another folder, relative images are copied.
      let { content } = tab;
      try {
        const migration = await migrateDraftImages(
          picked,
          tab.content,
          imageFolder,
          tab.path,
        );
        if (migration.migrated) {
          content = migration.content;
          await writeDocFile(picked, content);
        }
        if (migration.failed.length > 0) {
          void showMessage(
            `${t.imageMigrationFailedMessage}\n${migration.failed.join("\n")}`,
            {
              title: t.imageMigrationFailedTitle,
              tone: "warning",
            },
          );
        }
      } catch (err) {
        console.error("[image-migration] failed:", err);
      }
      // Typing during an autosave stays, its pictures pointed where they
      // moved to as well: the editor loads the rewritten text either way.
      const live = liveTabs().find((tb) => tb.id === tab.id)?.content;
      const shown =
        live === undefined || live === tab.content
          ? content
          : movedPictures(tab.content, content, live);
      const patch: Partial<DocTab> = {
        path: picked,
        importedFrom: undefined,
        savedContent: content,
        diskMtime: await statMtime(picked),
        ...(shown !== (live ?? tab.content)
          ? { content: shown, reloadKey: tab.reloadKey + 1 }
          : {}),
      };
      updateTab(tab.id, patch);
      // Its past conversations follow it to the new name.
      if (tab.path) moveConversations(tab.path, picked);
      emitPluginEvent("didSave", {
        path: picked,
        text: content,
        trigger: auto ? "auto" : "manual",
      });
      if (!auto) emitPluginEvent("activity", { kind: "saved" });
      return true;
    },
    [updateTab, liveTabs, t, imageFolder, writeOrReport],
  );

  return { writeOrReport, adoptFile };
}

/** File > Save to a document's own file: asking first when it changed on
 *  disk, letting plugins change the text, and keeping the tab in step. A
 *  tracked document's original that moves is written at once as well. */
export function useSaveToPath({
  tabState,
  t,
  writeOrReport,
  serialized,
}: {
  tabState: TabState;
  t: Strings;
  writeOrReport: WriteOrReport;
  serialized: Serialized;
}) {
  const { liveTabs, updateTab } = tabState;
  // Into the model at once, so a save right behind this one compares
  // against this write's mtime and doesn't see it as external.
  const commitSaved = useCallback(
    async (tabId: string, path: string, content: string, auto: boolean) => {
      const patch = { savedContent: content, diskMtime: await statMtime(path) };
      const was = liveTabs().find((tab) => tab.id === tabId)?.diskMtime;
      placesSaved(path, was ?? null, patch.diskMtime);
      updateTab(tabId, patch);
      // Plugins listening for saves (version history) are told.
      emitPluginEvent("didSave", {
        path,
        text: content,
        trigger: auto ? "auto" : "manual",
      });
      if (!auto) emitPluginEvent("activity", { kind: "saved" });
    },
    [updateTab, liveTabs],
  );

  // "conflict": the file changed on disk and the user didn't overwrite it
  // (kept it, or took its text).
  // `auto`: the prompt starts on Cancel, since the user didn't ask to save.
  const saveToPath = useCallback(
    async (tabId: string, auto: boolean): Promise<SaveOutcome> => {
      const tab = liveTabs().find((tb) => tb.id === tabId);
      if (!tab?.path) return "skipped";
      // Changed, moved or deleted on disk since it was read: ask before
      // writing, so a file renamed elsewhere isn't recreated under its old name.
      if (tab.diskMtime !== null) {
        const current = await statMtime(tab.path);
        if (current !== tab.diskMtime) {
          if (current === null) {
            const recreate = await showConfirm(t.fileGoneOnDiskMessage, {
              title: t.fileGoneOnDiskTitle,
              okLabel: t.fileGoneOnDiskRecreate,
              cancelLabel: t.cancel,
              focusCancel: auto,
            });
            if (!recreate) return "conflict";
          } else {
            // Overwrite it with this text, or take the other text instead.
            const choice = await showChoice(t.fileChangedOnDiskMessage, {
              title: t.fileChangedOnDiskTitle,
              okLabel: t.fileChangedOnDiskOverwrite,
              altLabel: t.fileChangedOnDiskReload,
              cancelLabel: t.cancel,
              focusCancel: auto,
            });
            if (choice === "alt") {
              const disk = await readDocText(tab.path).catch(() => null);
              const live = liveTabs().find((tb) => tb.id === tabId);
              if (disk !== null && live)
                takeDiskText(live, disk, current, liveTabs, updateTab);
            }
            if (choice !== "ok") return "conflict";
          }
        }
      }
      // Changed by a plugin: what the editor now holds, as it writes files;
      // with no rendered editor (source mode), the plugin's text, which the
      // tab takes too.
      const changed = await beforeSave(
        tab.path,
        tab.content,
        auto ? "auto" : "manual",
      );
      const content =
        changed === null
          ? tab.content
          : changed.inEditor
            ? (liveTabs().find((tb) => tb.id === tabId)?.content ?? tab.content)
            : changed.text;
      if (changed && !changed.inEditor) updateTab(tabId, { content });
      if (!(await writeOrReport(tab.path, content))) return "failed";
      await commitSaved(tabId, tab.path, content, auto);
      return "saved";
    },
    [liveTabs, updateTab, t, writeOrReport, commitSaved],
  );

  // A tracked document's original moved with nothing unsaved in it: its file
  // follows at once, as a save would write it.
  useEffect(() => {
    setTrackedWriter((path) => {
      const tab = liveTabs().find((tb) => tb.path === path);
      if (!tab || tabIsDirty(tab)) return;
      void serialized(tab.id, async () => {
        if (await writeOrReport(path, tab.content))
          await commitSaved(tab.id, path, tab.content, true);
      });
    });
    return () => setTrackedWriter(null);
  }, [liveTabs, serialized, writeOrReport, commitSaved]);

  return saveToPath;
}

/**
 * Lets onWillSave plugins change the text to save, put into the rendered
 * editor first as one undo step so what is saved is what shows. Null when
 * unchanged; `inEditor` false when no rendered editor took it.
 */
async function beforeSave(
  path: string,
  text: string,
  trigger: "manual" | "auto",
): Promise<{ text: string; inEditor: boolean } | null> {
  // Plugins change Markdown on save; a plain text file is kept as typed.
  if (!hasWillSave() || !isDocumentName(path)) return null;
  const changed = await runWillSave(path, text, trigger);
  if (changed === text) return null;
  const doc = openDocumentAt(path);
  return {
    text: changed,
    inEditor: !!doc?.replaceText(changed, doc.revision()),
  };
}

/** A picture's address in Markdown or HTML. */

const PICTURE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)|<img\b[^>]*\bsrc=["']([^"']+)/g;
const pictures = (text: string) =>
  [...text.matchAll(PICTURE)].map((m) => m[1] ?? m[2]);

/** `live` with each picture `before` had pointed where `after` points it:
 *  the addresses a save moved, applied to text typed since. */
export function movedPictures(before: string, after: string, live: string) {
  const from = pictures(before);
  const to = pictures(after);
  if (from.length !== to.length) return live;
  let out = live;
  from.forEach((src, i) => {
    if (src !== to[i]) out = out.split(src).join(to[i]);
  });
  return out;
}
