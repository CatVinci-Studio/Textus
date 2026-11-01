import { useEffect } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { drafts, windowIpc } from "../platform/ipc";
import { canUseWindows, hasAppMenu, isIOSApp } from "../platform/capabilities";
import { lastIOSDocument } from "./ios-recents";
import {
  helpDocContent,
  makeBlankTab,
  readDocFromDisk,
  type DocTab,
  type HelpDoc,
} from "./doc-tabs";
import type { NewDocumentMode } from "../prefs/SettingsContext";
import { setTabJump } from "../editor/tab-jump";
import { lastCaret } from "./last-carets";
import { isWordDocument } from "./word-import";
import { loadPlugins } from "../plugins/manager";
import { customEditorFor } from "../plugins/store/plugin-lookup";
import { keptTabsRestored, readKeptTabs, type KeptTab } from "./reload-tabs";

/** Whether a plugin opens `path` in a tab of its own (a PDF). */
async function opensInPlugin(path: string): Promise<boolean> {
  await loadPlugins().catch(() => {});
  return customEditorFor(path) !== null;
}

// Module-scoped, not a ref: StrictMode runs mount effects twice, and this
// drain is a destructive pull from shared queues. Each window is its own
// webview, so each still drains exactly once.
let drained = false;

export interface StartupRestoreOptions {
  activeTabId: string;
  enableDraftRecovery: boolean;
  newDocumentMode: NewDocumentMode;
  language: string;
  onboardingShown: boolean;
  setTabs: (updater: (prev: DocTab[]) => DocTab[]) => void;
  setDraftsRestoredCount: (n: number) => void;
  markOnboardingShown: () => void;
  openPathInTab: (
    path: string,
    open?: { restoreCaret?: boolean },
  ) => Promise<void>;
  openFile: (path: string, open?: { restoreCaret?: boolean }) => Promise<void>;
  /** Opens `path` in tab `tabId`, in place of what it holds. */
  replaceTabWithFile: (tabId: string, path: string) => Promise<void>;
  /** Reopened documents come back at the caret they were left at. */
  restoreCarets: boolean;
  startTutorial: (tabId: string) => void;
  stopTutorial: () => void;
}

/** A kept tab as it was, its text read again from disk unless it had
 *  unsaved text of its own; null once its file is gone. */
async function keptTab(
  kept: KeptTab,
  language: string,
): Promise<Partial<DocTab> | null> {
  const shape = {
    path: kept.path,
    helpDoc: kept.helpDoc,
    draftTitle: kept.draftTitle,
    sourceMode: kept.sourceMode ?? false,
  };
  if (kept.text) return { ...shape, ...kept.text };
  if (kept.helpDoc) {
    const content = await helpDocContent(kept.helpDoc, language);
    return { ...shape, content, savedContent: content };
  }
  if (!kept.path) return null;
  try {
    const { content, diskMtime } = await readDocFromDisk(kept.path);
    return { ...shape, content, savedContent: content, diskMtime };
  } catch {
    return null;
  }
}

/**
 * Everything that can claim this window's initial blank tab at launch, in
 * priority order. Runs once per window: later option changes must not
 * trigger a second drain.
 */
