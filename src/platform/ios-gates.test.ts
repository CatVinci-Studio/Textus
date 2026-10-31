import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * iOS is the same app in a narrower layout (docs/dev/ios-code-map.md): a
 * feature is never hidden there. The files that may still ask `isIOSApp`
 * are listed with what iOS can't do, or does its own way; a new one goes
 * here with its reason, or uses a capability flag or the phone layout.
 */
const ALLOWED: Record<string, string> = {
  "ai/chat/chat-history.ts": "paths relative to the app's Documents folder",
  "ai/revision/pending-accept.ts":
    "no focus: the keyboard would cover the sheet",
  "app/AgentPanelDock.tsx": "the AI panel is a bottom sheet with a grip",
  "app/App.tsx": "the keyboard toolbar and the document list",
  "app/AppNotices.tsx": "no Esc key: Zen mode's hint stays as the way out",
  "app/Sidebar.tsx": "the sidebar is a drawer, its width the layout's",
  "app/WindowBar.tsx": "the sidebar opens from the phone's own bar",
  "app/WindowControls.tsx": "the title row's menu button",
  "app/sidebar-tabs.tsx": "the drawer closes over a document it opened",
  "app/tabs/TabPill.tsx": "a haptic tap as a tab lifts",
  "app/useFileOpening.ts": "no files dropped on the window",
  "app/useSidePanels.ts":
    "a drawer that starts closed, a sheet over the keyboard",
  "document-view/EditorPane.tsx": "the system's own overscroll",
  "document-view/useQuickAskReview.ts": "the keyboard and the review's focus",
  "document/ios-recents.ts": "the document list's recent documents",
  "document/startup-restore.ts": "reopens the last document; no shortcut tour",
  "document/word-import.ts":
    "Files' security-scoped URLs the converter can't read",
  "editor/code/code-language-picker.tsx": "the system's picker",
  "platform/ios-files.ts": "the Files app's documents",
  "platform/ipc-files.ts": "the Files app's documents",
  "platform/ipc.ts": "desktop-only commands answer empty",
  "platform/mobile-viewport.ts": "the keyboard resizes the page",
  "plugins/manager.ts": "textus.env.platform tells plugins it is iOS",
  "settings/sections/providers.tsx": "no keyboard raised on its own",
  "settings/settings-pages.tsx": "no keyboard to bind shortcuts on",
  "sidebar/FileTree.tsx": "nothing above Documents or a granted folder",
  "sidebar/TreeNodes.tsx": "a long press for the row's menu",
  "theme/apply-appearance.ts":
    "its WebKit draws CJK as boxes under generic system fonts",
  "ui/Select.tsx": "the system's picker",
  "ui/usePhoneLayout.ts": "the phone layout itself",
};

const SRC = fileURLToPath(new URL("..", import.meta.url));

function asking(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .map((file) => file.split("\\").join("/"))
    .filter(
      (file) =>
        /\.tsx?$/.test(file) &&
        !/\.test\.tsx?$/.test(file) &&
        file !== "platform/capabilities.ts" &&
        /\bisIOSApp\b/.test(readFileSync(join(SRC, file), "utf8")),
    )
    .sort();
}

describe("iOS checks", () => {
  it("are asked only where iOS can't do a thing or does it its own way", () => {
    expect(asking()).toEqual(Object.keys(ALLOWED).sort());
  });
});
