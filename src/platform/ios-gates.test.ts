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
  "app/SettingsLayer.tsx": "Settings is a sheet over the window, not a tab",
  "app/frame/WindowControls.tsx": "the title row's menu button",
  "app/frame/sidebar-tabs.tsx": "the drawer closes over a document it opened",
  "ai/chat/panel/agent-panel.tsx": "a docked panel drawn at its width",
  "document/word-import.ts":
    "Files' security-scoped URLs the converter can't read",
  "platform/ios-files.ts": "the Files app's documents",
  "platform/ipc-files.ts": "the Files app's documents",
  "platform/ipc-ai-workspace.ts": "the project folder is picked in Files",
  "theme/apply-appearance.ts":
    "its WebKit draws CJK as boxes under generic system fonts",
  "engine/controls/elastic-overscroll.ts": "the system's own overscroll",
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
