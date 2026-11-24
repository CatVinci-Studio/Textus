// Which tab Settings › Extensions opens on, kept apart from the page so
// what links there needn't load it.

import { hasTextusAi, isDesktopApp } from "../../platform/capabilities";
import { isPhoneLayout } from "../../platform/phone-layout";

export type ExtensionsTab = "plugins" | "themes" | "skills" | "mcp" | "create";

/** What decides which tabs show. */
interface ExtensionsPlace {
  /** The app can run an MCP server's program. */
  mcp: boolean;
  /** Textus AI is offered (not on iOS). */
  ai: boolean;
  phone: boolean;
}

/** The page's tabs, in order, each where it shows. A phone's themes are
 *  Appearance's store and its skills Memory & Skills': one way in each.
 *  Create (where Textus AI makes a theme, plugin or skill) comes last. */
const TABS: [ExtensionsTab, (p: ExtensionsPlace) => boolean][] = [
  ["themes", (p) => !p.phone],
  ["plugins", () => true],
  ["skills", (p) => p.ai && !p.phone],
  ["mcp", (p) => p.mcp],
  ["create", (p) => p.ai],
];

export function extensionsTabs(
  place: ExtensionsPlace = {
    mcp: isDesktopApp,
    ai: hasTextusAi,
    phone: isPhoneLayout(),
  },
): ExtensionsTab[] {
  return TABS.filter(([, shows]) => shows(place)).map(([id]) => id);
}

/** The tab Extensions opens on: the last one shown, or the one another page
 *  sent the user to; else the first the layout shows when it opens. */
let lastTab: ExtensionsTab | null = null;

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
  return lastTab && tabs.includes(lastTab) ? lastTab : tabs[0];
}
