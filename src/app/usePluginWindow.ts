import { pickWithCommands } from "./command-palette-entry";
import { watchConventions } from "../plugins/contributions/conventions-watch";
import { useEffect, useSyncExternalStore } from "react";
import { onCopied } from "../clipboard/copied";
import { offerMovedFeatures } from "../plugins/store/moved-offer";
import { watchDevPlugins } from "../plugins/store/dev-reload";
import { watchPluginAiTools } from "../plugins/contributions/ai-tools";
import { setCompletionAsker } from "../plugins/contributions/completion-sources";
import { makeBlankTab, tabTitle, type DocTab } from "../document/doc-tabs";
import type { Strings } from "../i18n/strings";
import { useLatest } from "../utils/hooks/useLatest";
import { registerCommand } from "../registry/commands";
import type { TabState } from "./tabs/useTabState";
import type { OpenOptions } from "./useFileOpening";
import { emitPluginEvent, setWindowAccess, getWindowAccess, type PluginTabInfo, type PluginTabView } from "../plugins/app-bridge";
import { openDocumentAt } from "../registry/open-documents";
import type { Where } from "../plugins/app-bridge";
import { askPlugin, loadPlugins, runPluginAiTool } from "../plugins/manager";
import {
  configurePlugins,
  pluginsSnapshot,
  subscribePlugins,
  type PluginsSnapshot,
} from "../plugins/store/plugin-records";
import { setPluginProject } from "../plugins/plugin-setting-values";
import { watchTheme, windowIsDark } from "../plugins/views/theme-vars";
import { usePluginMenuSync } from "../plugins/contributions/usePluginMenu";
import {
  besideLayout,
  openBeside,
  placeOnArrival,
} from "../engine/layout/store";
import { takePluginUris } from "../plugins/plugin-uri";
import { migrateOfficialPlugins } from "../plugins/store/migrate-official";
import { listenToThisWindow, unlistenAll } from "../platform/events";
import {
  INSERT_BLOCK_EVENT,
  SHOW_FOLDER_EVENT,
  INSERT_BLOCK_KINDS,
} from "../utils/events";
import { useSettings } from "../prefs/SettingsContext";
import { setWindowFolderSource } from "../platform/window-folder";

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
  openFile,
  saveActiveTab,
  saveTab,
  closeActiveTab,
}: {
  t: Strings;
  language: string;
  rootPath: string | null;
  activePath: string | null;
  tabState: TabState;
  openPathInTab: (path: string, open?: OpenOptions) => Promise<void>;
  /** The window's own rule, for a look: the preview tab. */
  openFile: (path: string, open?: OpenOptions) => Promise<void>;
  /** File › Save, for the active tab; whether it was saved. */
  saveActiveTab: () => Promise<boolean>;
  /** The same for any tab, by its id. */
  saveTab: (id: string) => Promise<boolean>;
  /** File › Close Tab, asking first if it has unsaved changes. */
  closeActiveTab: () => void;
}): PluginsSnapshot {
  const tRef = useLatest(t);
  const languageRef = useLatest(language);
  const rootRef = useLatest(rootPath);
  const openRef = useLatest(openPathInTab);
  const lookRef = useLatest(openFile);
  const saveTabRef = useLatest(saveTab);
  const saveRef = useLatest(saveActiveTab);
  const closeRef = useLatest(closeActiveTab);
  const { tabsRef, setTabs, setActiveTabId } = tabState;
  const activeIdRef = useLatest(tabState.activeTabId);
  const settingsRef = useLatest(useSettings());

  useEffect(() => {
    configurePlugins({
      strings: () => tRef.current,
      language: () => languageRef.current,
      dark: windowIsDark,
      keys: () => ({
        shortcuts: settingsRef.current.settings.shortcuts,
        overrides: settingsRef.current.settings.commandShortcuts,
      }),
      pickWithCommands,
    });
    // Then, once, move the official plugins from before API 1.0 to their rewrites.
    // And offer, once, the plugins features of the core became.
    void loadPlugins()
      .then(() => migrateOfficialPlugins())
      .then(() => offerMovedFeatures(tRef.current))
      .catch(() => {});
  }, [tRef, languageRef, settingsRef]);

  useEffect(() => {
    const addTab = (tab: Partial<DocTab>, where: Where = "tab") => {
      const made: DocTab = { ...makeBlankTab(), ...tab };
      placeTab(made, where);
    };
    // A new tab where a plugin asked: after the others, beside the front one,
    // or in its place.
    const placeTab = (made: DocTab, where: Where) => {
      const from = activeIdRef.current;
      // Beside: its place taken as it arrives, never first drawn in front.
      if (where === "beside")
        placeOnArrival(
          made.id,
          (now) => besideLayout(now, made.id, from) ?? now,
        );
      setTabs((prev) => {
        if (where !== "current") return [...prev, made];
        const at = prev.findIndex((tab) => tab.id === activeIdRef.current);
        return at < 0
          ? [...prev, made]
          : prev.map((tab, i) => (i === at ? made : tab));
      });
      setActiveTabId(made.id);
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
      openFile: (path, { place, asDocument, where, preview }) =>
        void (preview ? lookRef : openRef).current(path, {
          ...(place ? { place } : {}),
          ...(asDocument ? { asDocument } : {}),
          ...(where ? { where } : {}),
          ...(preview ? { preview } : {}),
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
      saveAt: (path) => {
        const tab = tabsRef.current.find((t) => t.path === path);
        return tab ? saveTabRef.current(tab.id) : Promise.resolve(false);
      },
      documentAt: (path) => {
        const tab = tabsRef.current.find((t) => t.path === path);
        return tab && tab.content !== tab.savedContent
          ? openDocumentAt(path)
          : null;
      },
    });
    setWindowFolderSource(() => rootRef.current);
    return () => {
      setWindowAccess(null);
      setWindowFolderSource(null);
    };
  }, [
    rootRef,
    openRef,
    lookRef,
    saveTabRef,
    tabsRef,
    setTabs,
    setActiveTabId,
    activeIdRef,
    tRef,
  ]);

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
    // A folder inside the open one shown in the sidebar (an import's).
    const showFolder = registerCommand({
      id: "textus.showFolder",
      title: (t) => t.menuOpenFolder,
      palette: false,
      run: (path) => {
        if (typeof path === "string")
          window.dispatchEvent(
            new CustomEvent(SHOW_FOLDER_EVENT, { detail: path }),
          );
      },
    });
    return () => {
      save();
      close();
      insertBlock();
      showFolder();
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
  // The completions plugins suggest as you type, and calling off those the
  // panel no longer needs.
  useEffect(() => {
    setCompletionAsker(
      (id, source, context) =>
        askPlugin(
          id,
          "$provideCompletions",
          { id: source, ...context },
          "editor.read",
        ),
      (id, request) =>
        void askPlugin(id, "$cancelCompletions", { request }).catch(() => {}),
    );
    return () => setCompletionAsker(null);
  }, []);
  useEffect(() => {
    emitPluginEvent("root", { path: rootPath });
    watchConventions(rootPath);
    // The folder's own plugin settings, over the general ones.
    void setPluginProject(rootPath);
  }, [rootPath]);
  useEffect(
    () => emitPluginEvent("activeDocument", { path: activePath }),
    [activePath],
  );
  useEffect(
    () => emitPluginEvent("activeTab", getWindowAccess()?.activeTab() ?? null),
    [tabState.activeTabId],
  );
  useEffect(() => emitPluginEvent("language", language), [language]);
  useEffect(() => onCopied((copied) => emitPluginEvent("copy", copied)), []);
  useEffect(() => {
    let dark = windowIsDark();
    return watchTheme(() => {
      if (windowIsDark() === dark) return;
      dark = !dark;
      emitPluginEvent("theme", dark ? "dark" : "light");
    });
  }, []);
  usePluginMenuSync(language);
  // Plugins' schedules, after startup: background runs, notifications'
  // clicks, whether Textus is in front.
  // One ended before its module came connects nothing: it would outlast
  // the connection that replaced it.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let ended = false;
    void import("../plugins/background/schedule-window").then((m) => {
      if (!ended)
        stop = m.connectScheduleWindow(languageRef, settingsRef, openRef);
    });
    return () => {
      ended = true;
      stop?.();
    };
  }, [languageRef, settingsRef, openRef]);

  return useSyncExternalStore(subscribePlugins, pluginsSnapshot);
}
