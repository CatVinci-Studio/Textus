import { useEffect, useMemo, useSyncExternalStore } from "react";
import { menuIpc } from "../platform/ipc";
import { hasNativeMenuBar } from "../platform/capabilities";
import type { PluginMenuEntry } from "../app/app-menu-model";
import {
  pluginMenuEntries,
  pluginsSnapshot,
  subscribePlugins,
} from "./manager";

/** What the Plugins menu lists now - the app-drawn menu's (AppMenu.tsx). */
export function usePluginMenuEntries(language: string): PluginMenuEntry[] {
  const snapshot = useSyncExternalStore(subscribePlugins, pluginsSnapshot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => pluginMenuEntries(snapshot), [snapshot, language]);
}

/** Keeps the macOS menu bar's Plugins menu (menu.rs) to the same list. */
export function usePluginMenuSync(language: string): void {
  const entries = usePluginMenuEntries(language);
  const key = JSON.stringify(entries);
  useEffect(() => {
    if (hasNativeMenuBar) void menuIpc.setPluginMenu(JSON.parse(key));
  }, [key]);
}
