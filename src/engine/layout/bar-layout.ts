/**
 * What the window bar holds at its start, and in how many rows, for a
 * platform and a window's state (design-language.md 5.7). The rail's
 * column is the bar's first: with the rail shown, Windows' and Linux's app
 * menu sits in it at the rail's icons' size. With the rail on, its icons
 * open the sidebar and the bar has no sidebar button; turned off, the
 * button opens the rail and the sidebar together and folds both away. The menu bar spelled out has a row of its own, the islands and the
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
  /** Nothing of the bar's lies over the sidebar's column (no traffic
   *  lights): the sidebar reaches the window's top. */
  sideToTop: boolean;
  /** Nothing over the rail's column either (a Mac in full screen): the
   *  rail starts at the top too. */
  railToTop: boolean;
}

export function barLayout({
  platform,
  menuBar,
  rail,
  railOff,
  zen,
  fullscreen,
}: {
  platform: BarPlatform;
  /** The menu bar spelled out (Windows and Linux only). */
  menuBar: boolean;
  /** The activity rail is shown. */
  rail: boolean;
  /** The rail is turned off: it shows only with the sidebar, the bar's
   *  button opening and folding both. */
  railOff: boolean;
  zen: boolean;
  fullscreen: boolean;
}): BarLayout {
  const none = { menuInRail: false, sideToTop: false, railToTop: false };
  // An iPhone or iPad: its menu, the sidebar opened from its own bar.
  if (platform === "ios") return { rows: 1, lead: ["menu"], ...none };
  const railShown = rail && !zen;
  const toggle: BarItem[] = railOff || zen ? ["sidebar-toggle"] : [];
  // The rail turned off but shown with the sidebar: the bar keeps its
  // place - its sidebar button stays where it was clicked to fold it again.
  const toTop = railShown && !railOff;
  // In full screen the lights are gone: with the rail, the bar leaves the
  // left columns alone.
  if (platform === "macos")
    return {
      rows: 1,
      lead: [...(fullscreen ? [] : (["lights"] as BarItem[])), ...toggle],
      ...none,
      sideToTop: fullscreen && toTop,
      railToTop: fullscreen && toTop,
    };
  // In Zen no tabs need a row under the menu bar.
  if (menuBar) return { rows: zen ? 1 : 2, lead: ["menu-bar"], ...none };
  return {
    rows: 1,
    lead: ["menu", ...toggle],
    ...none,
    menuInRail: toTop,
    sideToTop: toTop,
  };
}