export function useStartupRestore(options: StartupRestoreOptions): void {
  const latest = useLatest(options);
  useEffect(() => {
    if (drained) return;
    drained = true;
    const opts = latest.current;
    // The blank tab's editor may already have mounted and read its content
    // once; moving reloadKey remounts it on the new document, or it would
    // show (and save) the empty one.
    const loadIntoInitialTab = (doc: Partial<DocTab>) =>
      opts.setTabs((prev) =>
        prev.map((tab) =>
          tab.id === opts.activeTabId
            ? { ...tab, ...doc, reloadKey: tab.reloadKey + 1 }
            : tab,
        ),
      );
    // At its last caret, taken by the editor its reloadKey remounts.
    const restoreCaret = (path: string, diskMtime: number | null) => {
      const at = opts.restoreCarets ? lastCaret(path, diskMtime) : null;
      if (at) setTabJump(opts.activeTabId, { kind: "caret", at });
    };
    void (async () => {
      // The page reloaded: the window gets back what it had. Everything
      // below was handed out at its first start.
      const kept = readKeptTabs();
      if (kept) {
        opts.stopTutorial();
        const docs = await Promise.all(
          kept.tabs.map((tab) => keptTab(tab, opts.language)),
        );
        const active = docs[kept.active];
        if (active?.path) restoreCaret(active.path, active.diskMtime ?? null);
        opts.setTabs((prev) => {
          const initial = prev.find((tab) => tab.id === opts.activeTabId);
          if (!initial) return prev;
          return docs.flatMap((doc, i) => {
            if (i === kept.active)
              return [
                {
                  ...initial,
                  ...(doc ?? {}),
                  reloadKey: initial.reloadKey + 1,
                },
              ];
            return doc ? [{ ...makeBlankTab(), ...doc }] : [];
          });
        });
        return;
      }
      // A tab dragged out of another window. Checked first: the draft drain
      // below would otherwise re-add it, since its source window clears its
      // snapshot asynchronously.
      const detached = canUseWindows ? await windowIpc.takeDetachedTab() : null;
      if (detached) {
        opts.stopTutorial();
        loadIntoInitialTab(detached);
        return;
      }
      // Recovered drafts from a crash or forced quit, added as extra tabs
      // without stealing focus. Skipped while the privacy toggle is off.
      const draftSnapshots = opts.enableDraftRecovery
        ? ((await drafts.takeDraftSnapshots()) ?? [])
        : [];
      const restored: DocTab[] = [];
      if (draftSnapshots.length > 0) {
        for (const draft of draftSnapshots) {
          if (!draft.path) {
            restored.push({
              ...makeBlankTab(),
              content: draft.content,
              savedContent: "",
            });
            continue;
          }
          try {
            const { content: diskContent, diskMtime } = await readDocFromDisk(
              draft.path,
            );
            if (diskContent === draft.content) continue; // disk already matches - nothing to recover
            restored.push({
              ...makeBlankTab(),
              path: draft.path,
              content: draft.content,
              savedContent: diskContent,
              diskMtime,
            });
          } catch {
            continue; // file gone or unreadable since the snapshot was taken
          }
        }
        if (restored.length > 0) {
          opts.setTabs((prev) => [...prev, ...restored]);
          opts.setDraftsRestoredCount(restored.length);
        }
      }
      // A Help doc clicked with no window open: this window was spawned to
      // show it in the blank tab. "welcome" starts the tutorial there.
      const helpDoc: string | null = hasAppMenu
        ? await windowIpc.takePendingShowHelp()
        : null;
      if (helpDoc === "markdown" || helpDoc === "agent") {
        // A window born to show a guide must not restore a persisted
        // tutorial over it.
        opts.stopTutorial();
        const content = await helpDocContent(helpDoc as HelpDoc, opts.language);
        loadIntoInitialTab({
          content,
          savedContent: content,
          helpDoc: helpDoc as HelpDoc,
        });
        return;
      }
      if (helpDoc === "welcome") {
        opts.startTutorial(opts.activeTabId);
        if (!opts.onboardingShown) opts.markOnboardingShown();
        return;
      }
      // A document with recovered edits opens once, with those edits.
      const recoveredFor = (path: string) =>
        restored.find((tab) => tab.path === path);
      const loadRecoveredIntoInitialTab = (recovered: DocTab) => {
        loadIntoInitialTab({
          path: recovered.path,
          content: recovered.content,
          savedContent: recovered.savedContent,
          diskMtime: recovered.diskMtime,
        });
        opts.setTabs((prev) => prev.filter((tab) => tab.id !== recovered.id));
      };
      if (opts.newDocumentMode === "tab") {
        const paths = await windowIpc.takePendingOpenPaths();
        if (paths.length > 0) {
          opts.stopTutorial();
          const [first, ...rest] = paths;
          const recovered = recoveredFor(first);
          if (recovered) {
            loadRecoveredIntoInitialTab(recovered);
          } else if (isWordDocument(first) || (await opensInPlugin(first))) {
            // Converted into the initial tab, or shown there by a plugin.
            await opts.replaceTabWithFile(opts.activeTabId, first);
          } else {
            const { content: text, diskMtime } = await readDocFromDisk(first);
            restoreCaret(first, diskMtime);
            loadIntoInitialTab({
              path: first,
              content: text,
              savedContent: text,
              diskMtime,
            });
          }
          for (const p of rest) {
            // Its recovered tab is already open: that is this document.
            if (recoveredFor(p)) continue;
            await opts.openPathInTab(p, { restoreCaret: true });
          }
          return;
        }
      } else {
        // This window's documents: one opened from outside, or the tabs it
        // had last session.
        const [pending, ...rest] = await windowIpc.takePendingWindowPaths();
        if (pending) {
          opts.stopTutorial();
          const recovered = recoveredFor(pending);
          if (recovered) loadRecoveredIntoInitialTab(recovered);
          else await opts.openFile(pending, { restoreCaret: true });
          for (const p of rest) {
            if (recoveredFor(p)) continue;
            await opts.openPathInTab(p, { restoreCaret: true });
          }
          return;
        }
      }
      // iOS: the document that was open last time.
      const last = isIOSApp ? await lastIOSDocument() : null;
      // Its recovered tab takes the initial one's place, so it doesn't open
      // twice.
      const recovered = last ? recoveredFor(last) : undefined;
      if (recovered) {
        loadRecoveredIntoInitialTab(recovered);
        return;
      }
      if (last) {
        try {
          const { content: text, diskMtime } = await readDocFromDisk(last);
          restoreCaret(last, diskMtime);
          loadIntoInitialTab({
            path: last,
            content: text,
            savedContent: text,
            diskMtime,
          });
          return;
        } catch {
          // Moved or deleted since: start blank.
        }
      }
      // Only recovered drafts: the first takes the blank tab instead of an
      // empty "Untitled" beside them.
      if (restored.length > 0) {
        loadRecoveredIntoInitialTab(restored[0]);
        return;
      }
      // Nothing claimed the blank tab and onboarding was never shown. The
      // flag stays false until here, so a busy first launch defers the guide
      // instead of losing it. Not on the iPhone: it teaches shortcuts.
      if (!opts.onboardingShown) {
        if (!isIOSApp) opts.startTutorial(opts.activeTabId);
        opts.markOnboardingShown();
      }
    })().finally(keptTabsRestored);
  }, [latest]);
}
