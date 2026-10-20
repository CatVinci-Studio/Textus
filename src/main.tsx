import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { ChatWindowApp } from "./ai/chat/window/ChatWindowApp";
import { SettingsProvider } from "./settings/SettingsContext";
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
import "./mobile/styles/index.css";

installPolyfills();
installDevTauriShim();
installWebviewGuards();
installScrollReveal();
// Held-back storage writes go out when iOS sends the app to the background
// (a closing window waits for them instead - storage/pending-writes.ts).
flushWhenHidden();
// iOS: reopen the folders picked in earlier sessions (a no-op elsewhere).
void restoreFolderAccess().catch(() => {});

// Before the first render: the stylesheet keys the title row's insets off
// this, and correcting it afterwards would paint the row at the macOS
// traffic-light inset for a frame on every Windows launch.
publishWindowChrome();
installMobileViewport();
markEngineQuirks();

// Which view this window is. One bundle serves both: a second HTML entry
// point would mean a second build target and a second copy of the shared
// providers, for a window that reuses most of the app anyway. See
// commands/chat_window.rs, which opens the detached chat with this query.
const view = new URLSearchParams(window.location.search).get("view");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SettingsProvider>
      {view === "chat" ? <ChatWindowApp /> : <App />}
      <WindowEdges />
    </SettingsProvider>
  </React.StrictMode>,
);
