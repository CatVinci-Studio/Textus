import type { Page } from "@playwright/test";
import { openApp } from "./helpers";

// For the official plugins' flows (official-plugins.spec.ts): the window
// with plugins already on, files to open, and the frame of a plugin's tab.

/** A 1×1 PNG. */
export const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

export async function openWithPlugins(
  page: Page,
  options: {
    plugins: Record<string, string[]>;
    binary?: Record<string, string>;
    folder?: Record<string, string>;
    files?: Record<string, string>;
    language?: string;
  },
) {
  await page.addInitScript((o) => {
    if (window.top !== window) return;
    const w = window as unknown as Record<string, unknown>;
    w.__devPluginState = {
      allOn: true,
      plugins: Object.fromEntries(
        Object.entries(o.plugins).map(([id, granted]) => [
          id,
          { enabled: true, granted },
        ]),
      ),
    };
    w.__devBinaryFiles = o.binary ?? {};
    if (o.folder) w.__devFs = o.folder;
    if (o.files) w.__devFiles = o.files;
  }, options);
  await openApp(page, { settings: { language: options.language ?? "en" } });
}

/** Opens `path` as Open Recent would. */
export const openPath = (page: Page, path: string) =>
  page.evaluate(
    (p) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (n: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent("menu-open-recent", p),
    path,
  );

/** The frame of the plugin's tab in front. */
export const tabFrame = (page: Page) =>
  page.frameLocator('[data-active-tab="true"] .plugin-webview-frame');

