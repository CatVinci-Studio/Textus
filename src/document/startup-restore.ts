import { useEffect } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { drafts, fs, windowIpc } from "../platform/ipc";
import { canUseWindows, hasAppMenu, isIOSApp } from "../platform/capabilities";
import { lastIOSDocument } from "./ios-recents";
import {
  helpDocContent,
  makeBlankTab,
  readDocFromDisk,
  tabIsUntouchedDraft,
  type DocTab,
  type HelpDoc,
} from "./doc-tabs";
import { setTabJump } from "../editor/tab-jump";
import { lastCaret } from "./last-places";
import { keptTabsRestored, readKeptTabs, type KeptTab } from "./reload-tabs";
import { takeWindowSession } from "./launch-window";
import { savedFront } from "../engine/layout/saved";
import {
  paneOf,
  reorderInPane,
  splitLayout,
  windowLayout,
} from "../engine/layout/store";

// Module-scoped, not a ref: StrictMode runs mount effects twice, and this
// drain is a destructive pull from shared queues. Each window is its own
// webview, so each still drains exactly once.
let drained = false;

interface StartupRestoreOptions {
  activeTabId: string;
  enableDraftRecovery: boolean;
  language: string;
  onboardingShown: boolean;
  setTabs: (updater: (prev: DocTab[]) => DocTab[]) => void;
  setDraftsRestoredCount: (n: number) => void;
  markOnboardingShown: () => void;
  openPathInTab: (
    path: string,
    open?: { restoreCaret?: boolean; reopening?: boolean },
  ) => Promise<void>;
  /** The tabs `paths` open into, read side by side, not yet added. */
  tabsForPaths: (paths: string[], reopening?: boolean) => Promise<DocTab[]>;
  openFile: (path: string, open?: { restoreCaret?: boolean }) => Promise<void>;
  /** Opens `path` in tab `tabId`, in place of what it holds. */
  replaceTabWithFile: (
    tabId: string,
    path: string,
    open?: { restoreCaret?: boolean; reopening?: boolean },
  ) => Promise<void>;
  /** Reopened documents come back at the caret they were left at. */
  restoreCarets: boolean;
  /** Nothing to open: the start page instead of a blank document. */
  launchStartPage: boolean;
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
  if (kept.view) return { ...shape, view: kept.view };
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

/** The drafts of tabs a reload gave new ids, kept under the new ones before
 *  the old go, so a draft dropped since doesn't come back next launch. */
async function moveDrafts(
  kept: KeptTab[],
  newId: (i: number) => string | undefined,
): Promise<void> {
  await Promise.all(
    kept.map((tab, i) => {
      const id = newId(i);
      return id && tab.text && tab.text.content !== tab.text.savedContent
        ? drafts.saveDraftSnapshot(
            id,
            tab.path,
            tab.text.content,
            tab.text.diskMtime,
          )
        : null;
    }),
  ).catch(() => {});
  await Promise.all(
    kept.map((tab) => tab.id && drafts.clearDraftSnapshot(tab.id)),
  ).catch(() => {});
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
        const made = docs.map((doc, i) =>
          doc && i !== kept.active ? { ...makeBlankTab(), ...doc } : null,
        );
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
            return made[i] ? [made[i]] : [];
          });
        });
        void moveDrafts(kept.tabs, (i) =>
          i === kept.active ? opts.activeTabId : made[i]?.id,
        );
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
              // The time its edits began from: a file changed since then
              // asks before this is saved over it.
              diskMtime: draft.diskMtime ?? diskMtime,
            });
          } catch {
            // Its file is gone (renamed, or on a drive not mounted): the
            // edits come back untitled rather than not at all.
            restored.push({
              ...makeBlankTab(),
              content: draft.content,
              savedContent: "",
            });
          }
        }
        if (restored.length > 0) {
          opts.setTabs((prev) => [...prev, ...restored]);
          opts.setDraftsRestoredCount(restored.length);
        }
        // Kept again under their new tabs before the taken copies go: a
        // crash in between brings them back next time.
        void Promise.all(
          restored.map((tab) =>
            drafts.saveDraftSnapshot(
              tab.id,
              tab.path,
              tab.content,
              tab.diskMtime,
            ),
          ),
        )
          .then(() => drafts.finishDraftRestore())
          .catch(() => undefined);
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
        // Kept under the tab it moves into before its own goes: a crash in
        // between still brings it back.
        void drafts
          .saveDraftSnapshot(
            opts.activeTabId,
            recovered.path,
            recovered.content,
            recovered.diskMtime,
          )
          .catch(() => undefined);
        loadIntoInitialTab({
          path: recovered.path,
          content: recovered.content,
          savedContent: recovered.savedContent,
          diskMtime: recovered.diskMtime,
        });
        opts.setTabs((prev) => prev.filter((tab) => tab.id !== recovered.id));
      };
      // This window's documents: ones opened from outside, or the tabs it had
      // last session (a window a tab was dragged out into is one of its own).
      const taken = await takeWindowSession();
      const paths = taken?.paths ?? [];
      // The one that ends up in front opens first, in the tab already
      // shown: nothing swaps in after it.
      const front = savedFront(taken?.layout);
      // A saved session (it has a layout), not files sent from outside:
      // opened as last time, with no plugin offered.
      const reopening = !!taken?.layout;
      const firstUp =
        front && paths.includes(front)
          ? [front, ...paths.filter((p) => p !== front)]
          : paths;
      if (paths.length > 0) {
        opts.stopTutorial();
        // One moved or deleted since gives its place to the next: the
        // others still open.
        let at = 0;
        while (
          at < firstUp.length - 1 &&
          !recoveredFor(firstUp[at]) &&
          !(await fileThere(firstUp[at]))
        )
          at++;
        const [first, ...rest] = firstUp.slice(at);
        const recovered = recoveredFor(first);
        if (recovered) {
          loadRecoveredIntoInitialTab(recovered);
        } else if (await fileThere(first)) {
          // Opened as any file is: a plugin's file or board, a Word
          // document, the recent list, its last caret.
          await opts.replaceTabWithFile(opts.activeTabId, first, {
            restoreCaret: true,
            reopening,
          });
        }
        // Gone too, the last of them: the blank tab stays. The rest come
        // in at once behind it, so the window doesn't flick through each;
        // its recovered tab is already open.
        // Behind the front, none offers a plugin: no card holds them back.
        const behind = await opts.tabsForPaths(
          rest.filter((p) => !recoveredFor(p)),
          true,
        );
        let ordered: DocTab[] = [];
        opts.setTabs((prev) => {
          // One the user opened meanwhile isn't opened twice.
          const open = new Set(prev.map(fileOf));
          const fresh = behind.filter((tab) => !open.has(fileOf(tab)));
          ordered = inSessionOrder([...prev, ...fresh], paths);
          return ordered;
        });
        // The island takes that order too: it keeps its own tabs first.
        const pane = paneOf(windowLayout(), opts.activeTabId);
        if (pane && !splitLayout())
          ordered.forEach((tab, i) => reorderInPane(pane, tab.id, i));
        return;
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
      } else if (opts.launchStartPage && canUseWindows) {
        opts.setTabs((prev) =>
          prev.map((tab) =>
            tab.id === opts.activeTabId && tabIsUntouchedDraft(tab)
              ? { ...tab, start: true }
              : tab,
          ),
        );
      }
    })().finally(keptTabsRestored);
  }, [latest]);
}

/** Whether a file is still where the last session left it. */
async function fileThere(path: string): Promise<boolean> {
  return (await fs.fileMtimeMs(path).catch(() => null)) !== null;
}

/** `tabs` with the session's documents, which arrive in any order, back in
 *  `paths`' order, in the places they took; the others stay put. */
/** The file a tab shows: its own, a plugin view's, or the one imported. */
const fileOf = (tab: DocTab) =>
  tab.path ?? tab.view?.resource ?? tab.importedFrom;

function inSessionOrder(tabs: DocTab[], paths: string[]): DocTab[] {
  const rank = new Map(paths.map((p, i) => [p, i]));
  const rankOf = (tab: DocTab) => {
    const path = fileOf(tab);
    return path ? (rank.get(path) ?? -1) : -1;
  };
  const sorted = tabs
    .filter((tab) => rankOf(tab) >= 0)
    .sort((a, b) => rankOf(a) - rankOf(b));
  let next = 0;
  const out = tabs.map((tab) => (rankOf(tab) >= 0 ? sorted[next++] : tab));
  return out.every((tab, i) => tab === tabs[i]) ? tabs : out;
}
