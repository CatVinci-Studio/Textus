import { useEffect, useLayoutEffect, useRef } from "react";
import { useSyncExternalStore } from "react";
import {
  subscribeTracking,
  trackingShown,
} from "../../ai/margin/track-changes-state";
import { TRACK_CHANGES_EVENT } from "../../utils/events";
import { menuIpc, windowIpc } from "../../platform/ipc";
import { selectAllInFocus } from "../../ui/select-all";
import { hasNativeMenuBar } from "../../platform/capabilities";
import { nativeMenuChecks, type MenuChecks } from "./app-menu-model";
import { nativeMenuAccelerators, nativeMenuLabels } from "./native-menu-text";
import { listenToThisWindow, unlistenAll } from "../../platform/events";
import { runCommand } from "../commands";
import { exportHtml, exportPdf, exportViaPandoc } from "../../export/exporters";
import {
  EDIT_ACTION_EVENT,
  TOGGLE_FIND_REPLACE_EVENT,
  INSERT_BLOCK_EVENT,
} from "../../utils/events";
import type { DocTab, HelpDoc } from "../../document/doc-tabs";
import type { Strings } from "../../i18n/strings";
import type { DiagramEngine, Shortcuts } from "../../settings/SettingsContext";
import { closeSplit, splitEditor } from "../split/split-layout";
import { openCommandPalette } from "../command-palette";

export interface MenuBridgeHandlers {
  activeTabId: string;
  /** Read inside handlers, with pending edits flushed so an export carries
   *  what is on screen. */
  liveTabs: () => DocTab[];
  t: Strings;
  pdfPageNumbers: boolean;
  pdfLightColors: boolean;
  diagramEngine: DiagramEngine;
  onOpenSettings: () => void;
  onOpenPluginSettings: () => void;
  onToggleTypewriter: () => void;
  onToggleSidebar: () => void;
  onToggleAgentPanel: () => void;
  onToggleTextusAi: () => void;
  onToggleSplitView: () => void;
  onToggleZenMode: () => void;
  addBlankTab: () => void;
  openFileDialog: () => Promise<void>;
  openRecentFile: (path: string) => Promise<void>;
  openFolderDialog: () => Promise<void>;
  openFolder: (path: string) => void;
  closeFolder: () => void;
  saveTab: (tabId: string) => Promise<boolean>;
  saveTabAs: (tabId: string) => Promise<boolean>;
  toggleSourceMode: () => void;
  requestCloseTab: (tabId: string) => void;
  openHelpTab: (doc: HelpDoc) => void;
  startWelcomeTutorial: () => void;
  /** Help > Join the Community: the website's page in the UI's language. */
  openCommunity: () => void;
  /** Help > Video Tutorials: the website's page in the UI's language. */
  openTutorials: () => void;
  /** The phone menu's Documents. */
  onOpenDocuments: () => void;
  /** The phone menu's Share (iOS share sheet). */
  shareActiveTab: () => Promise<void>;
}

