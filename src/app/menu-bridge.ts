import { useEffect, useLayoutEffect, useRef } from "react";
import { menuIpc, windowIpc } from "../platform/ipc";
import { hasNativeMenuBar } from "../platform/capabilities";
import {
  nativeMenuChecks,
  nativeMenuLabels,
  type MenuChecks,
} from "./app-menu-model";
import { listenToThisWindow, unlistenAll } from "../utils/tauri-events";
import { formatAccelerator } from "../utils/accelerator";
import { useQuickNoteShortcut } from "../platform/useQuickNoteShortcut";
import { exportHtml, exportPdf, exportViaPandoc } from "../export/exporters";
import { TOGGLE_FIND_REPLACE_EVENT, INSERT_BLOCK_EVENT } from "../utils/events";
import type { DocTab, HelpDoc } from "../document/doc-tabs";
import type { Strings } from "../i18n/strings";
import type { DiagramEngine } from "../settings/SettingsContext";

export interface MenuBridgeHandlers {
  activeTabId: string;
  /** useTabState.ts's liveTabs: read inside event handlers, not captured at
   *  effect-setup time, and with the editors' pending edits flushed so an
   *  export carries what is on screen. */
  liveTabs: () => DocTab[];
  t: Strings;
  /** Settings › "Page numbers in PDF", read when File > Export as PDF runs. */
  pdfPageNumbers: boolean;
  diagramEngine: DiagramEngine;
  onOpenSettings: () => void;
  onToggleTypewriter: () => void;
  onToggleSidebar: () => void;
  onToggleAgentPanel: () => void;
  onToggleSplitView: () => void;
  onToggleZenMode: () => void;
  addBlankTab: () => void;
  openFileDialog: () => Promise<void>;
  /** File > Open Recent (useFileOpening.ts). */
  openRecentFile: (path: string) => Promise<void>;
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
  /** The phone menu's Documents (mobile/DocumentList.tsx). */
  onOpenDocuments: () => void;
  /** The phone menu's Share (iOS share sheet). */
  shareActiveTab: () => Promise<void>;
}

/**
 * Menu events from Rust (menu.rs's dispatch) - every File/View/Format/Help
 * action the frontend owns arrives here as a window event. Pulled out of
 * App.tsx as a pure wiring layer: every handler it calls already lives in
 * App (or a hook App composes), this just subscribes them to the right
 * event names.
 */
export function useMenuBridge(handlers: MenuBridgeHandlers): void {
  // Subscribed ONCE, reading the newest handlers at the moment an event
  // arrives. Re-subscribing whenever a handler changed (nearly every
  // render) raced Tauri's asynchronous unlisten: for a moment old and new
  // listeners were both live, and one menu click ran several times - New
  // File opened four tabs at once on the iPhone.
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
      // Only arrives in tab mode - in window mode the Rust menu handler opens
      // a fresh window itself instead of emitting this.
      listenToThisWindow("menu-new-file", () => h().addBlankTab()),
      listenToThisWindow("menu-open-file", () => void h().openFileDialog()),
      listenToThisWindow<string>(
        "menu-open-recent",
        (event) => void h().openRecentFile(event.payload),
      ),
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
      // Dedicated PDF export: shows a progress overlay while the themed,
      // paginated document is rendered offscreen and written straight to
      // the chosen file (no print dialog). See exportPdf in export-doc.
      listenToThisWindow("menu-export-pdf", () => {
        const tab = activeTabNow();
        if (tab) void exportPdf(tab, h().t, h().pdfPageNumbers);
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
      listenToThisWindow("menu-toggle-sidebar", () => h().onToggleSidebar()),
      listenToThisWindow("menu-toggle-agent-panel", () =>
        h().onToggleAgentPanel(),
      ),
      // These two were never subscribed: View > Split View and View > Zen
      // Mode (and their menu accelerators) did nothing.
      listenToThisWindow("menu-toggle-split-view", () =>
        h().onToggleSplitView(),
      ),
      listenToThisWindow("menu-toggle-zen-mode", () => h().onToggleZenMode()),
      listenToThisWindow("menu-find-replace", () =>
        window.dispatchEvent(new CustomEvent(TOGGLE_FIND_REPLACE_EVENT)),
      ),
      listenToThisWindow("menu-close-tab", () =>
        h().requestCloseTab(h().activeTabId),
      ),
      // Payload is the block kind (h1..h6, bullet-list, ...) from the menu id -
      // relayed to whichever editor is mounted as active (MilkdownEditor.tsx).
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

  // The macOS menu bar is native and built in English: it takes the UI's
  // language from these labels, sent by each window as it opens and again
  // when the language changes (Rust rebuilds only on a change). New Quick
  // Note's label carries the global shortcut while it is registered.
  const { t } = handlers;
  const quickNote = useQuickNoteShortcut();
  const quickNoteHint =
    quickNote?.state === "on" ? formatAccelerator(quickNote.accelerator) : "";
  useEffect(() => {
    if (hasNativeMenuBar)
      void menuIpc.setMenuLabels(nativeMenuLabels(t, quickNoteHint));
  }, [t, quickNoteHint]);

  // Settings… or Open… chosen from the macOS menu bar while no window was
  // open: Rust opened this window to carry it out (menu.rs's
  // emit_or_open_window). Asked once, on mount - the answer is taken, so no
  // later window repeats it.
  useEffect(() => {
    windowIpc
      .takePendingMenuEvent()
      .then((event) => {
        if (event === "menu-open-settings") latest.current.onOpenSettings();
        else if (event === "menu-open-file")
          void latest.current.openFileDialog();
      })
      .catch(() => {});
  }, []);
}

/**
 * The macOS menu bar's View check marks, from this window's state: sent on
 * every change while the window has focus, and again whenever it gains
 * focus - the bar is one for the whole app, so it shows the front window.
 */
export function useNativeMenuChecks(checks: MenuChecks) {
  const key = JSON.stringify(nativeMenuChecks(checks));
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
