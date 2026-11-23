// Which tab Settings › Extensions opens on, kept apart from the page so
// what links there needn't load it.

import { hasTextusAi, isDesktopApp } from "../../platform/capabilities";

export type ExtensionsTab = "plugins" | "themes" | "skills" | "mcp" | "create";

/** The page's tabs, in order; MCP servers only where the app can run their
 *  programs. Skills and Create (where Textus AI makes a theme, plugin or
 *  skill) only where there is Textus AI - not on iOS; Create comes last. */
export function extensionsTabs(
  mcp = isDesktopApp,
  ai = hasTextusAi,
): ExtensionsTab[] {
  return [
    "themes",
    "plugins",
    ...(ai ? (["skills"] as const) : []),
    ...(mcp ? (["mcp"] as const) : []),
    ...(ai ? (["create"] as const) : []),
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
