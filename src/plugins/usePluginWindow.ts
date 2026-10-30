import { useEffect, useSyncExternalStore } from "react";
import { watchDevPlugins } from "./store/dev-reload";
import { watchPluginAiTools } from "./contributions/ai-tools";
import { setCompletionAsker } from "./contributions/completion-sources";
import { makeBlankTab, tabTitle, type DocTab } from "../document/doc-tabs";
import type { Strings } from "../i18n/strings";
import { useLatest } from "../utils/hooks/useLatest";
import { registerCommand } from "../app/commands";
import type { TabState } from "../app/tabs/useTabState";
import type { OpenOptions } from "../app/useFileOpening";
import {
  emitPluginEvent,
  openDocumentAt,
  setWindowAccess,
  type PluginTabInfo,
  type PluginTabView,
} from "./app-bridge";
import type { Where } from "./app-bridge";
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
import { watchTheme, windowIsDark } from "./views/theme-vars";
import { usePluginMenuSync } from "./contributions/usePluginMenu";
import { openBeside } from "../app/split/split-layout";
import { takePluginUris } from "./plugin-uri";
import { migrateOfficialPlugins } from "./store/migrate-official";
import { listenToThisWindow, unlistenAll } from "../platform/events";
import { INSERT_BLOCK_EVENT, INSERT_BLOCK_KINDS } from "../utils/events";

/**
 * A window's side of the plugins: what it tells the manager, what plugins
 * may ask of it, their events and native menus. Returns the plugins' state
 * so the window redraws when one is turned on or off.
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
    // Then, once, move the official plugins from before API 1.0 to their rewrites.
    void loadPlugins()
      .then(() => migrateOfficialPlugins())
      .catch(() => {});
  }, [tRef, languageRef]);

  useEffect(() => {
    const addTab = (tab: Partial<DocTab>, where: Where = "tab") => {
      const made: DocTab = { ...makeBlankTab(), ...tab };
      placeTab(made, where);
    };
    // A new tab where a plugin asked: after the others, beside the front one,
    // or in its place.
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
      // Only a tab with unsaved changes; a clean one is changed on disk and reloads.
      documentAt: (path) => {
        const tab = tabsRef.current.find((t) => t.path === path);
        return tab && tab.content !== tab.savedContent
          ? openDocumentAt(path)
          : null;
      },
    });
    return () => setWindowAccess(null);
  }, [rootRef, openRef, tabsRef, setTabs, setActiveTabId, activeIdRef, tRef]);

  // File › Save and Close Tab for plugins with their own keys (Vim's :w, :q).
  // Close Tab with { save: true } closes only once it is saved.
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
    // The Format menu's blocks, for plugins that insert them (a / menu).
    const insertBlock = registerCommand({
      id: "textus.insertBlock",
      title: (t) => t.menuFormat,
      palette: false,
      run: (kind) => {
        if (typeof kind === "string" && INSERT_BLOCK_KINDS.includes(kind))
          window.dispatchEvent(
            new CustomEvent(INSERT_BLOCK_EVENT, { detail: kind }),
          );
      },
    });
    return () => {
      save();
      close();
      insertBlock();
    };
  }, [saveRef, closeRef]);

  // A plugin a developer loaded from a folder, loaded again as it changes.
  useEffect(() => watchDevPlugins(), []);
  // textus:// links from outside: those that came before this window, then
  // each as it comes.
  useEffect(() => {
    void takePluginUris();
    return unlistenAll(
      listenToThisWindow("plugin-uri", () => void takePluginUris()),
    );
  }, []);
  // Tools the plugins give Textus AI, told to Rust and run when called.
  useEffect(() => watchPluginAiTools(runPluginAiTool), []);
  // The completions plugins suggest as you type.
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
