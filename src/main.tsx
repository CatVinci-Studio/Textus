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
import { watchMemoryIdle } from "./utils/memory-idle";
import { publishWindowChrome } from "./platform/window-chrome";
import { WindowEdges } from "./app/WindowEdges";
import { installWebviewGuards } from "./ui/webview-guards";
import { installScrollReveal } from "./ui/scroll-reveal";
import { restoreFolderAccess } from "./platform/ios-files";
import { installMobileViewport } from "./platform/mobile-viewport";
import { markEngineQuirks } from "./ui/engine-quirks";
import { flushWhenHidden } from "./storage/pending-writes";
import { exposePluginApiForDevelopment } from "./plugin-api";
import "./mobile/styles/index.css";
import { watchErrors } from "./app/report/recent-errors";
import { AppErrorBoundary } from "./app/report/AppErrorBoundary";

installPolyfills();
installDevTauriShim();
installWebviewGuards();
installScrollReveal();
// Held-back storage writes go out when iOS sends the app to the background.
flushWhenHidden();
// iOS: reopen the folders picked in earlier sessions (a no-op elsewhere).
void restoreFolderAccess().catch(() => {});

// Before the first render: correcting it afterwards would paint the title row
// at the macOS traffic-light inset for a frame on every Windows launch.
publishWindowChrome();
installMobileViewport();
markEngineQuirks();
// The plugin API draft, on the window in a development build.
exposePluginApiForDevelopment();

// Which view this window is. One bundle serves both, rather than a second
// build target and copy of the shared providers.
const view = new URLSearchParams(window.location.search).get("view");

// The detached chat's own view, loaded only in that window.
const ChatWindowApp = lazyComponent(
  lazyModule("chat-window", () => import("./ai/chat/window/ChatWindowApp")),
  (m) => m.ChatWindowApp,
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
            </SettingsProvider>
          </AppErrorBoundary>
        </React.StrictMode>,
      );
      // The parts likely to be opened next load once the window is idle.
      startWarming();
      // Caches and idle views are given back once the window is left alone.
      watchMemoryIdle();
    });
}
