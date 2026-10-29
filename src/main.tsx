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

// For Help > Report a Problem, from the first moment.
watchErrors();

// The UI's language loads first, so the first frame is already in it; one
// that fails to load shows in English.
void loadLocale(loadSettings().language)
  .catch(() => {})
  .then(() => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <SettingsProvider>
          <AppearanceSync />
          {view === "chat" ? (
            <Suspense fallback={null}>
              <ChatWindowApp />
            </Suspense>
          ) : (
            <App />
          )}
          <WindowEdges />
        </SettingsProvider>
      </React.StrictMode>,
    );
    // The parts likely to be opened next load once the window is idle.
    startWarming();
  });
