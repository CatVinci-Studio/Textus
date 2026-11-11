// Which tab Settings › Extensions opens on, kept apart from the page so
// what links there needn't load it.

import { isDesktopApp } from "../../platform/capabilities";

export type ExtensionsTab = "plugins" | "themes" | "skills" | "mcp" | "create";

/** The page's tabs, in order; MCP servers only where the app can run their
 *  programs. Create, where Textus AI makes a theme, plugin or skill, comes
 *  last. */
export function extensionsTabs(mcp = isDesktopApp): ExtensionsTab[] {
  return [
    "themes",
    "plugins",
    "skills",
    ...(mcp ? (["mcp"] as const) : []),
    "create",
  ];
}

/** The tab Extensions opens on: the last one shown, or the one another page
 *  sent the user to. */
let lastTab: ExtensionsTab = extensionsTabs()[0];

/** Makes the next Extensions page open on `tab` (Textus AI's Skills row
 *  goes to Skills). */
export function openExtensionsTab(tab: ExtensionsTab): void {
  lastTab = tab;
}

/** The plugin whose page Plugins opens on next, once. */
let startPlugin: string | null = null;

/** Makes the next Extensions page open on plugin `id`'s page (its settings
 *  are there), from the Plugins menu. */
export function openPluginPage(id: string): void {
  lastTab = "plugins";
  startPlugin = id;
}

export function takeStartPlugin(): string | null {
  const id = startPlugin;
  startPlugin = null;
  return id;
}

export function extensionsStartTab(): ExtensionsTab {
  const tabs = extensionsTabs();
  return tabs.includes(lastTab) ? lastTab : tabs[0];
}
