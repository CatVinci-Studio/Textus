import { expect, test } from "@playwright/test";
import { openApp, PHONE } from "./helpers";

// A phone turned on its side, and what a finger reaches on a phone and a
// touch tablet.
const PHONE_SIDEWAYS = {
  ...PHONE,
  viewport: { width: 844, height: 390 },
  screen: { width: 844, height: 390 },
};

test.describe("a phone on its side", () => {
  test.use(PHONE_SIDEWAYS);

  test("keeps the phone's layout, Settings in one column", async ({ page }) => {
    await openApp(page, { settings: { language: "en" } });
    await expect(page.locator("html")).toHaveAttribute(
      "data-window-chrome",
      "mobile",
    );
    await expect(page.locator(".document-menu-button")).toBeVisible();
    await page.getByRole("button", { name: "Menu", exact: true }).tap();
    await page.getByRole("menuitem", { name: /Settings/ }).tap();
    await expect(page.locator(".settings-layout")).toHaveCSS(
      "flex-direction",
      "column",
    );
  });
});
