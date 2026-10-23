import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * The file-backed storage path (src-tauri/src/settings.rs): the page is
 * booted the way Rust boots a real window - the boot script itself
 * (src-tauri/src/boot.js) runs first with a snapshot - and the dev shim
 * stands in for the store behind the commands, exposing its state as
 * `window.__devStorage`. Every other spec runs without a snapshot, on the
 * localStorage fallback.
 */

const BOOT_JS = readFileSync(
  new URL("../src-tauri/src/boot.js", import.meta.url),
  "utf8",
);

interface DevStorage {
  settings: Record<string, unknown>;
  patches: Record<string, unknown>[];
  fills: Record<string, unknown>[];
  /** Every command in order, plus "<command>:done" for each storage write
   *  answered (dev/tauri-shim.ts). */
  log: string[];
  uiState: Record<string, unknown>;
  histories: Record<string, { text?: string }[]>;
}

/** Set before the app loads (the dev shim reads them as it installs). */
async function shimOptions(
  page: Page,
  options: { latency?: number; liveSettings?: Record<string, unknown> },
) {
  await page.addInitScript((o) => {
    const w = window as unknown as Record<string, unknown>;
    if (o.latency !== undefined) w.__devStorageLatency = o.latency;
    if (o.liveSettings) w.__devLiveSettings = o.liveSettings;
  }, options);
}

async function bootLikeRust(
  page: Page,
  boot: {
    settings: Record<string, unknown>;
    uiState?: Record<string, unknown>;
  },
  themeCss: { light: string; dark: string | null } | null = null,
) {
  const snapshot = {
    rev: 1,
    label: "main",
    uiState: {},
    ...boot,
  };
  await page.addInitScript(
    ({ script, snapshot, themeCss }) => {
      // As Rust's boot_script does it.
      new Function(script)();
      (
        window as unknown as {
          __textusBoot: (boot: unknown, css: unknown) => void;
        }
      ).__textusBoot(snapshot, themeCss);
      // What the document looked like before any of the app's own code
      // ran: "interactive" is reached once the HTML is parsed, before the
      // (deferred) module scripts execute.
      document.addEventListener("readystatechange", () => {
        if (document.readyState !== "interactive") return;
        const root = document.documentElement;
        (window as unknown as { __firstPaint: unknown }).__firstPaint = {
          theme: root.getAttribute("data-theme"),
          width: root.getAttribute("data-content-width"),
          contentTheme: root.getAttribute("data-content-theme"),
          userTheme: root.getAttribute("data-user-theme"),
          lang: root.getAttribute("lang"),
          themeCss:
            document.getElementById("textus-custom-theme")?.textContent ?? null,
          chrome:
            document.getElementById("textus-imported-chrome")?.textContent ??
            null,
          customCss:
            document.getElementById("textus-user-css")?.textContent ?? null,
          // The user's CSS goes last, after the page's own styles.
          lastInHead: document.head.lastElementChild?.id ?? null,
        };
      });
    },
    { script: BOOT_JS, snapshot, themeCss },
  );
}

const devStorage = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __devStorage: DevStorage }).__devStorage,
  );

const emit = (page: Page, name: string, payload?: unknown) =>
  page.evaluate(
    ([event, data]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(event as string, data),
    [name, payload] as const,
  );

const SETTINGS = {
  language: "ja",
  languageChosen: true,
  onboardingShown: true,
  theme: "dark",
  themeId: "paper",
  contentWidth: "full",
  customCss: "#write { letter-spacing: 0.01em; }",
};

test("the boot script puts the appearance on the document before the app runs", async ({
  page,
}) => {
  await bootLikeRust(page, { settings: SETTINGS });
  await openApp(page, { settings: { language: "zh", theme: "light" } });
  const first = await page.evaluate(
    () => (window as unknown as { __firstPaint: unknown }).__firstPaint,
  );
  expect(first).toEqual({
    theme: "dark",
    width: "full",
    contentTheme: "paper",
    userTheme: null,
    lang: "ja",
    themeCss: null,
    chrome: null,
    customCss: SETTINGS.customCss,
    lastInHead: "textus-user-css",
  });
  // The snapshot, not localStorage (which openApp seeded with zh/light).
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("lang", "ja");
  // React took over the boot script's <style> rather than adding another.
  await expect(page.locator("style#textus-user-css")).toHaveCount(1);
  expect(
    await page
      .locator("style#textus-user-css")
      .evaluate((el) => el.textContent),
  ).toBe(SETTINGS.customCss);
});

test("an imported theme is on the first frame, in the variant for the appearance", async ({
  page,
}) => {
  await bootLikeRust(
    page,
    {
      settings: {
        ...SETTINGS,
        themeId: "mine",
        userThemes: [{ id: "mine", name: "Mine", hasDark: true }],
      },
    },
    {
      light: "#write { color: rgb(1, 2, 3); }",
      dark: "#write thead th { color: rgb(4, 5, 6); }",
    },
  );
  await openApp(page);
  const first = await page.evaluate(
    () =>
      (window as unknown as { __firstPaint: Record<string, unknown> })
        .__firstPaint,
  );
  // Dark (pinned), with the Typora header selector rewritten as the
  // frontend does it, and before the user's CSS.
  expect(first.themeCss).toBe(
    "#write tr[data-is-header] th { color: rgb(4, 5, 6); }",
  );
  expect(first.userTheme).toBe("");
  expect(first.contentTheme).toBeNull();
  expect(first.lastInHead).toBe("textus-user-css");
});

test("a change goes to Rust as a patch of that field alone", async ({
  page,
}) => {
  await bootLikeRust(page, { settings: SETTINGS });
  await openApp(page);
  await emit(page, "menu-toggle-typewriter-mode");
  await expect
    .poll(async () => (await devStorage(page)).patches)
    .toEqual([{ typewriterMode: true }]);
  // localStorage is left as the backup a downgrade would read.
  const local = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}"),
  );
  expect(local.typewriterMode).toBeUndefined();
});

