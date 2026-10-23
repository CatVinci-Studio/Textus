import { useEffect, useMemo, useSyncExternalStore } from "react";
import { menuIpc } from "../platform/ipc";
import { hasNativeMenuBar, isDesktopApp } from "../platform/capabilities";
import { runCommand } from "../app/commands";
import type { PluginMenuEntry } from "../app/app-menu-model";
import {
  pluginMenuEntries,
  pluginsSnapshot,
  subscribePlugins,
} from "./manager";

/** What the Plugins menu lists now - the app-drawn menu's (AppMenu.tsx). */
export function usePluginMenuEntries(language: string): PluginMenuEntry[] {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  return useMemo(
    () => pluginMenuEntries(snapshot, "app/plugins", language),
    [snapshot, language],
  );
}

/** Keeps the macOS menu bar's Plugins menu (menu.rs) to the same list,
 *  and background mode's tray menu to what plugins put there - and runs a
 *  command picked in the tray while no window was open, once this
 *  window's plugins are on. */
export function usePluginMenuSync(language: string): void {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const entries = usePluginMenuEntries(language);
  const key = JSON.stringify(entries);
  useEffect(() => {
    if (hasNativeMenuBar) void menuIpc.setPluginMenu(JSON.parse(key));
  }, [key]);
  // Read afresh each render: a new language re-renders this, and the
  // labels follow it.
  const tray = JSON.stringify(pluginMenuEntries(snapshot, "app/tray"));
  useEffect(() => {
    if (isDesktopApp) void menuIpc.setTrayPluginItems(JSON.parse(tray));
  }, [tray]);
  const loaded = snapshot.loaded;
  useEffect(() => {
    if (!loaded || !isDesktopApp) return;
    void menuIpc
      .takePendingPluginCommand()
      .then((command) => command && runCommand(command))
      .catch(() => {});
  }, [loaded]);
}
