import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// Another app's settings found in a folder are offered on a corner card and
// never applied by themselves; taking them writes the project's own
// .textus/settings.json.

async function open(page: Page, files: Record<string, string>) {
  await page.addInitScript((fs) => {
    (window as unknown as Record<string, unknown>).__devFs = fs;
  }, files);
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (n: string, p: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-recent", "/vault/notes/a.md"),
  );
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror h1'),
  ).toContainText("Alpha");
}

const disk = (page: Page, path: string) =>
  page.evaluate(
    (p) =>
      (window as unknown as { __devFs: Record<string, string> }).__devFs[p],
    path,
  );

const VAULT = {
  "/vault/.obsidian/app.json": JSON.stringify({
    attachmentFolderPath: "Attachments",
  }),
  "/vault/notes/a.md": "# Alpha\n\none\ntwo\n",
};

test("an Obsidian vault's settings are offered, and taken into .textus", async ({
  page,
}) => {
  await open(page, VAULT);
  const card = page.locator(".conventions-card");
  await expect(card).toContainText(
    "This folder's Obsidian settings store pictures in Attachments/",
  );
  await card.locator(".corner-toast-summary").click();
  await expect(card).toContainText("Current setting: assets/");
  await card.getByRole("button", { name: "Adopt" }).click();
  await expect(card).toHaveCount(0);
  await expect
    .poll(async () =>
      JSON.parse((await disk(page, "/vault/.textus/settings.json")) ?? "{}"),
    )
    .toMatchObject({
      conventions: { attachments: "Attachments", detected: "followed" },
    });
});

test("turned down, nothing applies and the folder isn't asked again", async ({
  page,
}) => {
  await open(page, VAULT);
  const card = page.locator(".conventions-card");
  await card.getByRole("button", { name: "Keep Current" }).click();
  await expect
    .poll(async () =>
      JSON.parse((await disk(page, "/vault/.textus/settings.json")) ?? "{}"),
    )
    .toEqual({ conventions: { detected: "declined" } });
});

test("Settings says where the project puts pictures", async ({ page }) => {
  await open(page, {
    "/vault/.textus/settings.json": JSON.stringify({
      conventions: { attachments: "./pics" },
    }),
    "/vault/notes/a.md": "# Alpha\n",
  });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (name: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const panel = page.getByRole("dialog", { name: "Settings" });
  await panel.getByRole("button", { name: "Editor & Appearance" }).click();
  await expect(panel).toContainText(
    "This project saves pictures in pics/ (set in .textus/settings.json).",
  );
});
