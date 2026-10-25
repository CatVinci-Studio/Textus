// Which tab Settings › Extensions opens on, apart from the page itself so
// that what sends the user there (the app's Plugins menu, Textus AI's
// Skills row) needn't load the page (lazy-module.ts).

import { PLUGINS_SHOWN } from "../../plugins/availability";

export type ExtensionsTab = "plugins" | "themes" | "skills" | "mcp";

/** The page's tabs, in order: Plugins only where the app shows plugins
 *  (plugins/availability.ts). */
export function extensionsTabs(pluginsShown = PLUGINS_SHOWN): ExtensionsTab[] {
  return pluginsShown
    ? ["themes", "plugins", "skills", "mcp"]
    : ["themes", "skills", "mcp"];
}

/** The tab Extensions opens on: the last one shown, or the one another
 *  page sent the user to (openExtensionsTab). */
let lastTab: ExtensionsTab = extensionsTabs()[0];

/** Makes the next Extensions page open on `tab` (Textus AI's Skills row
 *  goes to Skills). */
export function openExtensionsTab(tab: ExtensionsTab): void {
  lastTab = tab;
}

/** The tab the Extensions page opens on now. */
export function extensionsStartTab(): ExtensionsTab {
  const tabs = extensionsTabs();
  return tabs.includes(lastTab) ? lastTab : tabs[0];
}
