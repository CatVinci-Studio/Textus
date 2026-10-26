import { useEffect, useSyncExternalStore } from "react";
import { watchDevPlugins } from "./dev-reload";
import { watchPluginAiTools } from "./ai-tools";
import { setCompletionAsker } from "./completion-sources";
import { makeBlankTab, tabTitle, type DocTab } from "../document/doc-tabs";
import type { Strings } from "../i18n/strings";
import { useLatest } from "../utils/hooks/useLatest";
import { registerCommand } from "../app/commands";
import type { TabState } from "../app/useTabState";
import type { OpenOptions } from "../app/useFileOpening";
import {
  emitPluginEvent,
  openDocumentAt,
  setWindowAccess,
  type PluginTabInfo,
  type PluginTabView,
} from "./app-bridge";
import type { Where } from "./broker-scope";
import {
  askPlugin,
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
import { openBeside } from "../app/split-layout";
import { takePluginUris } from "./plugin-uri";
import { migrateOfficialPlugins } from "./migrate-official";
import { listenToThisWindow, unlistenAll } from "../utils/tauri-events";

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
  closeActiveTab,
}: {
  t: Strings;
  language: string;
  rootPath: string | null;
  activePath: string | null;
  tabState: TabState;
  openPathInTab: (path: string, open?: OpenOptions) => Promise<void>;
  /** File › Save, for the active tab; whether it was saved. */
  saveActiveTab: () => Promise<boolean>;
  /** File › Close Tab, asking first if it has unsaved changes. */
  closeActiveTab: () => void;
}): PluginsSnapshot {
  const tRef = useLatest(t);
  const languageRef = useLatest(language);
  const rootRef = useLatest(rootPath);
  const openRef = useLatest(openPathInTab);
  const saveRef = useLatest(saveActiveTab);
  const closeRef = useLatest(closeActiveTab);
  const { tabsRef, setTabs, setActiveTabId } = tabState;
  const activeIdRef = useLatest(tabState.activeTabId);

  useEffect(() => {
    configurePlugins({
      strings: () => tRef.current,
      language: () => languageRef.current,
      dark: windowIsDark,
    });
    // Then, once, the official plugins of before the plugin API 1.0 moved
    // to their rewrites (migrate-official.ts).
    void loadPlugins()
      .then(() => migrateOfficialPlugins())
      .catch(() => {});
  }, [tRef, languageRef]);

  useEffect(() => {
    const addTab = (tab: Partial<DocTab>, where: Where = "tab") => {
      const made: DocTab = { ...makeBlankTab(), ...tab };
      placeTab(made, where);
    };
    // A new tab where a plugin asked: after the others, beside the one in
    // front (split-layout.ts), or in its place.
    const placeTab = (made: DocTab, where: Where) => {
      const from = activeIdRef.current;
      setTabs((prev) => {
        if (where !== "current") return [...prev, made];
        const at = prev.findIndex((tab) => tab.id === activeIdRef.current);
        return at < 0
          ? [...prev, made]
          : prev.map((tab, i) => (i === at ? made : tab));
      });
      setActiveTabId(made.id);
      if (where === "beside")
        requestAnimationFrame(() => openBeside(made.id, from));
    };
    const info = (tab: DocTab): PluginTabInfo => ({
      id: tab.id,
      title: tabTitle(tab, tRef.current),
      kind: tab.view
        ? tab.view.kind === "web"
          ? "web"
          : tab.view.kind === "editor"
            ? "file"
            : "view"
        : "document",
      path: tab.path ?? tab.view?.resource ?? null,
      ...(tab.view ? { plugin: tab.view.plugin, view: tab.view.view } : {}),
    });
    setWindowAccess({
      rootPath: () => rootRef.current,
      openFile: (path, { place, asDocument, where }) =>
        void openRef.current(path, {
          ...(place ? { place } : {}),
          ...(asDocument ? { asDocument } : {}),
          ...(where ? { where } : {}),
        }),
      openUntitled: (content, title, where) =>
        addTab({ content, savedContent: "", draftTitle: title }, where),
      openGuide: (content, title) => {
        const open = tabsRef.current.find(
          (tab) => !tab.path && tab.content === content,
        );
        if (open) setActiveTabId(open.id);
        else addTab({ content, savedContent: content, draftTitle: title });
      },
      openPluginTab: (view: PluginTabView, where?: Where) => {
        // A view already open in a tab comes to the front.
        const open = tabsRef.current.find(
          (tab) =>
            tab.view?.plugin === view.plugin &&
            tab.view.view === view.view &&
            tab.view.resource === view.resource,
        );
        if (open) {
          const from = activeIdRef.current;
          setActiveTabId(open.id);
          if (where === "beside") openBeside(open.id, from);
        } else addTab({ view }, where);
      },
      tabs: () => tabsRef.current.map(info),
      activeTab: () => {
        const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
        return tab ? info(tab) : null;
      },
      // Only a tab with unsaved changes: one that matches its file is
      // changed on disk, and reloads (useExternalChangeReload).
      documentAt: (path) => {
        const tab = tabsRef.current.find((t) => t.path === path);
        return tab && tab.content !== tab.savedContent
          ? openDocumentAt(path)
          : null;
      },
    });
    return () => setWindowAccess(null);
  }, [rootRef, openRef, tabsRef, setTabs, setActiveTabId, activeIdRef, tRef]);

  // File › Save and Close Tab, for a plugin that has its own keys for
  // them (Emacs's C-x C-s, Vim's :w and :q). Close Tab with { save: true }
  // saves first (Vim's :wq), and closes only once it is saved.
  useEffect(() => {
    const save = registerCommand({
      id: "textus.save",
      title: (t) => t.menuSave,
      run: () => void saveRef.current(),
    });
    const close = registerCommand({
      id: "textus.closeTab",
      title: (t) => t.menuCloseTab,
      run: (options) => {
        const first = (options as { save?: boolean } | undefined)?.save
          ? saveRef.current()
          : Promise.resolve(true);
        void first.then((saved) => {
          if (saved) closeRef.current();
        });
      },
    });
    return () => {
      save();
      close();
    };
  }, [saveRef, closeRef]);

  // A plugin a developer loaded from a folder, loaded again as it changes.
  useEffect(() => watchDevPlugins(), []);
  // textus:// links from outside (plugins/uri.rs): those that came before
  // this window did, then each as it comes.
  useEffect(() => {
    void takePluginUris();
    return unlistenAll(
      listenToThisWindow("plugin-uri", () => void takePluginUris()),
    );
  }, []);
  // Tools the plugins give Textus AI, told to Rust and run when called.
  useEffect(() => watchPluginAiTools(runPluginAiTool), []);
  // The completions plugins suggest as you type (completion-sources.ts).
  useEffect(() => {
    setCompletionAsker((id, source, context) =>
      askPlugin(
        id,
        "$provideCompletions",
        { id: source, ...context },
        "editor.read",
      ),
    );
    return () => setCompletionAsker(null);
  }, []);
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
