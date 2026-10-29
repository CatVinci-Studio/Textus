import { expect, test } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * The menu bar, where the app draws the window frame (Windows and Linux): off
 * by default, on from Settings; each title opens its list, the pointer or
 * ← / → moves between them, and the ☰ returns in a window too narrow.
 */

const bar = '[role="menubar"]';

test("off by default: the ☰ and the sidebar's button", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await expect(page.locator(".window-menu-button")).toBeVisible();
  await expect(
    page.locator('.window-bar [aria-label="Sidebar"]'),
  ).toBeVisible();
  await expect(page.locator(bar)).toHaveCount(0);
});

test("Settings turns it on, and the sidebar's button makes room", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog
    .locator(".settings-nav-item", { hasText: "Editor & Appearance" })
    .click();
  await dialog.getByRole("checkbox", { name: "Show the menu bar" }).click();
  await expect(page.locator(bar)).toBeVisible();
  await expect(page.locator(".window-bar [aria-label='Sidebar']")).toHaveCount(
    0,
  );
  await expect(page.locator(".window-menu-button")).toBeHidden();
});

test("each title opens its list; the pointer and ← / → move along", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", menuBarShown: true } });
  const menubar = page.locator(bar);
  await expect(menubar.getByRole("menuitem").first()).toHaveText("File");
  await menubar.getByRole("menuitem", { name: "File" }).click();
  const list = page.locator(".app-menu");
  await expect(list.getByRole("menuitem", { name: /New Tab/ })).toBeVisible();
  // Its own list only: no other top-level title in it.
  await expect(list.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);

  await menubar.getByRole("menuitem", { name: "Edit" }).hover();
  await expect(list.getByRole("menuitem", { name: /Undo/ })).toBeVisible();
  await expect(menubar.getByRole("menuitem", { name: "Edit" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  await page.keyboard.press("ArrowLeft");
  await expect(list.getByRole("menuitem", { name: /New Tab/ })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(list.getByRole("menuitem", { name: /Undo/ })).toBeVisible();

  // A row runs as from the ☰: View › Sidebar asks the backend for it.
  await mockInvoke(page, { trigger_menu_item: null });
  await menubar.getByRole("menuitem", { name: "View" }).click();
  await list.getByRole("menuitemcheckbox", { name: "Sidebar" }).click();
  await expect(page.locator(".app-menu")).toHaveCount(0);
  const asked = await page.evaluate(
    () =>
      (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
        .__devInvokeCalls ?? [],
  );
  expect(asked).toContainEqual(
    expect.objectContaining({ cmd: "trigger_menu_item" }),
  );

  await menubar.getByRole("menuitem", { name: "File" }).click();
  // The list takes the focus, for the arrow keys; Escape closes it.
  await expect(list.getByRole("menuitem", { name: /New Tab/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-menu")).toHaveCount(0);
});

test("a window too narrow for the titles has the ☰ back", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 700 });
  await openApp(page, { settings: { language: "en", menuBarShown: true } });
  await expect(page.locator(bar)).toBeHidden();
  await page.locator(".window-menu-button").click();
  await expect(
    page.locator(".app-menu").getByRole("menuitem", { name: "File" }),
  ).toBeVisible();
});

test("Edit › Undo and Redo take back a paste, from the bar and from the macOS menu", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", menuBarShown: true } });
  const doc = page.locator('[data-active-tab="true"] .ProseMirror');
  const menubar = page.locator(bar);
  const list = page.locator(".app-menu");
  await pasteMarkdown(page, "Pasted words");
  await expect(doc).toContainText("Pasted words");

  await menubar.getByRole("menuitem", { name: "Edit" }).click();
  await list.getByRole("menuitem", { name: /Undo/ }).click();
  await expect(doc).not.toContainText("Pasted");
  await menubar.getByRole("menuitem", { name: "Edit" }).click();
  await list.getByRole("menuitem", { name: /Redo/ }).click();
  await expect(doc).toContainText("Pasted words");

  // The macOS menu bar's items arrive as events.
  const emit = (name: string) =>
    page.evaluate(
      (n) =>
        (
          window as unknown as { __devEmitTauriEvent: (n: string) => void }
        ).__devEmitTauriEvent(n),
      name,
    );
  await doc.focus();
  await emit("menu-undo");
  await expect(doc).not.toContainText("Pasted");
  await emit("menu-redo");
  await expect(doc).toContainText("Pasted words");
});
