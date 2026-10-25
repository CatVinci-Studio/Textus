import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

/**
 * Settings › Extensions › Get more (MarketPage): plugins, themes and
 * skills in one place, one search over them and a filter by kind; a
 * skill installed from the catalog is the user's from then on.
 */

const SKILLS = [
  {
    name: "press-release",
    version: "1.0.0",
    description: "Writes a press release from notes: headline, lead, quotes.",
    author: "CatVinci Studio",
    official: true,
    url: "https://github.com/CatVinci-Studio/textus-plugins/releases/download/catalog/skill-press-release.md",
    sha256: "ab",
    size: 10,
  },
  {
    name: "cover-letter",
    version: "1.0.0",
    description: "Turns a job ad and a CV into a cover letter.",
    author: "CatVinci Studio",
    official: true,
    url: "https://github.com/CatVinci-Studio/textus-plugins/releases/download/catalog/skill-cover-letter.md",
    sha256: "ab",
    size: 10,
  },
];

async function openMarket(page: Page) {
  await page.addInitScript((skills) => {
    (window as unknown as Record<string, unknown>).__devCatalogSkills = skills;
  }, SKILLS);
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, { list_skills: [] });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  await page.getByRole("button", { name: "Extensions" }).click();
  await page.getByRole("tab", { name: "Skills" }).click();
  await page.getByRole("button", { name: "Get more" }).click();
}

test("the market's skills install with a click, and say so once installed", async ({
  page,
}) => {
  await openMarket(page);
  // Opened on its kind, from the Skills tab.
  await expect(page.getByRole("tab", { name: "Skills" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const card = page.locator('[data-skill="press-release"]');
  await expect(card).toContainText("/press-release");
  await expect(card).toContainText("Official");
  await card.getByRole("button", { name: "Install" }).click();
  await expect(card).toContainText("Installed");
  const installed = await page.evaluate(
    () =>
      (window as unknown as { __devInstalledSkills: string[] })
        .__devInstalledSkills,
  );
  expect(installed).toEqual(["press-release"]);
});

test("one search goes over plugins, themes and skills, and All shows each kind", async ({
  page,
}) => {
  await openMarket(page);
  await page.getByRole("tab", { name: "All" }).click();
  for (const kind of ["Plugins", "Themes", "Skills"])
    await expect(page.getByRole("region", { name: kind })).toBeVisible();
  // Each kind in one box, the themes too - not a box in a box.
  await expect(page.locator(".theme-gallery-item")).toHaveCount(2);
  await expect(page.locator(".settings-group .settings-group")).toHaveCount(0);
  const search = page.getByRole("searchbox", {
    name: "Search plugins, themes, skills and servers",
  });
  await search.fill("cover letter");
  await expect(page.locator("[data-skill]")).toHaveCount(1);
  await expect(page.locator('[data-skill="cover-letter"]')).toBeVisible();
});