test("another window's change shows up here, except its zoom", async ({
  page,
}) => {
  await bootLikeRust(page, { settings: { ...SETTINGS, zoom: 1 } });
  await openApp(page);
  await emit(page, "settings-changed", {
    rev: 50,
    patch: { theme: "light", contentWidth: "standard", zoom: 2 },
    from: "window-2",
  });
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).toHaveAttribute("data-content-width", "standard");
  // An older event (delivered late) doesn't undo it.
  await emit(page, "settings-changed", {
    rev: 40,
    patch: { theme: "dark" },
    from: "window-3",
  });
  await page.waitForTimeout(100);
  await expect(html).toHaveAttribute("data-theme", "light");
  const zoom = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue(
      "--content-zoom",
    ),
  );
  expect(zoom.trim() === "" || zoom.trim() === "1").toBe(true);
});

test("clipboard history is recorded entry by entry in the store", async ({
  page,
}) => {
  await bootLikeRust(page, { settings: SETTINGS });
  await openApp(page);
  await pasteMarkdown(page, "pasted words");
  await expect
    .poll(async () => (await devStorage(page)).histories.clipboard)
    .toEqual([expect.objectContaining({ text: "pasted words" })]);
  expect(
    await page.evaluate(() => localStorage.getItem("textus-clipboard-history")),
  ).toBeNull();
});

/** In English, with Custom CSS empty. */
const TYPING = { ...SETTINGS, language: "en", customCss: "" };

/** Settings > Extensions > Themes > Custom CSS. */
async function customCssField(page: Page) {
  await emit(page, "menu-open-settings");
  const panel = page.getByRole("dialog", { name: "Settings" });
  await panel.getByRole("button", { name: "Editor & Appearance" }).click();
  await panel.getByRole("button", { name: "Get more themes" }).click();
  return panel.getByRole("textbox", { name: "Custom CSS" });
}

test("a setting typed just before the window closes still reaches Rust", async ({
  page,
}) => {
  // Rust answers slowly here, so a close that didn't wait would show.
  await shimOptions(page, { latency: 150 });
  await bootLikeRust(page, { settings: TYPING });
  await openApp(page);
  const css = await customCssField(page);
  await css.fill("p { color: red; }");
  // Closed at once, with the patch still on its way to Rust - the way the
  // close button, Close Window and Quit all reach a window.
  await emit(page, "tauri://close-requested", null);
  await expect
    .poll(async () => (await devStorage(page)).log)
    .toContain("plugin:window|destroy");
  // What Rust had at the moment the window was destroyed:
  const stored = await devStorage(page);
  expect(stored.settings.customCss).toBe("p { color: red; }");
  const answered = stored.log.indexOf("settings_patch:done");
  expect(answered).toBeGreaterThan(-1);
  expect(answered).toBeLessThan(stored.log.indexOf("plugin:window|destroy"));
});

test("Don't Save on the unsaved-changes prompt also waits for the settings", async ({
  page,
}) => {
  await shimOptions(page, { latency: 150 });
  await bootLikeRust(page, { settings: TYPING });
  await openApp(page);
  await pasteMarkdown(page, "unsaved words");
  const css = await customCssField(page);
  await css.fill("h1 { color: blue; }");
  await emit(page, "tauri://close-requested", null);
  // The document is dirty: the prompt, not a close.
  await page.locator(".close-prompt-discard").click();
  await expect
    .poll(async () => (await devStorage(page)).log)
    .toContain("plugin:window|destroy");
  const stored = await devStorage(page);
  expect(stored.settings.customCss).toBe("h1 { color: blue; }");
  const answered = stored.log.indexOf("settings_patch:done");
  expect(answered).toBeGreaterThan(-1);
  expect(answered).toBeLessThan(stored.log.indexOf("plugin:window|destroy"));
});