/** Subscribes the frontend's handlers to the menu events from Rust. */
export function useMenuBridge(handlers: MenuBridgeHandlers): void {
  // Subscribed once: re-subscribing raced Tauri's async unlisten, so one
  // click could run several times.
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const h = () => latest.current;
    const activeTabNow = () => {
      const { liveTabs, activeTabId } = h();
      return liveTabs().find((tb) => tb.id === activeTabId);
    };
    return unlistenAll(
      listenToThisWindow("menu-open-settings", () => h().onOpenSettings()),
      listenToThisWindow("menu-manage-plugins", () =>
        h().onOpenPluginSettings(),
      ),
      listenToThisWindow<string>("menu-plugin-command", (event) =>
        runCommand(event.payload),
      ),
      // Tab mode only: in window mode Rust opens a fresh window itself.
      listenToThisWindow("menu-new-file", () => h().addBlankTab()),
      listenToThisWindow("menu-open-file", () => void h().openFileDialog()),
      listenToThisWindow<string>(
        "menu-open-recent",
        (event) => void h().openRecentFile(event.payload),
      ),
      listenToThisWindow("menu-open-folder", () => void h().openFolderDialog()),
      listenToThisWindow<string>("menu-open-recent-folder", (event) =>
        h().openFolder(event.payload),
      ),
      listenToThisWindow("menu-close-folder", () => h().closeFolder()),
      listenToThisWindow("menu-documents", () => h().onOpenDocuments()),
      listenToThisWindow("menu-share", () => void h().shareActiveTab()),
      listenToThisWindow(
        "menu-save-file",
        () => void h().saveTab(h().activeTabId),
      ),
      listenToThisWindow(
        "menu-save-file-as",
        () => void h().saveTabAs(h().activeTabId),
      ),
      listenToThisWindow("menu-export-pdf", () => {
        const tab = activeTabNow();
        if (tab)
          void exportPdf(tab, h().t, {
            pageNumbers: h().pdfPageNumbers,
            lightColors: h().pdfLightColors,
          });
      }),
      listenToThisWindow("menu-export-html", () => {
        const tab = activeTabNow();
        if (tab) void exportHtml(tab, h().t);
      }),
      // Payload is the pandoc writer name (docx, epub, ...) from the menu id.
      listenToThisWindow<string>("menu-export-pandoc", (event) => {
        const tab = activeTabNow();
        if (tab)
          void exportViaPandoc(tab, event.payload, h().t, h().diagramEngine);
      }),
      listenToThisWindow("menu-toggle-source-mode", () =>
        h().toggleSourceMode(),
      ),
      listenToThisWindow("menu-toggle-typewriter-mode", () =>
        h().onToggleTypewriter(),
      ),
      listenToThisWindow("menu-track-changes", () =>
        window.dispatchEvent(
          new CustomEvent(TRACK_CHANGES_EVENT, { detail: "toggle" }),
        ),
      ),
      listenToThisWindow("menu-toggle-sidebar", () => h().onToggleSidebar()),
      listenToThisWindow("menu-toggle-agent-panel", () =>
        h().onToggleAgentPanel(),
      ),
      listenToThisWindow("menu-toggle-textus-ai", () => h().onToggleTextusAi()),
      listenToThisWindow("menu-toggle-split-view", () =>
        h().onToggleSplitView(),
      ),
      listenToThisWindow("menu-toggle-zen-mode", () => h().onToggleZenMode()),
      listenToThisWindow(
        "menu-command-palette",
        () => void openCommandPalette(),
      ),
      listenToThisWindow("menu-split-right", () => splitEditor("row")),
      listenToThisWindow("menu-split-down", () => splitEditor("column")),
      listenToThisWindow("menu-close-split", () => closeSplit()),
      listenToThisWindow("menu-select-all", selectAllInFocus),
      listenToThisWindow("menu-copy-as-markdown", () =>
        window.dispatchEvent(
          new CustomEvent(EDIT_ACTION_EVENT, { detail: "copy-as-markdown" }),
        ),
      ),
      listenToThisWindow("menu-find-replace", () =>
        window.dispatchEvent(new CustomEvent(TOGGLE_FIND_REPLACE_EVENT)),
      ),
      listenToThisWindow("menu-close-tab", () =>
        h().requestCloseTab(h().activeTabId),
      ),
      // Payload is the block kind (h1..h6, bullet-list, ...) from the menu id.
      listenToThisWindow<string>("menu-insert-block", (event) => {
        window.dispatchEvent(
          new CustomEvent(INSERT_BLOCK_EVENT, { detail: event.payload }),
        );
      }),
      listenToThisWindow("menu-open-community", () => h().openCommunity()),
      listenToThisWindow("menu-open-tutorials", () => h().openTutorials()),
      listenToThisWindow<string>("menu-open-help", (event) => {
        if (event.payload === "welcome") h().startWelcomeTutorial();
        else if (event.payload === "markdown" || event.payload === "agent")
          h().openHelpTab(event.payload);
      }),
    );
  }, []);

  // The native macOS menu bar is built in English; it takes the UI's
  // language from these labels.
  const { t } = handlers;
  useEffect(() => {
    if (hasNativeMenuBar) void menuIpc.setMenuLabels(nativeMenuLabels(t));
  }, [t]);

  // A menu command chosen with no window open: Rust opened this window to
  // carry it out. Taken once, so no later window repeats it.
  useEffect(() => {
    windowIpc
      .takePendingMenuEvent()
      .then((event) => {
        if (event === "menu-open-settings") latest.current.onOpenSettings();
        else if (event === "menu-manage-plugins")
          latest.current.onOpenPluginSettings();
        else if (event === "menu-open-file")
          void latest.current.openFileDialog();
        else if (event === "menu-open-folder")
          void latest.current.openFolderDialog();
      })
      .catch(() => {});
  }, []);
}

/** Sends the macOS menu bar's accelerators from Settings › Shortcuts. */
export function useNativeMenuAccelerators(shortcuts: Shortcuts) {
  const key = JSON.stringify(nativeMenuAccelerators(shortcuts));
  useEffect(() => {
    if (!hasNativeMenuBar) return;
    void menuIpc
      .setMenuAccelerators(JSON.parse(key) as Record<string, string>)
      .catch(() => {});
  }, [key]);
}

/** The macOS menu bar's check marks, sent while this window has focus: the
 *  bar is app-wide, so it shows the front window. */
export function useNativeMenuChecks(checks: MenuChecks) {
  // Edit › Track My Changes: the document on screen's, not the window's.
  const trackChanges = useSyncExternalStore(subscribeTracking, trackingShown);
  const key = JSON.stringify(nativeMenuChecks({ ...checks, trackChanges }));
  useEffect(() => {
    if (!hasNativeMenuBar) return;
    const send = () =>
      void menuIpc
        .setMenuChecks(JSON.parse(key) as Record<string, boolean>)
        .catch(() => {});
    if (document.hasFocus()) send();
    window.addEventListener("focus", send);
    return () => window.removeEventListener("focus", send);
  }, [key]);
}
