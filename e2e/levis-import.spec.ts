import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/** A Levis installation on this computer, as levis_import_status reports
 *  it, and what the import copied. Set before the app starts: the offer is
 *  made on the first launch. */
async function withLevis(page: Page, items: string[]) {
  await page.addInitScript((items) => {
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      {
        levis_import_status: {
          supported: true,
          levisDir: "/home/me/.config/com.chengaoshen.levis",
          items,
        },
        levis_import: {
          imported: items.filter((i) => i !== "credentials"),
          kept: [],
          failed: [],
        },
      };
  }, items);
}

test("a first launch with Levis data offers the import before the language welcome", async ({
  page,
}) => {
  await withLevis(page, ["settings", "themes", "credentials"]);
  await openApp(page, {
    settings: { language: "en", languageChosen: false },
  });
  const dialog = page.locator(".app-dialog");
  await expect(dialog).toContainText("Bring over your Levis data?");
  await expect(page.locator(".language-welcome")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Import" }).click();
  // Levis has keys: asked separately, and leaving them is the way out.
  await expect(dialog).toContainText("Also copy API keys and sign-ins?");
  await dialog.getByRole("button", { name: "Leave them" }).click();
  await expect(dialog).toContainText(
    "Imported from Levis: settings and themes.",
  );
  await dialog.getByRole("button").click();
  await expect(dialog).toHaveCount(0);
});

test("Not now goes on to the language welcome, and Settings keeps the import", async ({
  page,
}) => {
  await withLevis(page, ["settings", "skills"]);
  await openApp(page, {
    settings: { language: "en", languageChosen: false },
  });
  await page
    .locator(".app-dialog")
    .getByRole("button", { name: "Not now" })
    .click();
  await expect(page.locator(".language-welcome")).toBeVisible();
  await page.locator(".language-welcome-continue").click();

  // The import stays on Settings › General › About Textus.
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (name: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const panel = page.locator(".settings-panel");
  await panel.getByRole("button", { name: "About Textus" }).click();
  await expect(
    panel.locator(".settings-about").getByRole("button", { name: "Import" }),
  ).toBeVisible();
});

test("without Levis data there is no offer", async ({ page }) => {
  await withLevis(page, []);
  await openApp(page, {
    settings: { language: "en", languageChosen: false },
  });
  await expect(page.locator(".language-welcome")).toBeVisible();
  await expect(page.locator(".app-dialog")).toHaveCount(0);
});
