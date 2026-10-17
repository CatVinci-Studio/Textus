import { useEffect } from "react";
import { drafts, workspaceDrafts, windowIpc } from "../platform/ipc";
import { canUseWindows, hasAppMenu, isIOSApp } from "../platform/capabilities";
import { lastIOSDocument } from "./ios-recents";
import {
  helpDocContent,
  makeBlankTab,
  readDocFromDisk,
  type DocTab,
  type HelpDoc,
} from "./doc-tabs";
import type { NewDocumentMode } from "../settings/SettingsContext";

// Module-scoped, NOT a ref: React StrictMode (dev builds) runs mount effects
// twice on the same component, and this drain is a destructive pull from
// shared Rust-side queues (and the drafts store) - a second run would steal
// content meant for other windows or double-claim recovered drafts. Module
// state survives the StrictMode remount; separate windows are separate
// webviews with their own module instance, so each window still drains
// exactly once.
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
  openPathInTab: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  startTutorial: (tabId: string) => void;
  stopTutorial: () => void;
}

/**
 * Everything that can claim this window's initial blank tab (or add extra
 * ones) at launch, in priority order: a tab dragged in from another window
 * (which short-circuits everything else - see below), recovered drafts (2.4,
 * never steals focus - just adds tabs), a Help doc this window was spawned to
 * show, OS-handed-over file paths, and finally - if nothing else claimed
 * anything - the first-run tutorial. Runs exactly
 * once per window, at mount; the effect deliberately uses `[]` (not the
 * values it closes over) since a later change to any of them shouldn't
 * re-trigger a second drain.
 */
