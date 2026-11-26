import { useEffect } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { inOrder } from "../utils/in-order";
import { drafts, windowIpc } from "../platform/ipc";
import {
  canUseWindows,
  hasAppMenu,
  isMobileApp,
} from "../platform/capabilities";
import { lastIOSDocument } from "./ios-recents";
import {
  helpDocContent,
  makeBlankTab,
  readDocFromDisk,
  fileExists,
  tabIsUntouchedDraft,
  type DocTab,
  type HelpDoc,
} from "./doc-tabs";
import { setTabJump } from "../editor/tab-jump";
import { lastCaret, lastScroll } from "./last-places";
import { keptTabsRestored, readKeptTabs, type KeptTab } from "./reload-tabs";
import { takeWindowSession } from "./launch-window";
import { bootDetachedTab } from "./first-tab";
import { savedFront } from "../engine/layout/saved";
import { readTabOrder } from "./tab-order";
import { documentsDir } from "../platform/documents-path";
import { fileOf, restoreTabsInOrder } from "./phone-restore";
import { pluginTab } from "./plugin-tab";
import { loadPlugins } from "../plugins/manager";
import {
  customEditorFor,
  customEditorForContent,
} from "../plugins/store/plugin-lookup";
import {
  activateTab,
  paneOf,
  reorderInPane,
  setTabOrder,
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
 *  the old go, so a draft dropped since doesn't come back next launch. An
 *  old one whose new copy couldn't be written stays: it is the only one. */
export async function moveDrafts(
  kept: KeptTab[],
  newId: (i: number) => string | undefined,
): Promise<void> {
  await Promise.all(
    kept.map(async (tab, i) => {
      const id = newId(i);
      try {
        if (id && tab.text && tab.text.content !== tab.text.savedContent)
          await drafts.saveDraftSnapshot(
            id,
            tab.path,
            tab.text.content,
            tab.text.diskMtime,
          );
        if (tab.id) await drafts.clearDraftSnapshot(tab.id);
      } catch {
        /* Kept as it was; the next launch tries again. */
      }
    }),
  );
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
            ? { ...tab, start: false, ...doc, reloadKey: tab.reloadKey + 1 }
            : tab,
        ),
      );
    // At its last caret, taken by the editor its reloadKey remounts.
    const restoreCaret = (path: string, diskMtime: number | null) => {
      const at = opts.restoreCarets ? lastCaret(path, diskMtime) : null;
      if (at)
        setTabJump(opts.activeTabId, {
          kind: "caret",
          at,
          stay: !!lastScroll(path, diskMtime),
        });
    };
    void (async () => {
      // The page reloaded: the window gets back what it had. Everything
      // below was handed out at its first start.
      const kept = await readKeptTabs();
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
                  start: false,
                  ...(doc ?? {}),
                  reloadKey: initial.reloadKey + 1,
                },
              ];
            return made[i] ? [made[i]] : [];
          });
        });
        // The window's first tab was the one kept in front; the others
        // joined its island after it. Back to the place it was kept at.
        const pane = paneOf(windowLayout(), opts.activeTabId);
        if (pane)
          reorderInPane(
            pane,
            opts.activeTabId,
            docs.slice(0, kept.active).filter(Boolean).length,
          );
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
        // Taken all the same, so the drafts below don't bring it back;
        // already the first tab where the boot snapshot handed it over.
        if (!bootDetachedTab()) loadIntoInitialTab(detached);
        return;
      }
      // Recovered drafts from a crash or forced quit, added as extra tabs
      // without stealing focus. Skipped while the privacy toggle is off.
      const order = readTabOrder(
        isMobileApp ? await documentsDir().catch(() => null) : null,
      );
      const place = (id: string) => {
        const at = order.keys.indexOf(`id:${id}`);
        return at < 0 ? order.keys.length : at;
      };
      const draftSnapshots = (
        opts.enableDraftRecovery
          ? ((await drafts.takeDraftSnapshots()) ?? [])
          : []
      ).sort((a, b) => place(a.tabId) - place(b.tabId));
      const restored: DocTab[] = [];
      // The restored tab that was in front, by the id it had then.
      let frontDraft: DocTab | undefined;
      // Each restored tab's id before, its key in the order.
      const oldIds = new Map<string, string>();
      for (const draft of draftSnapshots) {
        const tab = await recoveredTab(draft);
        if (!tab) continue;
        restored.push(tab);
        oldIds.set(tab.id, draft.tabId);
        if (`id:${draft.tabId}` === order.active) frontDraft = tab;
      }
      if (restored.length > 0) {
        opts.setTabs((prev) => [...prev, ...restored]);
        opts.setDraftsRestoredCount(restored.length);
      }
      // Kept again under their new tabs before the taken copies go: a
      // crash in between brings them back next time.
      const resaved = draftSnapshots.length
        ? Promise.all(
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
            // Offered again next launch, the same drafts: say why.
            .catch((err: unknown) => console.error("[drafts] restore:", err))
        : Promise.resolve();
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
        // between still brings it back, and the next launch only once.
        void resaved
          .then(() =>
            drafts.saveDraftSnapshot(
              opts.activeTabId,
              recovered.path,
              recovered.content,
              recovered.diskMtime,
            ),
          )
          .then(() => drafts.clearDraftSnapshot(recovered.id))
          .catch((err: unknown) => console.error("[drafts] recover:", err));
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
      const front = taken?.opened?.[0] ?? savedFront(taken?.layout);
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
          !(await fileExists(firstUp[at]))
        )
          at++;
        const [first, ...rest] = firstUp.slice(at);
        const recovered = recoveredFor(first);
        if (recovered) {
          loadRecoveredIntoInitialTab(recovered);
        } else if (await fileExists(first)) {
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
          ordered = inOrder([...prev, ...fresh], (t) => fileOf(t) ?? "", paths);
          return ordered;
        });
        // The island takes that order too: it keeps its own tabs first.
        const pane = paneOf(windowLayout(), opts.activeTabId);
        if (pane && !splitLayout())
          setTabOrder(
            pane,
            ordered.map((tab) => tab.id),
          );
        // A draft was in front: it comes back in front, not the first file.
        if (frontDraft) activateTab(frontDraft.id);
        return;
      }
      // A phone: the tabs it had, saved ones and drafts, in their order;
      // a desktop's recovered drafts alone (its documents come with its
      // window's session).
      const last = isMobileApp ? await lastIOSDocument() : null;
      if (
        await restoreTabsInOrder({
          order,
          restored,
          oldIds,
          frontDraft,
          last,
          phone: isMobileApp,
          initial: opts.activeTabId,
          loadRecovered: loadRecoveredIntoInitialTab,
          loadFile: async (path) => {
            // A file a plugin shows (a .base, a board) is its tab again.
            await loadPlugins().catch(() => {});
            const editor = customEditorFor(path);
            if (editor) {
              loadIntoInitialTab(pluginTab(path, editor));
              return true;
            }
            try {
              const { content: text, diskMtime } = await readDocFromDisk(path);
              const claimed = customEditorForContent(path, text);
              if (claimed) {
                loadIntoInitialTab(pluginTab(path, claimed));
                return true;
              }
              restoreCaret(path, diskMtime);
              loadIntoInitialTab({
                path,
                content: text,
                savedContent: text,
                diskMtime,
              });
              return true;
            } catch {
              return false; // moved or deleted since
            }
          },
          tabsForPaths: opts.tabsForPaths,
          setTabs: opts.setTabs,
        })
      )
        return;
      // Nothing claimed the blank tab and onboarding was never shown. The
      // flag stays false until here, so a busy first launch defers the guide
      // instead of losing it. Not on a phone: it teaches shortcuts.
      if (!opts.onboardingShown) {
        if (!isMobileApp) opts.startTutorial(opts.activeTabId);
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

/** A draft found at launch as a tab; null when its file already says
 *  the same. */
async function recoveredTab(draft: {
  path: string | null;
  content: string;
  diskMtime?: number | null;
}): Promise<DocTab | null> {
  const untitled = {
    ...makeBlankTab(),
    content: draft.content,
    savedContent: "",
  };
  if (!draft.path) return untitled;
  try {
    const { content: diskContent, diskMtime } = await readDocFromDisk(
      draft.path,
    );
    if (diskContent === draft.content) return null;
    return {
      ...makeBlankTab(),
      path: draft.path,
      content: draft.content,
      savedContent: diskContent,
      // The time its edits began from: a file changed since then asks
      // before this is saved over it.
      diskMtime: draft.diskMtime ?? diskMtime,
    };
  } catch {
    // Its file is gone (renamed, or on a drive not mounted): the edits
    // come back untitled rather than not at all.
    return untitled;
  }
}
