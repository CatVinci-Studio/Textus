import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown, SAMPLE_DOC } from "../../helpers";

// Review screenshots of Settings › Shortcuts and of the narrowest panels at
// 100% and 125% text size. Runs only with TEXTUS_SHOTS_DIR set.

const DIR = process.env.TEXTUS_SHOTS_DIR;
test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");

const SCALES = [1, 1.25] as const;
const pct = (scale: number) => `${Math.round(scale * 100)}`;

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

async function openSettings(page: Page, category: string) {
  await emit(page, "menu-open-settings");
  const panel = page.locator(".settings-panel");
  await panel
    .locator(".settings-nav-item")
    .nth(category === "editor" ? 1 : 3)
    .click();
  return panel;
}

for (const mac of [false, true])
  for (const scale of SCALES)
    test(`Settings › Shortcuts, ${mac ? "macOS" : "Windows/Linux"}, ${pct(scale)}%`, async ({
      page,
    }) => {
      if (mac)
        await page.addInitScript(() => {
          Object.defineProperty(navigator, "platform", {
            get: () => "MacIntel",
          });
          Object.defineProperty(navigator, "userAgent", {
            get: () =>
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
          });
        });
      await openApp(page, { settings: { language: "en", uiTextScale: scale } });
      const panel = await openSettings(page, "shortcuts");
      const name = `shortcuts-${mac ? "mac" : "win"}-${pct(scale)}`;
      await page.screenshot({ path: `${DIR}/${name}-top.png` });
      const fixed = panel.locator(".shortcut-fixed");
      await fixed.scrollIntoViewIfNeeded();
      await panel
        .locator(".settings-content")
        .evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await page.screenshot({ path: `${DIR}/${name}-fixed.png` });
    });

for (const language of ["en", "de", "zh"])
  for (const scale of SCALES)
    test(`sidebar, tabs and AI panel at their narrowest, ${language}, ${pct(scale)}%`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1000, height: 720 });
      await openApp(page, {
        settings: { language, uiTextScale: scale },
        storage: {
          "textus-sidebar-open": "1",
          "textus-sidebar-width": "180",
          "textus-agent-panel-open": "1",
          "textus-agent-panel-width": "300",
        },
      });
      await pasteMarkdown(page, SAMPLE_DOC);
      await emit(page, "menu-open-help", "markdown");
      await emit(page, "menu-open-help", "agent");
      await page.locator(".tab-pill").first().click();
      await page.locator(".sidebar-tab").nth(1).click();
      await expect(page.locator(".sidebar .outline-row").first()).toBeVisible();
      // A long selection, for the composer's chip.
      await page.locator(".milkdown p").first().click({ clickCount: 3 });
      await page.locator(".agent-panel-view textarea").click();
      await page.screenshot({
        path: `${DIR}/panels-${language}-${pct(scale)}.png`,
      });
    });

for (const scale of SCALES)
  test(`Settings › Editor & Appearance, ${pct(scale)}%`, async ({ page }) => {
    await openApp(page, { settings: { language: "en", uiTextScale: scale } });
    await openSettings(page, "editor");
    await page.screenshot({ path: `${DIR}/settings-editor-${pct(scale)}.png` });
  });

for (const scale of SCALES)
  test(`the app menu, ${pct(scale)}%`, async ({ page }) => {
    await openApp(page, { settings: { language: "en", uiTextScale: scale } });
    await page.locator(".window-menu-button").click();
    await page
      .locator(".app-menu-list")
      .getByText("View", { exact: true })
      .hover();
    await page.screenshot({ path: `${DIR}/menu-${pct(scale)}.png` });
  });
