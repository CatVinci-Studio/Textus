import { expect, test } from "@playwright/test";
import { PHONE, openApp, openPhone } from "./helpers";

// The window bar's AI panel button: the app icon's quill, struck through
// while Textus AI is off. The phone's title row draws the same button.

const button = '.window-bar-toggle[aria-label="Textus AI"]';

test("the AI panel's button is Textus AI, untranslated, with its shortcut in the tooltip", async ({
  page,
}) => {
  // In Chinese: the product's name is not translated.
  await openApp(page, { settings: { language: "zh" } });
  const toggle = page.locator(button);
  await expect(toggle).toHaveAccessibleDescription(/^Textus AI \(.+L\) · /);
  // The quill, one filled shape.
  await expect(toggle.locator("svg path")).toHaveCount(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".agent-panel-view")).toBeVisible();
});

test("the panel has no close button; the quill and its menu close it", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const toggle = page.locator(button);
  const panel = page.locator(".agent-panel-view");
  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Close chat" })).toHaveCount(
    0,
  );
  // Its menu offers to close the panel only while it is open.
  await toggle.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close the panel" }).click();
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Pause for an hour" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Close the panel" }),
  ).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use(PHONE);

  test("the title row's AI button is the same quill", async ({ page }) => {
    await openPhone(page);
    const toggle = page.locator(button);
    await expect(toggle.locator("svg path")).toHaveCount(1);
    await toggle.tap();
    await expect(page.locator(".agent-panel-view")).toBeVisible();
  });

  test("the sheet keeps its close button, over the page", async ({ page }) => {
    await openPhone(page);
    await page.locator(button).tap();
    const panel = page.locator(".agent-panel-view");
    await panel.getByRole("button", { name: "Close chat" }).tap();
    await expect(panel).toBeHidden();
  });
});