export function useStartupRestore(opts: StartupRestoreOptions): void {
  useEffect(() => {
    if (drained) return;
    drained = true;
    // Puts a document into the initial blank tab. Its editor may well have
    // mounted already (it is lazy-loaded, and everything below awaits IPC
    // first), and an editor reads its content once, at mount - so without
    // a remount it went on showing the blank tab's empty document while the
    // tab held the file: the word count right, the page empty, and typing
    // there would have replaced the file's text on the next save. Moving
    // reloadKey on remounts it on the new content, as app/useFileOpening.ts's
    // replaceTabWithFile does; before the editor has mounted it costs
    // nothing.
    const loadIntoInitialTab = (doc: Partial<DocTab>) =>
      opts.setTabs((prev) =>
        prev.map((tab) =>
          tab.id === opts.activeTabId
            ? { ...tab, ...doc, reloadKey: tab.reloadKey + 1 }
            : tab,
        ),
      );
    void (async () => {
      // A tab dragged out of another window's tab bar (see TabBar.tsx /
      // detachTab). Checked FIRST, ahead of draft recovery: this window was
      // created for this one document and must claim nothing else. Draft
      // recovery below is a DESTRUCTIVE drain of the app-wide snapshot pool,
      // and the dragged tab's own snapshot is very likely still in it - the
      // source window clears it asynchronously (draft-autosave.ts) with no
      // ordering guarantee against this window mounting. Draining here would
      // re-add the dragged document as a "recovered" tab and then land it a
      // second time as the detached tab.
      const detached = canUseWindows ? await windowIpc.takeDetachedTab() : null;
      if (detached) {
        opts.stopTutorial();
        loadIntoInitialTab(detached);
        return;
      }
      // Recovered drafts (2.4): content a previous run snapshotted but never
      // resolved (crash, forced quit) - added as extra tabs, never stealing
      // focus from whatever this launch's OS-open/session claim below picks.
      // Skipped entirely while the privacy toggle is off - any leftover
      // snapshot files just sit unread until Clear or a re-enable.
      const draftSnapshots = opts.enableDraftRecovery
        ? ((await drafts.takeDraftSnapshots()) ?? [])
        : [];
      const workspaceSnapshots = opts.enableDraftRecovery
        ? await workspaceDrafts.takeRecoveries().catch(() => [])
        : [];
      for (const workspace of workspaceSnapshots ?? []) {
        const existing = draftSnapshots.find(
          (d) =>
            (d.tabId === (workspace.tabId ?? workspace.documentId) &&
              d.path === workspace.documentPath) ||
            (workspace.documentPath && d.path === workspace.documentPath),
        );
        if (existing) existing.workspaceId = workspace.documentId;
        else
          draftSnapshots.push({
            tabId: workspace.documentId,
            path: workspace.documentPath,
            content: workspace.draft.baseMarkdown,
            workspaceId: workspace.documentId,
            workspaceOnly: true,
          });
      }
      const restored: DocTab[] = [];
      if (draftSnapshots.length > 0) {
        for (const draft of draftSnapshots) {
          if (!draft.path) {
            restored.push({
              ...makeBlankTab(),
              workspaceId: draft.workspaceId,
              content: draft.content,
              savedContent: "",
            });
            continue;
          }
          try {
            const { content: diskContent, diskMtime } = await readDocFromDisk(
              draft.path,
            );
            if (diskContent === draft.content && !draft.workspaceId) continue;
            restored.push({
              ...makeBlankTab(),
              workspaceId: draft.workspaceId,
              path: draft.path,
              content: draft.workspaceOnly ? diskContent : draft.content,
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
      // A Help menu doc clicked with no window open: this window was
      // spawned to show it, so the bundled document rides the blank
      // initial tab instead of opening next to it. "welcome" starts the
      // tutorial on that same already-blank tab instead (same as clicking
      // the Help menu item directly would - see startWelcomeTutorial).
      const helpDoc: string | null = hasAppMenu
        ? await windowIpc.takePendingShowHelp()
        : null;
      if (helpDoc === "markdown" || helpDoc === "agent") {
        // A tutorial can be persisted from a previous window. A window born
        // specifically to show a guide must not restore that overlay on top
        // of the guide (nor treat the guide's bundled text as practice).
        opts.stopTutorial();
        const content = helpDocContent(helpDoc as HelpDoc, opts.language);
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
      // A document whose unsaved edits were just recovered opens once, with
      // those edits - not once as saved and again as a recovered tab (the
      // session reopens the files a crash left open, drafts and all).
      const recoveredFor = (path: string) =>
        restored.find((tab) => tab.path === path);
      const loadRecoveredIntoInitialTab = (recovered: DocTab) => {
        loadIntoInitialTab({
          path: recovered.path,
          workspaceId: recovered.workspaceId,
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
          } else {
            const { content: text, diskMtime } = await readDocFromDisk(first);
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
            await opts.openPathInTab(p);
          }
          return;
        }
      } else {
        const pending = await windowIpc.takePendingOpenPath();
        if (pending) {
          opts.stopTutorial();
          const recovered = recoveredFor(pending);
          if (recovered) loadRecoveredIntoInitialTab(recovered);
          else await opts.openFile(pending);
          return;
        }
      }
      // iOS: the document that was open last time (see lastIOSDocument).
      const last = isIOSApp ? await lastIOSDocument() : null;
      // Its unsaved edits were just recovered into a tab of their own: that
      // tab takes the initial one's place rather than the document opening
      // twice, once as saved and once as recovered.
      const recovered = last ? recoveredFor(last) : undefined;
      if (recovered) {
        loadRecoveredIntoInitialTab(recovered);
        return;
      }
      if (last) {
        try {
          const { content: text, diskMtime } = await readDocFromDisk(last);
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
      // Recovered drafts and nothing else to open: the first of them takes
      // the blank initial tab, rather than an empty "Untitled" opening
      // beside what was recovered.
      if (restored.length > 0) {
        loadRecoveredIntoInitialTab(restored[0]);
        return;
      }
      // Nothing else claimed the initial blank tab and this installation has
      // never shown onboarding. Keeping the durable flag false until this
      // exact point means a first launch that was busy opening a file can
      // defer the guide safely to the next ordinary launch instead of losing
      // it forever.
      // Not on the iPhone: the lessons are taught with keyboard shortcuts.
      if (!opts.onboardingShown) {
        if (!isIOSApp) opts.startTutorial(opts.activeTabId);
        opts.markOnboardingShown();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
