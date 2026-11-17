import { useEffect, useMemo, useSyncExternalStore } from "react";
import { menuIpc } from "../../platform/ipc";
import { hasNativeMenuBar, isDesktopApp } from "../../platform/capabilities";
import { runCommand } from "../../registry/commands";
import type { PluginMenuEntry } from "../../registry/menu/plugin-menu";
import { pluginsSnapshot, subscribePlugins } from "../store/plugin-records";
import { pluginMenuEntries } from "../store/plugin-lookup";
import { usePluginFormats } from "../../registry/plugin-export-formats";

/** What the Plugins menu lists now. */
export function usePluginMenuEntries(language: string): PluginMenuEntry[] {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  return useMemo(
    () => pluginMenuEntries(snapshot, "app/plugins", language),
    [snapshot, language],
  );
}

/** Keeps the native Plugins menu and the tray menu to what plugins put there,
 *  and runs a command picked in the tray while no window was open. */
export function usePluginMenuSync(language: string): void {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  const entries = usePluginMenuEntries(language);
  const key = JSON.stringify(entries);
  useEffect(() => {
    if (hasNativeMenuBar) void menuIpc.setPluginMenu(JSON.parse(key));
  }, [key]);
  const formats = usePluginFormats();
  const exports = JSON.stringify(
    formats.map(({ key, label }) => ({ key, label })),
  );
  // Formats are each window's own (its plugins register them as they run),
  // and a click goes to the focused window: the menu bar shows its list.
  useEffect(() => {
    if (!hasNativeMenuBar) return;
    const send = () => void menuIpc.setPluginExports(JSON.parse(exports));
    if (document.hasFocus()) send();
    window.addEventListener("focus", send);
    return () => window.removeEventListener("focus", send);
  }, [exports]);
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
