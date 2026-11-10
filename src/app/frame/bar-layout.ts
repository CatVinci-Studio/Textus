/**
 * What the window bar holds at its start, and in how many rows, for a
 * platform and a window's state (design-language.md 5.7). The rail's
 * column is the bar's first: with the rail, Windows' and Linux's app menu
 * sits in it at the rail's icons' size, and the rail's icons open the
 * sidebar, so the bar has no sidebar button; without it, the button comes
 * back. The menu bar spelled out has a row of its own, the islands and the
 * rail under it - but in Zen, with no documents' tabs, it keeps to one.
 */

export type BarPlatform = "macos" | "windows" | "linux" | "ios";

/** At the bar's start, in order: the traffic lights' room, the app menu,
 *  the sidebar's button, the menu bar's titles. */
export type BarItem = "lights" | "menu" | "sidebar-toggle" | "menu-bar";

export interface BarLayout {
  /** 2: the menu bar is a row of its own over the islands. */
  rows: 1 | 2;
  lead: BarItem[];
  /** The app menu sits in the rail's column. */
  menuInRail: boolean;
}

export function barLayout({
  platform,
  menuBar,
  rail,
  zen,
  fullscreen,
}: {
  platform: BarPlatform;
  /** The menu bar spelled out (Windows and Linux only). */
  menuBar: boolean;
  /** The activity rail is on. */
  rail: boolean;
  zen: boolean;
  fullscreen: boolean;
}): BarLayout {
  // An iPhone or iPad: its menu, the sidebar opened from its own bar.
  if (platform === "ios") return { rows: 1, lead: ["menu"], menuInRail: false };
  const railShown = rail && !zen;
  const toggle: BarItem[] = railShown ? [] : ["sidebar-toggle"];
  if (platform === "macos")
    return {
      rows: 1,
      lead: [...(fullscreen ? [] : (["lights"] as BarItem[])), ...toggle],
      menuInRail: false,
    };
  // In Zen no documents' tabs need a row under the menu bar: it shares
  // the bar's row with the AI island's.
  if (menuBar)
    return { rows: zen ? 1 : 2, lead: ["menu-bar"], menuInRail: false };
  return { rows: 1, lead: ["menu", ...toggle], menuInRail: railShown };
}
