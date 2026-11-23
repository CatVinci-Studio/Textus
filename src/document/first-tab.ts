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

/** The window's tab in its first frame: the tab dragged into it, the start
 *  page when nothing will open, else a blank document something may take. */
export function firstTab(): DocTab {
  const detached = bootDetachedTab();
  if (detached) return { ...makeBlankTab(), ...detached };
  const settings = loadSettings();
  // Never shown: the tour starts in the blank document instead.
  return !mayRestore() &&
    canUseWindows &&
    settings.onboardingShown &&
    launchesStartPage(settings)
    ? makeStartTab()
    : makeBlankTab();
}

/** The longest the sheets wait for the restore before showing what is there. */
const HOLD_MS = 1000;

/** Holds the islands' sheets back (`data-restoring`, split-panes.css) until
 *  the launch's restore has opened what it opens, so the blank document
 *  it replaces never shows. Before the first render. */
export function holdSheetsWhileRestoring(): void {
  if (!mayRestore() || bootDetachedTab()) return;
  const root = document.documentElement;
  root.dataset.restoring = "";
  let stop = () => {};
  const timer = setTimeout(() => show(), HOLD_MS);
  const show = () => {
    clearTimeout(timer);
    stop();
    delete root.dataset.restoring;
  };
  stop = afterStartupRestore(show);
}
