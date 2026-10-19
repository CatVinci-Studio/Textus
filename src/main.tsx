import React, { type ComponentType } from "react";
import ReactDOM from "react-dom/client";
import { SettingsProvider } from "./settings/SettingsContext";
import { installDevTauriShim } from "./dev/tauri-shim";
import { publishWindowChrome } from "./platform/window-chrome";
import { WindowEdges } from "./app/WindowEdges";
import { installWebviewGuards } from "./ui/webview-guards";
import { installScrollReveal } from "./ui/scroll-reveal";
import { restoreFolderAccess } from "./platform/ios-files";
import { installMobileViewport } from "./platform/mobile-viewport";
import { flushWhenHidden } from "./storage/pending-writes";
import "./mobile/styles/index.css";

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

// Which view this window is. One bundle serves every window: a second HTML
// entry point would mean a second build target and a second copy of the
// shared providers. See commands/chat_window.rs and commands/quick_note/,
// which open their windows with this query.
const view = new URLSearchParams(window.location.search).get("view");

// Each view is its own chunk, loaded for the window that shows it: the
// Quick Note window has to take typing a moment after its shortcut, and
// loading the editor window's App (the AI, the sidebar, export...) first
// would be most of that moment. Started here, before React, so the chunk
// is on its way while the providers mount.
const loadView: Promise<ComponentType> =
  view === "chat"
    ? import("./ai/chat/window/ChatWindowApp").then((m) => m.ChatWindowApp)
    : view === "quick-note"
      ? import("./quick-note/QuickNoteApp").then((m) => m.QuickNoteApp)
      : import("./app/App").then((m) => m.default);

void loadView.then((View) => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <SettingsProvider>
        <View />
        <WindowEdges />
      </SettingsProvider>
    </React.StrictMode>,
  );
});
