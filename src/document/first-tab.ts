import { readBoot } from "../storage/boot";
import { canUseWindows, isMobileApp } from "../platform/capabilities";
import { loadSettings } from "../prefs/settings-store";
import type { Settings } from "../prefs/settings-types";
import { pageReloaded } from "./launch-window";
import { afterStartupRestore } from "./reload-tabs";
import { makeBlankTab, makeStartTab, type DocTab } from "./doc-tabs";

/** A window with nothing to open shows the start page, when chosen. */
export function launchesStartPage(
  settings: Pick<Settings, "startPageOnLaunch" | "restoreSessionOnStartup">,
): boolean {
  return settings.startPageOnLaunch && !settings.restoreSessionOnStartup;
}

/** Whether something may open in this window as it starts. Unsure (no boot
 *  snapshot, a phone, a reload) is yes: wrong that way, the sheet is empty
 *  a moment; wrong the other, what it showed is swapped. */
function mayRestore(): boolean {
  const boot = readBoot();
  return !boot || boot.restoring || isMobileApp || pageReloaded();
}

/** The tab dragged out into this window, handed over in its boot snapshot;
 *  a reload replays that snapshot, and gets its kept tabs instead. */
export function bootDetachedTab(): Partial<DocTab> | null {
  return pageReloaded() ? null : (readBoot()?.detachedTab ?? null);
}

/** Whether the start page shows when nothing opens. Never shown before
 *  the tour, which starts in the blank document instead. */
function startPageShows(): boolean {
  const settings = loadSettings();
  return (
    canUseWindows && settings.onboardingShown && launchesStartPage(settings)
  );
}

/** The window's tab in its first frame: the tab dragged into it, the start
 *  page when nothing will open, else a blank document something may take. */
export function firstTab(): DocTab {
  const detached = bootDetachedTab();
  if (detached) return { ...makeBlankTab(), ...detached };
  return !mayRestore() && startPageShows() ? makeStartTab() : makeBlankTab();
}

/** The longest the sheets wait for the restore before showing what is there. */
const HOLD_MS = 1000;

/** Holds the islands' sheets back (`data-restoring`, split-panes.css) until
 *  what the launch's restore opened has painted, so the blank document it
 *  replaces never shows. Before the first render. A restore may end on the
 *  start page: `loadStartPage` loads it meanwhile, so it shows at once. */
export function holdSheetsWhileRestoring(
  loadStartPage: () => Promise<unknown>,
): void {
  if (!mayRestore() || bootDetachedTab()) return;
  const root = document.documentElement;
  root.dataset.restoring = "";
  const ready = startPageShows() ? loadStartPage().catch(() => {}) : null;
  const show = () => {
    clearTimeout(timer);
    delete root.dataset.restoring;
  };
  // Armed until shown: a hidden window gets no frames.
  const timer = setTimeout(show, HOLD_MS);
  afterStartupRestore(() => {
    // Two frames: React has committed the restored tabs, and painted them.
    void Promise.resolve(ready).then(() =>
      requestAnimationFrame(() => requestAnimationFrame(show)),
    );
  });
}
