import { expect, test, type Page } from "@playwright/test";
import { openApp, PHONE } from "../../helpers";

// Screenshots of the `/` menu, the `@` empty state and Settings' skills in
// four UI languages, desktop and phone - for review, not a baseline. Runs
// only with TEXTUS_SHOTS_DIR set to where the PNGs go:
//
//   TEXTUS_SHOTS_DIR=../assets/creative npm run screenshots:review -- skills

const DIR = process.env.TEXTUS_SHOTS_DIR;
const LANGUAGES = ["zh", "en", "ja", "de"];

test.skip(!DIR, "set TEXTUS_SHOTS_DIR to take the screenshots");

async function open(page: Page, language: string, phone: boolean) {
  if (phone)
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "iPhone" });
    });
  await openApp(page, {
    settings: { language },
    storage: phone ? {} : { "levis-agent-panel-open": "1" },
  });
  if (phone) await page.locator(".window-bar-toggle").tap();
  const input = page.locator(".agent-panel .inline-chat-input");
  await expect(input).toBeVisible();
  return input;
}

async function openSettings(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const panel = page.locator(".settings-panel");
  await expect(panel).toBeVisible();
  await panel.locator(".settings-nav-item").nth(2).click();
  return panel;
}

for (const phone of [false, true]) {
  const form = phone ? "phone" : "desktop";
  test.describe(form, () => {
    if (phone) test.use(PHONE);
    for (const language of LANGUAGES) {
      const shot = (page: Page, name: string) =>
        page.screenshot({
          path: `${DIR}/skills-${language}-${form}-${name}.png`,
        });

      test(`${language}: the / menu and the @ empty state`, async ({
        page,
      }) => {
        const input = await open(page, language, phone);
        await input.click();
        await input.fill("/");
        await expect(page.locator(".composer-picker")).toBeVisible();
        await page.waitForTimeout(200);
        await shot(page, "slash");
        await input.fill("@");
        await expect(
          page.locator(".composer-picker [role=status]"),
        ).toBeVisible();
        await page.waitForTimeout(200);
        await shot(page, "at-empty");
      });

      test(`${language}: Settings' skills and conventions`, async ({
        page,
      }) => {
        await open(page, language, phone);
        // One customized and one turned off, to show both states.
        await page.evaluate(() => {
          const skills = (
            window as unknown as {
              __devSkills: { disabled: Set<string>; customized: Set<string> };
            }
          ).__devSkills;
          skills.disabled.add("de-ai");
          skills.customized.add("proofread");
        });
        const panel = await openSettings(page);
        const builtins = panel.locator(".settings-builtin-skills");
        await builtins.locator("summary").click();
        await builtins.scrollIntoViewIfNeeded();
        await builtins.evaluate((el) =>
          el.scrollIntoView({ block: "start", behavior: "instant" }),
        );
        await page.waitForTimeout(300);
        await shot(page, "settings-skills");
        // Writing conventions: the last row of Writing Assistance.
        const target = panel
          .locator(".settings-group")
          .nth(1)
          .locator(".ui-select")
          .last();
        await target.evaluate((el) =>
          el.scrollIntoView({ block: "center", behavior: "instant" }),
        );
        await page.waitForTimeout(300);
        await target.click();
        await page.waitForTimeout(300);
        await shot(page, "settings-conventions");
      });
    }
  });
}
