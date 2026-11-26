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
  "app/useOpenFolder.ts":
    "a reinstall moves Documents, and the AI's folder with it",
  "ai/chat/panel/agent-panel.tsx": "a docked panel drawn at its width",
  "editor/click-below-end.ts":
    "a tap beside a table: its caret went astray, onto a word it selected",
  "export/exporters.ts":
    "its PDF is WebKit's, as a Mac's, and goes to the share sheet",
  "document/word-import.ts":
    "Files' security-scoped URLs the converter can't read",
  "platform/far-files.ts": "the Files app's documents",
  "platform/native-files.ts": "the Files app's documents",
  "platform/ipc-files.ts": "the Files app's documents",
  "platform/ipc-ai-workspace.ts": "the project folder is picked in Files",
  "platform/mobile-viewport.ts":
    "the safe area from WebKit's env(), Android's from its bridge",
  "theme/apply-appearance.ts": "its keyboard takes the window's dark or light",
  "theme/imported-theme.ts":
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
