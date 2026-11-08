import type { Plugin } from "vite";

/**
 * The e2e flows' platform: Playwright's server sets TEXTUS_E2E_PLATFORM, and
 * the page reads it as `navigator.platform` before the app starts, so a run
 * on a Mac takes Ctrl as the shortcut key as CI's Linux does. Mac-only keys
 * are checked on a real Mac (docs/dev/testing.md).
 */
export function e2ePlatform(): Plugin {
  const platform = process.env.TEXTUS_E2E_PLATFORM;
  return {
    name: "e2e-platform",
    apply: "serve",
    transformIndexHtml: () =>
      platform
        ? [
            {
              tag: "script",
              children: `Object.defineProperty(Navigator.prototype, "platform", { get: () => ${JSON.stringify(platform)} });`,
              injectTo: "head-prepend",
            },
          ]
        : [],
  };
}