test("a zoom step just before the window closes is kept for the next window", async ({
  page,
}) => {
  await shimOptions(page, { latency: 150 });
  await bootLikeRust(page, { settings: TYPING });
  await openApp(page);
  // View > Zoom In, then closed at once: the zoom is saved only once it
  // has rested for 400 ms (a pinch moves it every frame).
  await emit(page, "menu-zoom-in");
  await emit(page, "tauri://close-requested", null);
  await expect
    .poll(async () => (await devStorage(page)).log)
    .toContain("plugin:window|destroy");
  const stored = await devStorage(page);
  expect(stored.settings.zoom).toBeCloseTo(1.1);
  const destroyed = stored.log.indexOf("plugin:window|destroy");
  expect(stored.log.slice(0, destroyed)).toContain("settings_patch:done");
});

test("the detached chat window also waits for its writes before it closes", async ({
  page,
}) => {
  await shimOptions(page, { latency: 150 });
  await bootLikeRust(page, { settings: TYPING });
  await page.goto("/?view=chat");
  await page.getByRole("button", { name: "Keep on top" }).click();
  await emit(page, "tauri://close-requested", null);
  await expect
    .poll(async () => (await devStorage(page)).log)
    .toContain("plugin:window|destroy");
  const stored = await devStorage(page);
  expect(stored.settings.pinAgentWindow).toBe(true);
  const answered = stored.log.indexOf("settings_patch:done");
  expect(answered).toBeGreaterThan(-1);
  expect(answered).toBeLessThan(stored.log.indexOf("plugin:window|destroy"));
});

test("a window booted with no settings fills in defaults, never over newer values", async ({
  page,
}) => {
  // After a corrupt settings.json was moved aside, the window booted with
  // an empty snapshot - and a reload replays that same snapshot, while Rust
  // holds everything the user has changed since.
  await shimOptions(page, { liveSettings: SETTINGS });
  await bootLikeRust(page, { settings: {} });
  await openApp(page);
  const html = page.locator("html");
  // The live values, not the defaults the empty snapshot stands for.
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("data-content-width", "full");
  await expect(html).toHaveAttribute("lang", "ja");
  const stored = await devStorage(page);
  expect(stored.settings).toMatchObject(SETTINGS);
  // Defaults went only into the fields that were missing.
  expect(stored.fills).toHaveLength(1);
  expect(stored.fills[0]).not.toHaveProperty("theme");
  expect(stored.fills[0]).toHaveProperty("enableCompletion", true);
  expect(stored.patches.filter((p) => "theme" in p)).toEqual([]);
});

/** An imported theme, and the app chrome colours the frontend last derived
 *  from it (theme/theme-chrome.ts), as ui-state.json remembers them. */
const THEME_CSS = "#write { color: rgb(1, 2, 3); }";
const CHROME = ":root { --sidebar-bg: rgb(10, 20, 30) !important; }";
const themed = (theme: string) => ({
  ...SETTINGS,
  theme,
  themeId: "mine",
  userThemes: [{ id: "mine", name: "Mine", hasDark: false }],
});
const remembered = (overrides: object = {}) => ({
  themeChrome: {
    id: "mine",
    dark: false,
    sourceLength: THEME_CSS.length,
    css: CHROME,
    ...overrides,
  },
});
const firstPaint = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __firstPaint: Record<string, unknown> })
        .__firstPaint,
  );

test("the imported theme's chrome colours are on the first frame too", async ({
  page,
}) => {
  await bootLikeRust(
    page,
    { settings: themed("light"), uiState: remembered() },
    { light: THEME_CSS, dark: null },
  );
  await openApp(page);
  const first = await firstPaint(page);
  expect(first.chrome).toBe(CHROME);
  expect(first.lastInHead).toBe("textus-user-css");
  // The frontend derives them afresh and keeps that order: the user's CSS
  // after them, so the first frame and the next agree on who wins.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ids = Array.from(document.head.children, (el) => el.id);
        const chrome = document.getElementById("textus-imported-chrome");
        return (
          !!chrome?.textContent?.includes("--editor-bg") &&
          ids.indexOf("textus-imported-chrome") < ids.indexOf("textus-user-css")
        );
      }),
    )
    .toBe(true);
});

for (const [name, theme, cache] of [
  // Derived for the light appearance; the window opens dark.
  ["another appearance", "dark", remembered()],
  // A hand-edited theme file.
  ["a theme file that changed", "light", remembered({ sourceLength: 3 })],
  ["another theme", "light", remembered({ id: "other" })],
] as const) {
  test(`chrome colours remembered for ${name} stay off the first frame`, async ({
    page,
  }) => {
    await bootLikeRust(
      page,
      { settings: themed(theme), uiState: cache },
      { light: THEME_CSS, dark: null },
    );
    await openApp(page);
    expect((await firstPaint(page)).chrome).toBeNull();
    // The frontend derives them afresh and remembers them for next time.
    await expect
      .poll(
        async () =>
          (await devStorage(page)).uiState.themeChrome as
            { id: string; dark: boolean; css: string } | undefined,
      )
      .toMatchObject({ id: "mine", dark: theme === "dark" });
    expect(
      ((await devStorage(page)).uiState.themeChrome as { css: string }).css,
    ).toContain("--sidebar-bg");
  });
}
