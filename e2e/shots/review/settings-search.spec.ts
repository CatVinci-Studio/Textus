import { test, type Page } from "@playwright/test";
import { PHONE, openApp, openPhone } from "../../helpers";

// Settings' search box: the results of a query, and the row a result led
// to while its tint is on, in English and Chinese, on the desktop and the
// phone, light and dark - for review, not a baseline. Runs only with
// TEXTUS_SHOTS_DIR set to where the PNGs go:
//
//   TEXTUS_SHOTS_DIR=../assets/working/settings-search-1.2.0 npm run screenshots:review -- settings-search

const DIR = process.env.TEXTUS_SHOTS_DIR;
test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");

/** A query that finds rows on several pages, and the "?" text. */
const QUERIES = { en: "theme", zh: "主题" } as const;

async function shoot(page: Page, prefix: string, language: "en" | "zh") {
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const panel = page.locator(".settings-panel");
  await panel.waitFor();
  const box = panel.locator(".settings-search-input");
  await box.fill(QUERIES[language]);
  await panel.getByRole("option").first().waitFor();
  await box.press("ArrowDown");
  await panel.screenshot({ path: `${DIR}/${prefix}-results.png` });
  await box.press("Enter");
  await panel.locator(".settings-search-hit").waitFor();
  // Mid-fade, as the eye catches it.
  await page.waitForTimeout(300);
  await panel.screenshot({ path: `${DIR}/${prefix}-jumped.png` });
}

for (const language of ["en", "zh"] as const)
  for (const colorScheme of ["light", "dark"] as const) {
    const suffix = `${language}${colorScheme === "dark" ? "-dark" : ""}`;
    test(`Settings search, desktop, ${suffix}`, async ({ page }) => {
      await openApp(page, {
        settings: { language },
        colorScheme,
        animations: true,
      });
      await shoot(page, `desktop-${suffix}`, language);
    });
    test.describe(`phone ${suffix}`, () => {
      test.use(PHONE);
      test(`Settings search, phone, ${suffix}`, async ({ page }) => {
        await openPhone(page, {
          settings: { language },
          colorScheme,
          animations: true,
        });
        await shoot(page, `phone-${suffix}`, language);
      });
    });
  }
