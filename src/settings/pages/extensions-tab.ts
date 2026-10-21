// Which tab Settings › Extensions opens on, apart from the page itself so
// that what sends the user there (the app's Plugins menu, Textus AI's
// Skills row) needn't load the page (lazy-module.ts).

export type ExtensionsTab = "plugins" | "themes" | "skills" | "mcp";

/** The tab Extensions opens on: the last one shown, or the one another
 *  page sent the user to (openExtensionsTab). */
let lastTab: ExtensionsTab = "plugins";

/** Makes the next Extensions page open on `tab` (Textus AI's Skills row
 *  goes to Skills). */
export function openExtensionsTab(tab: ExtensionsTab): void {
  lastTab = tab;
}

/** The tab the Extensions page opens on now. */
export function extensionsStartTab(): ExtensionsTab {
  return lastTab;
}
