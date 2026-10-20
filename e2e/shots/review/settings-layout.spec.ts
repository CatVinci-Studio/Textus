import { test, type Page } from "@playwright/test";
import { PHONE, openApp, openPhone } from "../../helpers";

// Every page of Settings at its full length - each category, About Textus
// and More themes, in English and Chinese, on the desktop and the phone,
// light and dark - and a row's "?" open, for reviewing how Settings is
// grouped, ordered and explained, not a baseline. Runs only with
// TEXTUS_SHOTS_DIR set to where the PNGs go:
//
//   TEXTUS_SHOTS_DIR=../assets/working/settings-themes-1.2.0/after npm run screenshots:review -- settings-layout

const DIR = process.env.TEXTUS_SHOTS_DIR;
test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");

const LANGUAGES = ["en", "zh"] as const;

/** File names by category, the same in either language. */
const CATEGORY_IDS: Record<string, string> = {
  General: "general",
  通用: "general",
  "Editor & Appearance": "editor",
  编辑与外观: "editor",
  "Textus AI": "ai",
  Shortcuts: "shortcuts",
  快捷键: "shortcuts",
  Privacy: "privacy",
  隐私: "privacy",
};

function openSettings(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string) => void;
      }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
}

/** Lets the panel grow to its content, so one screenshot holds the page. */
const UNCLIP = `
  .settings-backdrop { position: absolute !important; align-items: flex-start !important; padding-top: 16px; }
  .settings-panel { height: auto !important; max-height: none !important; }
  .settings-layout, .settings-content { overflow: visible !important; max-height: none !important; }
`;

async function shootPages(page: Page, prefix: string) {
  await openSettings(page);
  const panel = page.locator(".settings-panel");
  await panel.waitFor();
  await page.addStyleTag({ content: UNCLIP });
  const width = page.viewportSize()?.width ?? 1180;
  const height = page.viewportSize()?.height ?? 780;
  const nav = panel.locator(".settings-nav-item");
  const count = await nav.count();
  const shoot = async (name: string) => {
    // Open what is folded away, so the shot shows every row.
    await panel.evaluate((el) =>
      el.querySelectorAll("details").forEach((d) => (d.open = true)),
    );
    const box = await panel.boundingBox();
    await page.setViewportSize({
      width,
      height: Math.max(height, Math.ceil((box?.height ?? 0) + 40)),
    });
    await panel.screenshot({ path: `${DIR}/${prefix}-${name}.png` });
    await page.setViewportSize({ width, height });
  };
  for (let i = 0; i < count; i++) {
    await nav.nth(i).click();
    const label = (await nav.nth(i).getAttribute("data-label")) ?? "";
    await shoot(`${i + 1}-${CATEGORY_IDS[label] ?? i + 1}`);
    if (i === 0) {
      await panel
        .locator(".settings-link-row", {
          hasText: /^(About Textus|关于 Textus)$/,
        })
        .click();
      await shoot("1b-about");
      await panel.locator(".settings-back-button").click();
    }
    if (CATEGORY_IDS[label] === "editor") {
      await panel
        .locator(".settings-link-row", {
          hasText: /^(More themes|更多主题)$/,
        })
        .click();
      await shoot("2b-more-themes");
      await panel.locator(".settings-back-button").click();
    }
  }
}

for (const language of LANGUAGES)
  for (const colorScheme of ["light", "dark"] as const)
    test(`Settings, every page, desktop, ${language}, ${colorScheme}`, async ({
      page,
    }) => {
      await openApp(page, { settings: { language }, colorScheme });
      await shootPages(
        page,
        `desktop-${language}${colorScheme === "dark" ? "-dark" : ""}`,
      );
    });

test.describe("phone", () => {
  test.use(PHONE);
  for (const language of LANGUAGES)
    for (const colorScheme of ["light", "dark"] as const)
      test(`Settings, every page, phone, ${language}, ${colorScheme}`, async ({
        page,
      }) => {
        await openPhone(page, { settings: { language }, colorScheme });
        await shootPages(
          page,
          `phone-${language}${colorScheme === "dark" ? "-dark" : ""}`,
        );
      });
});

/** A row's "?" open, as a click leaves it: the diagram engine's trade-off. */
for (const language of LANGUAGES)
  for (const colorScheme of ["light", "dark"] as const)
    test(`Settings, a ? open, desktop, ${language}, ${colorScheme}`, async ({
      page,
    }) => {
      await openApp(page, { settings: { language }, colorScheme });
      await openSettings(page);
      const panel = page.locator(".settings-panel");
      await panel.locator(".settings-nav-item").nth(1).click();
      const help = panel.locator(".info-tip-button").nth(1);
      await help.scrollIntoViewIfNeeded();
      await help.click();
      await page.getByRole("tooltip").waitFor();
      await page.screenshot({
        path: `${DIR}/desktop-${language}${colorScheme === "dark" ? "-dark" : ""}-help-open.png`,
      });
    });
