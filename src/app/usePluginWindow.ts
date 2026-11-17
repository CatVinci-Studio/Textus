import { isBlockKind } from "../editor/blocks/block-kind-list";
import { lazyModule } from "../lazy/lazy-module";
import { appearanceNow } from "../theme/plugin-appearance-state";
import { pickWithCommands } from "./command-palette-entry";
import { watchConventions } from "../plugins/contributions/conventions-watch";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { onCopied } from "../clipboard/copied";
import { setCompletionAsker } from "../plugins/contributions/completion-sources";
import { refreshAllListViews } from "../plugins/contributions/list-views";
import {
  makeBlankTab,
  tabIsDirty,
  tabTitle,
  type DocTab,
} from "../document/doc-tabs";
import type { Strings } from "../i18n/strings";
import { useLatest } from "../utils/hooks/useLatest";
import { registerCommand } from "../registry/commands";
import type { TabState } from "./tabs/useTabState";
import type { OpenOptions } from "./useFileOpening";
import {
  emitPluginEvent,
  setWindowAccess,
  getWindowAccess,
  type PluginTabInfo,
  type PluginTabView,
} from "../plugins/app-bridge";
import { setUnsavedCheck, unsavedDocumentAt } from "../registry/open-documents";
import type { Where } from "../plugins/app-bridge";
import { askPlugin, loadPlugins, runPluginAiTool } from "../plugins/manager";
import {
  configurePlugins,
  pluginsSnapshot,
  subscribePlugins,
  type PluginsSnapshot,
} from "../plugins/store/plugin-records";
import { setPluginProject } from "../plugins/plugin-setting-values";
import { watchTheme } from "../plugins/views/theme-vars";
import { windowIsDark } from "../engine/tokens/appearance";
import { usePluginMenuSync } from "../plugins/contributions/usePluginMenu";
import { placeOnArrival, tabInUse } from "../engine/layout/store";
import { besideOrSay, openBesideOrSay } from "./menu/split-here";
import {
  INSERT_BLOCK_EVENT,
  SHOW_FOLDER_EVENT,
  sendAppEvent,
} from "../utils/events";
import { useSettings } from "../prefs/SettingsContext";
import { setWindowFolderSource } from "../platform/window-folder";

const windowTasks = lazyModule(
  "plugin-window-tasks",
  () => import("../plugins/window-tasks"),
);

type Opener = (path: string, open?: OpenOptions) => Promise<void>;

/** Field `key` of what `ref` holds now, as a ref of its own. */
function liveField<T, K extends keyof T>(
  ref: { readonly current: T },
  key: K,
): { readonly current: T[K] } {
  return {
    get current() {
      return ref.current[key];
    },
  };
}

/** What the plugins' long-lived handlers read as it is now. */
function usePluginRefs(now: {
  t: Strings;
  language: string;
  rootPath: string | null;
  openPathInTab: Opener;
  openFile: Opener;
  saveTab: (id: string) => Promise<boolean>;
  saveActiveTab: () => Promise<boolean>;
  closeActiveTab: () => void;
}) {
  const tRef = useLatest(now.t);
  const languageRef = useLatest(now.language);
  const rootRef = useLatest(now.rootPath);
  const acts = useLatest({
    open: now.openPathInTab,
    look: now.openFile,
    saveTab: now.saveTab,
    save: now.saveActiveTab,
    close: now.closeActiveTab,
  });
  // Each action as a ref of its own, read as it is when called.
  const { openRef, lookRef, saveTabRef, saveRef, closeRef } = useMemo(
    () => ({
      openRef: liveField(acts, "open"),
      lookRef: liveField(acts, "look"),
      saveTabRef: liveField(acts, "saveTab"),
      saveRef: liveField(acts, "save"),
      closeRef: liveField(acts, "close"),
    }),
    [acts],
  );
  const settingsRef = useLatest(useSettings());
  return {
    tRef,
    languageRef,
    rootRef,
    openRef,
    lookRef,
    saveTabRef,
    saveRef,
    closeRef,
    settingsRef,
  };
}

/** A folder in development reloaded, textus:// links, plugins' AI tools
 *  (started once the window is up: plugins/window-tasks.ts), and the
 *  completions plugins suggest as you type, called off once the panel no
 *  longer needs them. */
