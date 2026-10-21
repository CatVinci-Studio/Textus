import { registerCommand, runCommand } from "./app/commands";
import { registerSidebarTab } from "./app/sidebar-tabs";
import { registerEditorMenuItems } from "./editor/editor-menu";
import { registerSettingsPage } from "./settings/settings-pages";

/**
 * The places other code can add to the app, gathered in one object - the
 * draft of the plugin API (docs/dev/plugin-api.md). Each `register*`
 * returns the function that takes back what it added.
 *
 *   commands        an action, its name and optionally a shortcut
 *   editorMenu      items in the editor's right-click menu
 *   sidebarTabs     a tab in the sidebar, after Files, Outline, Clipboard
 *   settingsPages   a page in Settings, after the built-in ones
 *
 * Not loaded from anywhere yet: plugins come in 1.3. A development build
 * puts it on `window.__textusPlugins`, for the e2e flows and for trying an
 * extension out from the console.
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
  (window as unknown as { __textusPlugins?: PluginApi }).__textusPlugins =
    pluginApi;
}
