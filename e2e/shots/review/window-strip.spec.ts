import { test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown, SAMPLE_DOC } from "../../helpers";

// The window strip with the side panels open and shut (#262): macOS-like
// (native frame, traffic lights drawn in for the shot) and Windows/Linux-like
// (the app draws the caption), light and dark, English and Chinese, plus a
// narrow window and 125% Interface Text Size - for review, not a baseline.
// Runs only with TEXTUS_SHOTS_DIR set to where the PNGs go:
//
//   TEXTUS_SHOTS_DIR=../assets/working/pr-262/after npm run screenshots:review -- window-strip

const DIR = process.env.TEXTUS_SHOTS_DIR;
test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");

const PANELS = {
  none: { sidebar: false, ai: false },
  sidebar: { sidebar: true, ai: false },
  ai: { sidebar: false, ai: true },
  both: { sidebar: true, ai: true },
} as const;

function pretendMac(page: Page) {
  return page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
    Object.defineProperty(navigator, "userAgent", {
      get: () =>
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    });
  });
}

/** The traffic lights macOS draws over the webview, where it draws them. */
function drawTrafficLights(page: Page) {
  return page.addStyleTag({
    content: `html::after {
      content: ""; position: fixed; z-index: 9999; top: 8px; left: 8px;
      width: 12px; height: 12px; border-radius: 50%; background: #ff5f57;
      box-shadow: 20px 0 #febc2e, 40px 0 #28c840; pointer-events: none;
    }`,
  });
}

async function open(
  page: Page,
  {
    mac,
    language,
    colorScheme,
    panels,
    scale = 1,
  }: {
    mac: boolean;
    language: string;
    colorScheme: "light" | "dark";
    panels: { sidebar: boolean; ai: boolean };
    scale?: number;
  },
) {
  if (mac) await pretendMac(page);
  await openApp(page, {
    colorScheme,
    settings: { language, uiTextScale: scale },
    storage: {
      "textus-sidebar-open": panels.sidebar ? "1" : "0",
      "levis-agent-panel-open": panels.ai ? "1" : "0",
    },
  });
  if (mac) await drawTrafficLights(page);
  await pasteMarkdown(page, SAMPLE_DOC);
}

for (const mac of [true, false])
  for (const [language, colorScheme] of [
    ["en", "light"],
    ["zh", "dark"],
  ] as const)
    for (const [name, panels] of Object.entries(PANELS))
      test(`${mac ? "macOS" : "Windows/Linux"}, ${language}, ${colorScheme}, ${name}`, async ({
        page,
      }) => {
        await open(page, { mac, language, colorScheme, panels });
        await page.screenshot({
          path: `${DIR}/${mac ? "mac" : "win"}-${language}-${colorScheme}-${name}.png`,
        });
      });

for (const mac of [true, false]) {
  test(`${mac ? "macOS" : "Windows/Linux"}, a narrow window with both panels`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 760, height: 620 });
    await open(page, {
      mac,
      language: "en",
      colorScheme: "light",
      panels: PANELS.both,
    });
    await page.screenshot({ path: `${DIR}/${mac ? "mac" : "win"}-narrow.png` });
  });

  test(`${mac ? "macOS" : "Windows/Linux"}, 125% interface text`, async ({
    page,
  }) => {
    await open(page, {
      mac,
      language: "de",
      colorScheme: "light",
      panels: PANELS.both,
      scale: 1.25,
    });
    await page.screenshot({ path: `${DIR}/${mac ? "mac" : "win"}-125.png` });
  });
}

test("zen mode with the sidebar open", async ({ page }) => {
  await open(page, {
    mac: false,
    language: "en",
    colorScheme: "light",
    panels: PANELS.sidebar,
  });
  await page.locator("html").evaluate((el) => el.classList.add("zen"));
  await page.screenshot({ path: `${DIR}/win-zen.png` });
});
