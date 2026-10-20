import { expect, test, type Page } from "@playwright/test";
import { openApp } from "../../helpers";

// Screenshots of the Files tab's Open Folder button in its three states -
// nothing saved yet, a document opened without a folder, a folder opened -
// at the sidebar's narrowest and default widths, in English and Chinese,
// light and dark, plus the interface text sizes and two bundled themes at
// the narrowest width. For review, not a baseline. Runs only with
// TEXTUS_SHOTS_DIR set:
//
//   TEXTUS_SHOTS_DIR=../assets/working/sidebar-open-folder npm run screenshots:review -- sidebar-open-folder

const DIR = process.env.TEXTUS_SHOTS_DIR;
test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");

const FOLDER = "/Users/me/Writing/Harbour City";
const FILES = {
  [`${FOLDER}/Outline.md`]: "# Outline\n\nThree parts, twelve chapters.",
  [`${FOLDER}/Part 1/Chapter 1.md`]: "# Chapter 1\n\nThe ferry came in.",
  [`${FOLDER}/Notes/Places.md`]: "# Places",
};

type State = "empty" | "document" | "folder";

function emit(page: Page, name: string, payload?: unknown) {
  return page.evaluate(
    ([name, payload]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(name as string, payload),
    [name, payload] as const,
  );
}

async function shoot(
  page: Page,
  name: string,
  options: {
    lang: string;
    dark: boolean;
    width: number;
    state: State;
    settings?: Record<string, unknown>;
  },
) {
  await page.addInitScript(
    ({ files, folder }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__devFs = files;
      w.__devPickFolder = folder;
    },
    { files: FILES, folder: FOLDER },
  );
  await openApp(page, {
    settings: { language: options.lang, ...options.settings },
    colorScheme: options.dark ? "dark" : "light",
    storage: { "textus-sidebar-width": String(options.width) },
  });
  if (options.state === "folder") await emit(page, "menu-open-folder");
  if (options.state !== "empty")
    await emit(page, "menu-open-recent", `${FOLDER}/Part 1/Chapter 1.md`);
  if (options.state !== "folder") await emit(page, "menu-toggle-sidebar");
  await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-collapsed/);
  await expect(
    page.locator(
      options.state === "empty" ? ".tree-empty-open" : ".tree-root-label",
    ),
  ).toBeVisible();
  const width = await page
    .locator(".sidebar")
    .evaluate((el) => el.getBoundingClientRect().width);
  await page.screenshot({
    path: `${DIR}/${name}.png`,
    clip: { x: 0, y: 0, width: width + 80, height: 260 },
  });
}

for (const lang of ["en", "zh"]) {
  for (const dark of [false, true]) {
    for (const width of [180, 240]) {
      for (const state of ["empty", "document", "folder"] as const) {
        const name = `${state}-${lang}-${dark ? "dark" : "light"}-${width}`;
        test(name, async ({ page }) => {
          await shoot(page, name, { lang, dark, width, state });
        });
      }
    }
  }
}

// The longest labels, at the narrowest width and the text sizes' ends.
for (const lang of ["fr", "de", "zh"]) {
  for (const scale of [0.9, 1.25]) {
    const name = `empty-${lang}-scale${scale}-180`;
    test(name, async ({ page }) => {
      await shoot(page, name, {
        lang,
        dark: false,
        width: 180,
        state: "empty",
        settings: { uiTextScale: scale },
      });
    });
  }
}

for (const theme of ["paper", "slate"]) {
  const name = `empty-en-theme-${theme}-180`;
  test(name, async ({ page }) => {
    await shoot(page, name, {
      lang: "en",
      dark: theme === "slate",
      width: 180,
      state: "empty",
      settings: { themeId: theme },
    });
  });
}

test("empty-en-focus-180", async ({ page }) => {
  await shoot(page, "empty-en-focus-180-unfocused", {
    lang: "en",
    dark: false,
    width: 180,
    state: "empty",
  });
  await page.locator(".tree-empty-open").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator(".tree-empty-open")).toBeFocused();
  await page.screenshot({
    path: `${DIR}/empty-en-focus-180.png`,
    clip: { x: 0, y: 0, width: 260, height: 260 },
  });
});
