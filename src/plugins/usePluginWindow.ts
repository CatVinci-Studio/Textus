import { useEffect, useSyncExternalStore } from "react";
import { watchDevPlugins } from "./dev-reload";
import { watchPluginAiTools } from "./ai-tools";
import { makeBlankTab, type DocTab } from "../document/doc-tabs";
import type { Strings } from "../i18n/strings";
import { useLatest } from "../utils/hooks/useLatest";
import { registerCommand } from "../app/commands";
import type { TabState } from "../app/useTabState";
import type { OpenOptions } from "../app/useFileOpening";
import {
  emitPluginEvent,
  setWindowAccess,
  type PluginTabView,
} from "./app-bridge";
import {
  configurePlugins,
  loadPlugins,
  pluginsSnapshot,
  runPluginAiTool,
  setPluginProject,
  subscribePlugins,
  type PluginsSnapshot,
} from "./manager";
import { watchTheme, windowIsDark } from "./theme-vars";
import { usePluginMenuSync } from "./usePluginMenu";

/**
 * A window's side of the plugins: what it tells the manager (its strings,
 * language, theme), what plugins may ask of it (open a file, a tab of
 * theirs, the folder in the sidebar), the events they may listen to, and
 * the native menus they add to.
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
  saveActiveTab,
}: {
  t: Strings;
  language: string;
  rootPath: string | null;
  activePath: string | null;
  tabState: TabState;
  openPathInTab: (path: string, open?: OpenOptions) => Promise<void>;
  /** File › Save, for the active tab. */
  saveActiveTab: () => void;
}): PluginsSnapshot {
  const tRef = useLatest(t);
  const languageRef = useLatest(language);
  const rootRef = useLatest(rootPath);
  const openRef = useLatest(openPathInTab);
  const saveRef = useLatest(saveActiveTab);
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
      openFile: (path, { heading, asDocument }) =>
        void openRef.current(path, {
          ...(heading ? { anchor: heading } : {}),
          ...(asDocument ? { asDocument } : {}),
        }),
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

  // File › Save, for a plugin that has its own key for it (Emacs's C-x
  // C-s).
  useEffect(
    () =>
      registerCommand({
        id: "textus.save",
        title: (t) => t.menuSave,
        run: () => saveRef.current(),
      }),
    [saveRef],
  );

  // A plugin a developer loaded from a folder, loaded again as it changes.
  useEffect(() => watchDevPlugins(), []);
  // Tools the plugins give Textus AI, told to Rust and run when called.
  useEffect(() => watchPluginAiTools(runPluginAiTool), []);
  useEffect(() => {
    emitPluginEvent("root", { path: rootPath });
    // The folder's own plugin settings, over the general ones.
    void setPluginProject(rootPath);
  }, [rootPath]);
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
  usePluginMenuSync(language);

  return useSyncExternalStore(subscribePlugins, pluginsSnapshot);
}
