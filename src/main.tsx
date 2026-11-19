import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { lazyComponent } from "./lazy/lazy-component";
import { loadSettings, SettingsProvider } from "./prefs/SettingsContext";
import { AppearanceSync } from "./theme/apply-appearance";
import { loadLocale } from "./i18n/strings";
import { lazyModule, startWarming } from "./lazy/lazy-module";
import { installDevTauriShim } from "./dev/tauri-shim";
import { installPolyfills } from "./utils/polyfills";
import { watchMemory } from "./app/watch-memory";
import { publishWindowChrome } from "./platform/window-chrome";
import { WindowEdges, WindowOutline } from "./app/frame/WindowEdges";
import { installWebviewGuards } from "./engine/controls/webview-guards";
import { installLinkGuard } from "./app/link-guard";
import { installTextFieldMenu } from "./engine/controls/text-field-menu";
import { installScrollReveal } from "./engine/controls/scroll-reveal";
import { restoreFolderAccess } from "./platform/native-files";
import { installMobileViewport } from "./platform/mobile-viewport";
import { installBack } from "./mobile/back";
import { markEngineQuirks } from "./engine/controls/engine-quirks";
import { flushWhenHidden, onWriteFailed } from "./storage/pending-writes";
import { currentStrings } from "./i18n/current";
import { exposePluginApiForDevelopment } from "./plugin-api";
import "./mobile/styles/index.css";
import { watchErrors } from "./app/report/recent-errors";
import { watchInput } from "./app/report/input-trail";
import { AppErrorBoundary } from "./app/report/AppErrorBoundary";

installPolyfills();
installDevTauriShim();
installWebviewGuards();
installLinkGuard();
installTextFieldMenu();
installScrollReveal();
// Held-back storage writes go out when iOS sends the app to the background.
flushWhenHidden();
// A write that fails is said once: what changes then lasts only this session.
const stopTelling = onWriteFailed(() => {
  stopTelling();
  void import("./engine/controls/notices").then(({ showNotice }) =>
    showNotice(currentStrings().settingsNotSaved, { tone: "warning" }),
  );
});
// iOS: reopen the folders picked in earlier sessions (a no-op elsewhere).
void restoreFolderAccess().catch(() => {});

// Before the first render: correcting it afterwards would paint the title row
// at the macOS traffic-light inset for a frame on every Windows launch.
publishWindowChrome();
installMobileViewport();
installBack();
markEngineQuirks();
// The plugin API draft, on the window in a development build.
exposePluginApiForDevelopment();

// Which view this window is. One bundle serves both, rather than a second
// build target and copy of the shared providers.
const view = new URLSearchParams(window.location.search).get("view");

// The detached chat's own view, loaded only in that window.
const ChatWindowApp = lazyComponent(
  lazyModule("chat-window", () => import("./app/ChatWindowRoot")),
  (m) => m.ChatWindowRoot,
);

// A plugin's floating view over the desktop, in a window of its own.
const FloatingWindowApp = lazyComponent(
  lazyModule(
    "floating-window",
    () => import("./plugins/views/FloatingWindowApp"),
  ),
  (m) => m.FloatingWindowApp,
);

// For Help > Report a Problem, from the first moment.
watchErrors();
watchInput();

if (view === "background") {
  // The hidden window Rust opens to run plugins' background code draws
  // nothing: it runs what is waiting and is closed.
  void import("./plugins/background/background-host-page").then((m) =>
    m.runBackgroundHost(),
  );
} else {
  // The UI's language loads first, so the first frame is already in it; one
  // that fails to load shows in English.
  void loadLocale(loadSettings().language)
    .catch(() => {})
    .then(() => {
      ReactDOM.createRoot(
        document.getElementById("root") as HTMLElement,
      ).render(
        <React.StrictMode>
          <AppErrorBoundary>
            <SettingsProvider>
              <AppearanceSync />
              {view === "floating" ? (
                <Suspense fallback={null}>
                  <FloatingWindowApp />
                </Suspense>
              ) : view === "chat" ? (
                <Suspense fallback={null}>
                  <ChatWindowApp />
                </Suspense>
              ) : (
                <App />
              )}
              {view !== "floating" && <WindowEdges />}
              {view !== "floating" && <WindowOutline />}
            </SettingsProvider>
          </AppErrorBoundary>
        </React.StrictMode>,
      );
      // The parts likely to be opened next load once the window is idle.
      startWarming();
      // Caches and idle views are given back once the window is left alone,
      // and as much is kept as the machine's memory allows.
      watchMemory();
    });
}
