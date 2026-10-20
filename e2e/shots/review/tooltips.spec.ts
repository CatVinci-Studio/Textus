import { expect, test, type Page } from "@playwright/test";
import { openApp } from "../../helpers";

// Screenshots of the hover tooltips (ui/Tooltip.tsx) - the composer's Deep
// thinking button off and on, and the window bar's AI button - in Chinese
// and English, light and dark, for review rather than as a baseline. Runs
// only with TEXTUS_SHOTS_DIR set to where the PNGs go:
//
//   TEXTUS_SHOTS_DIR=../assets/working/tooltips-1.2.0 npm run screenshots:review -- tooltips

const DIR = process.env.TEXTUS_SHOTS_DIR;
test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");

const NAMES = { zh: "深度思考", en: "Deep thinking" } as const;

async function open(
  page: Page,
  language: "zh" | "en",
  colorScheme: "light" | "dark",
) {
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.addInitScript(() => {
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      { ai_can_think_deeper: true };
  });
  await openApp(page, {
    colorScheme,
    settings: { language },
    storage: { "levis-agent-panel-open": "1" },
  });
}

/** The panel's lower part: the composer and the tooltip above it. */
async function shootComposer(page: Page, file: string) {
  const panel = (await page.locator(".agent-panel-view").boundingBox())!;
  await page.screenshot({
    path: `${DIR}/${file}`,
    clip: {
      x: panel.x,
      y: panel.y + panel.height - 220,
      width: panel.width,
      height: 220,
    },
  });
}

for (const language of ["zh", "en"] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`deep thinking, ${language}, ${scheme}`, async ({ page }) => {
      await open(page, language, scheme);
      const button = page.getByRole("button", {
        name: NAMES[language],
        exact: true,
      });
      await button.hover();
      await expect(page.getByRole("tooltip")).toBeVisible();
      await page.waitForTimeout(300);
      await shootComposer(page, `deep-thinking-${language}-${scheme}.png`);

      await button.click();
      await page.mouse.move(0, 0);
      await button.hover();
      await expect(page.getByRole("tooltip")).toBeVisible();
      await page.waitForTimeout(300);
      await shootComposer(page, `deep-thinking-on-${language}-${scheme}.png`);
    });

    test(`window bar, ${language}, ${scheme}`, async ({ page }) => {
      await open(page, language, scheme);
      await page.locator(".window-bar-toggle").hover();
      await expect(page.getByRole("tooltip")).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${DIR}/window-bar-${language}-${scheme}.png`,
        clip: { x: 700, y: 0, width: 500, height: 90 },
      });
    });
  }
}
