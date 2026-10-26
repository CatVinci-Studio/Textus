import { registerCommand, runCommand } from "./app/commands";
import { registerSidebarTab } from "./app/sidebar-tabs";
import { registerEditorMenuItems } from "./editor/editor-menu-items";
import { registerSettingsPage } from "./settings/settings-pages";

/**
 * The places other code can add to the app: commands, editor menu items,
 * sidebar tabs and settings pages. Each `register*` returns its undo. A
 * development build puts it on `window.__textusPlugins`.
 */
export const pluginApi = {
  commands: { register: registerCommand, run: runCommand },
  editorMenu: { register: registerEditorMenuItems },
  sidebarTabs: { register: registerSidebarTab },
  settingsPages: { register: registerSettingsPage },
} as const;

export type PluginApi = typeof pluginApi;

/** Puts the API on the window in a development build. */
export function exposePluginApiForDevelopment(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  (window as Window & { __textusPlugins?: PluginApi }).__textusPlugins =
    pluginApi;
}