function useWindowTasks() {
  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    void windowTasks.load().then((tasks) => {
      if (!gone) stop = tasks.startWindowTasks(runPluginAiTool);
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
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
}

/** What plugins are told as it changes: the open folder (and its own
 *  plugin settings), the document and tab in front, the language, a copy,
 *  the theme and the window's look. */
function usePluginEvents({
  rootPath,
  activePath,
  activeTabId,
  language,
}: {
  rootPath: string | null;
  activePath: string | null;
  activeTabId: string;
  language: string;
}) {
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
    [activeTabId],
  );
  useEffect(() => {
    emitPluginEvent("language", language);
    refreshAllListViews();
  }, [language]);
  useEffect(() => onCopied((copied) => emitPluginEvent("copy", copied)), []);
  useEffect(() => {
    let dark = windowIsDark();
    let look = appearanceNow().key;
    return watchTheme(() => {
      const now = appearanceNow();
      if (now.key !== look) {
        look = now.key;
        emitPluginEvent("appearance", { theme: now.theme, scheme: now.scheme });
      }
      if (windowIsDark() === dark) return;
      dark = !dark;
      emitPluginEvent("theme", dark ? "dark" : "light");
    });
  }, []);
}

/** Plugins' menu items, and their schedules after startup: background
 *  runs, notifications' clicks, whether Textus is in front. One ended
 *  before its module came connects nothing: it would outlast the
 *  connection that replaced it. */
function usePluginSchedules(
  language: string,
  languageRef: ReturnType<typeof usePluginRefs>["languageRef"],
  settingsRef: ReturnType<typeof usePluginRefs>["settingsRef"],
  openRef: ReturnType<typeof usePluginRefs>["openRef"],
) {
  usePluginMenuSync(language);
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
}

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
  const {
    tRef,
    languageRef,
    rootRef,
    openRef,
    lookRef,
    saveTabRef,
    saveRef,
    closeRef,
    settingsRef,
  } = usePluginRefs({
    t,
    language,
    rootPath,
    openPathInTab,
    openFile,
    saveTab,
    saveActiveTab,
    closeActiveTab,
  });
  const { tabsRef, setTabs, setActiveTabId, liveTabs } = tabState;

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
      .then(() => windowTasks.load())
      .then((tasks) => tasks.afterPluginsLoad(tRef.current))
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
      const from = tabInUse();
      // Beside: its place taken as it arrives, never first drawn in front.
      if (where === "beside")
        placeOnArrival(made.id, (now) =>
          besideOrSay(now, made.id, from, false),
        );
      // In its place only while nothing unsaved would go with it.
      const front = liveTabs().find((tab) => tab.id === from);
      const replace = where === "current" && !!front && !tabIsDirty(front);
      setTabs((prev) => {
        if (!replace) return [...prev, made];
        const at = prev.findIndex((tab) => tab.id === from);
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
          ...(where ? { where, byPlugin: true } : {}),
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
          const from = tabInUse();
          setActiveTabId(open.id);
          if (where === "beside") openBesideOrSay(open.id, from, false);
        } else addTab({ view }, where);
      },
      tabs: () => tabsRef.current.map(info),
      activeTab: () => {
        const tab = tabsRef.current.find((t) => t.id === tabInUse());
        return tab ? info(tab) : null;
      },
      // Only a tab with unsaved changes; a clean one is changed on disk and reloads.
      saveAt: (path) => {
        const tab = tabsRef.current.find((t) => t.path === path);
        return tab ? saveTabRef.current(tab.id) : Promise.resolve(false);
      },
      documentAt: unsavedDocumentAt,
    });
    setWindowFolderSource(() => rootRef.current);
    setUnsavedCheck((path) => {
      const tab = tabsRef.current.find((t) => t.path === path);
      return !!tab && tab.content !== tab.savedContent;
    });
    return () => {
      setWindowAccess(null);
      setWindowFolderSource(null);
      setUnsavedCheck(null);
    };
  }, [
    rootRef,
    openRef,
    lookRef,
    saveTabRef,
    tabsRef,
    setTabs,
    setActiveTabId,
    liveTabs,
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
        if (isBlockKind(kind)) sendAppEvent(INSERT_BLOCK_EVENT, kind);
      },
    });
    // A folder inside the open one shown in the sidebar (an import's).
    const showFolder = registerCommand({
      id: "textus.showFolder",
      title: (t) => t.menuOpenFolder,
      palette: false,
      run: (path) => {
        if (typeof path === "string") sendAppEvent(SHOW_FOLDER_EVENT, path);
      },
    });
    return () => {
      save();
      close();
      insertBlock();
      showFolder();
    };
  }, [saveRef, closeRef]);

  useWindowTasks();
  usePluginEvents({
    rootPath,
    activePath,
    activeTabId: tabState.activeTabId,
    language,
  });
  usePluginSchedules(language, languageRef, settingsRef, openRef);

  return useSyncExternalStore(subscribePlugins, pluginsSnapshot);
}
