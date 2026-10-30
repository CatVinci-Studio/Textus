import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

/**
 * Settings › Extensions › Skills: the user's skills, then the catalog's
 * others under Available; one search goes through both, and a skill
 * installed from the catalog moves up among the user's.
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

async function openSkills(page: Page) {
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
}

test("a catalog skill installs with a click and leaves the Available list", async ({
  page,
}) => {
  await openSkills(page);
  const available = page.locator(".extensions-available");
  const card = available.locator('[data-skill="press-release"]');
  await expect(card).toContainText("/press-release");
  await expect(card).toContainText("Official");
  // From here on the backend lists it as the user's.
  await mockInvoke(page, {
    list_skills: [
      { name: "press-release", source: "global", description: "", modes: [] },
    ],
  });
  await card.getByRole("button", { name: "Install" }).click();
  await expect(card).toHaveCount(0);
  const installed = await page.evaluate(
    () =>
      (window as unknown as { __devInstalledSkills: string[] })
        .__devInstalledSkills,
  );
  expect(installed).toEqual(["press-release"]);
});

test("one search goes through the installed skills and the available ones", async ({
  page,
}) => {
  await openSkills(page);
  const search = page.getByRole("searchbox", { name: "Search" });
  await search.fill("cover letter");
  await expect(page.locator(".extensions-available [data-skill]")).toHaveCount(
    1,
  );
  await expect(page.locator('[data-skill="cover-letter"]')).toBeVisible();
  // The built-ins live under Textus AI, not here.
  await expect(page.locator(".settings-builtin-skill")).toHaveCount(0);
  // Folded, the list stays folded the next time.
  await page
    .locator(".extensions-available")
    .getByRole("button", { name: "Hide" })
    .click();
  await expect(page.locator(".extensions-available [data-skill]")).toHaveCount(
    0,
  );
});
