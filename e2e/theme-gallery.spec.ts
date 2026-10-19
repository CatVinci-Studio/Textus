import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// Settings › Editor & Appearance › Browse themes, against the dev shim's
// canned gallery (src/dev/tauri-shim.ts, `window.__devThemeGallery`):
// installing a theme makes it a user theme and applies it, an installed
// one can be picked again, a newer catalog entry offers an update that
// replaces the installed copy, and an unreachable gallery says so with a
// way to retry.

interface DevGallery {
  offline: boolean;
  themes: { id: string; updated: string }[];
  files: Record<string, string>;
}

async function openGallery(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog
    .locator(".settings-nav-item", { hasText: "Editor & Appearance" })
    .click();
  await dialog.getByRole("button", { name: "Browse themes" }).click();
  await expect(
    dialog.getByRole("region", { name: "Browse themes" }),
  ).toBeVisible();
  return dialog;
}

/** Takes the gallery off- or online, or publishes a new version of its
 *  first theme. */
function changeGallery(
  page: Page,
  change: { offline?: boolean; update?: { updated: string; css: string } },
) {
  return page.evaluate(({ offline, update }) => {
    const gallery = (window as unknown as { __devThemeGallery: DevGallery })
      .__devThemeGallery;
    if (offline !== undefined) gallery.offline = offline;
    if (update) {
      gallery.themes[0].updated = update.updated;
      gallery.files[`themes/${gallery.themes[0].id}/theme.css`] = update.css;
    }
  }, change);
}

const injectedTheme = (page: Page) =>
  page.evaluate(
    () => document.getElementById("textus-custom-theme")?.textContent ?? "",
  );

test.describe("theme gallery", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, { settings: { language: "en" } });
  });

  test("installs a theme, applies it, and switches back to it later", async ({
    page,
  }) => {
    const dialog = await openGallery(page);
    const mint = dialog.getByRole("group", { name: "Paper Mint" });
    const dusk = dialog.getByRole("group", { name: "Dusk" });
    await expect(mint.locator("img")).toHaveAttribute("src", /^data:image\//);

    await mint.getByRole("button", { name: "Install" }).click();
    await expect(mint).toContainText("In use");
    await expect(page.locator("html")).toHaveAttribute("data-user-theme", "");
    await expect.poll(() => injectedTheme(page)).toContain("#eef7f1");

    await dusk.getByRole("button", { name: "Install" }).click();
    await expect(dusk).toContainText("In use");
    await expect(mint).toContainText("Installed");
    await expect.poll(() => injectedTheme(page)).toContain("#23202b");

    await mint.getByRole("button", { name: "Use" }).click();
    await expect(mint).toContainText("In use");
    await expect.poll(() => injectedTheme(page)).toContain("#eef7f1");

    // An ordinary user theme in the picker, by its gallery name.
    await dialog.locator(".settings-back-button").click();
    await expect(dialog.getByLabel("Editor theme")).toContainText("Paper Mint");
  });

  test("offers an update when the catalog has a newer version", async ({
    page,
  }) => {
    let dialog = await openGallery(page);
    const mint = () => dialog.getByRole("group", { name: "Paper Mint" });
    await mint().getByRole("button", { name: "Install" }).click();
    await expect(mint()).toContainText("In use");
    const settingsBefore = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}"),
    );

    await changeGallery(page, {
      update: {
        updated: "2026-10-20T00:00:00Z",
        css: ":root { --editor-bg: #f4fbf6; }",
      },
    });
    await page.keyboard.press("Escape");
    dialog = await openGallery(page);
    await mint().getByRole("button", { name: "Update" }).click();
    await expect(mint()).toContainText("In use");
    await expect(mint().getByRole("button", { name: "Update" })).toHaveCount(0);
    await expect.poll(() => injectedTheme(page)).toContain("#f4fbf6");

    // Same theme, same id: the update replaced the copy, not added one.
    const settings = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}"),
    );
    expect(settings.userThemes).toHaveLength(1);
    expect(settings.userThemes[0].id).toBe(settingsBefore.userThemes[0].id);
    expect(settings.userThemes[0].gallery).toMatchObject({
      id: "paper-mint",
      updated: "2026-10-20T00:00:00Z",
    });
  });

  test("says when the gallery can't be reached, and tries again", async ({
    page,
  }) => {
    await changeGallery(page, { offline: true });
    const dialog = await openGallery(page);
    await expect(dialog.getByRole("status")).toContainText(
      "Couldn't reach the theme gallery",
    );
    await dialog.getByRole("button", { name: "Open website" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __devStorage: { log: string[] } })
              .__devStorage.log,
        ),
      )
      .toContain("open_about_link");

    await changeGallery(page, { offline: false });
    await dialog.getByRole("button", { name: "Try again" }).click();
    await expect(dialog.getByRole("group", { name: "Dusk" })).toBeVisible();
  });
});
