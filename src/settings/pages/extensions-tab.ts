// Which tab Settings › Extensions opens on, kept apart from the page so
// what links there needn't load it.

import { PLUGINS_SHOWN } from "../../plugins/store/availability";

export type ExtensionsTab = "plugins" | "themes" | "skills" | "mcp";

/** The page's tabs, in order; Plugins only where the app shows plugins. */
export function extensionsTabs(pluginsShown = PLUGINS_SHOWN): ExtensionsTab[] {
  return pluginsShown
    ? ["themes", "plugins", "skills", "mcp"]
    : ["themes", "skills", "mcp"];
}

/** The tab Extensions opens on: the last one shown, or the one another page
 *  sent the user to. */
let lastTab: ExtensionsTab = extensionsTabs()[0];

/** Makes the next Extensions page open on `tab` (Textus AI's Skills row
 *  goes to Skills). */
export function openExtensionsTab(tab: ExtensionsTab): void {
  lastTab = tab;
}

export function extensionsStartTab(): ExtensionsTab {
  const tabs = extensionsTabs();
  return tabs.includes(lastTab) ? lastTab : tabs[0];
}
