import { useEffect, useSyncExternalStore } from "react";
import { makeBlankTab, type DocTab } from "../document/doc-tabs";
import type { Strings } from "../i18n/strings";
import { useLatest } from "../utils/hooks/useLatest";
import { registerCommand } from "../app/commands";
import type { TabState } from "../app/useTabState";
import type { OpenOptions } from "../app/useFileOpening";
import { emitPluginEvent, setWindowAccess, type PluginTabView } from "./app-bridge";
import {
  configurePlugins,
  loadPlugins,
  pluginsSnapshot,
  subscribePlugins,
  type PluginsSnapshot,
} from "./manager";
import { watchTheme, windowIsDark } from "./theme-vars";

/**
 * A window's side of the plugins: what it tells the manager (its strings,
 * language, theme), what plugins may ask of it (open a file, a tab of
 * theirs, the folder in the sidebar), and the events they may listen to.
 * Returns the plugins' current state, so the window draws again when one
 * is turned on or off - its sidebar tabs and menu items come and go.
 */
export function usePluginWindow({
  t,
  language,
  rootPath,
  activePath,
  tabState,
  openPathInTab,
}: {
  t: Strings;
  language: string;
  rootPath: string | null;
  activePath: string | null;
  tabState: TabState;
  openPathInTab: (path: string, open?: OpenOptions) => Promise<void>;
}): PluginsSnapshot {
  const tRef = useLatest(t);
  const languageRef = useLatest(language);
  const rootRef = useLatest(rootPath);
  const openRef = useLatest(openPathInTab);
  const { tabsRef, setTabs, setActiveTabId } = tabState;

  useEffect(() => {
    configurePlugins({
      strings: () => tRef.current,
      language: () => languageRef.current,
      dark: windowIsDark,
    });
    void loadPlugins();
  }, [tRef, languageRef]);

  useEffect(() => {
    const addTab = (tab: Partial<DocTab>) => {
      const made: DocTab = { ...makeBlankTab(), ...tab };
      setTabs((prev) => [...prev, made]);
      setActiveTabId(made.id);
    };
    setWindowAccess({
      rootPath: () => rootRef.current,
      openFile: (path, heading) =>
        void openRef.current(path, heading ? { anchor: heading } : {}),
      openUntitled: (content) => addTab({ content, savedContent: "" }),
      openPluginTab: (view: PluginTabView) => {
        // A view already open in a tab comes to the front.
        const open = tabsRef.current.find(
          (tab) =>
            tab.view?.plugin === view.plugin &&
            tab.view.view === view.view &&
            tab.view.resource === view.resource,
        );
        if (open) setActiveTabId(open.id);
        else addTab({ view });
      },
    });
    return () => setWindowAccess(null);
  }, [rootRef, openRef, tabsRef, setTabs, setActiveTabId]);

  // A file a plugin shows (a Word file in the Word reader), opened to be
  // edited as a document of ours instead.
  useEffect(
    () =>
      registerCommand({
        id: "textus.openAsDocument",
        title: (t) => t.menuOpenFile,
        run: (path) => {
          if (typeof path === "string")
            void openRef.current(path, { asDocument: true });
        },
      }),
    [openRef],
  );

  useEffect(() => emitPluginEvent("root", { path: rootPath }), [rootPath]);
  useEffect(
    () => emitPluginEvent("activeDocument", { path: activePath }),
    [activePath],
  );
  useEffect(() => emitPluginEvent("language", language), [language]);
  useEffect(() => {
    let dark = windowIsDark();
    return watchTheme(() => {
      if (windowIsDark() === dark) return;
      dark = !dark;
      emitPluginEvent("theme", dark ? "dark" : "light");
    });
  }, []);

  return useSyncExternalStore(subscribePlugins, pluginsSnapshot);
}
