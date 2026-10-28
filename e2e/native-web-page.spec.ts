import { expect, test, type Page } from "@playwright/test";
import { pasteMarkdown } from "./helpers";
import { openWithPlugins } from "./plugin-helpers";

/**
 * A web page tab's page is a native webview laid over the tab (a frame in the
 * dev browser): hidden while its tab is or a menu is over it, gone with the
 * tab. Windows and macOS only; Linux keeps the framed page.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
  });
});

const native = (page: Page) => page.locator(".dev-native-web-page");

async function openPage(page: Page) {
  await page.route("https://example.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Example page</h1>" }),
  );
  await openWithPlugins(page, {
    plugins: { "catvinci.web-view": ["network:*", "editor.read"] },
  });
  await pasteMarkdown(page, "https://example.test/page");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await editor.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open or search the selection in a tab" })
    .click();
  await expect(
    page.frameLocator(".dev-native-web-page").locator("h1"),
  ).toHaveText("Example page");
}

test("the page lies over its tab's area, below the address bar", async ({
  page,
}) => {
  await openPage(page);
  const holder = (await page
    .locator('[data-active-tab="true"] .web-page-native')
    .boundingBox())!;
  const shown = (await native(page).boundingBox())!;
  for (const side of ["x", "y", "width", "height"] as const)
    expect(Math.abs(shown[side] - holder[side])).toBeLessThan(2);
});

test("the page goes out of sight with its tab and under a menu, and comes back", async ({
  page,
}) => {
  await openPage(page);
  // Another tab in front: hidden; back: shown again, the same page.
  await page.locator(".tab-bar [role='tab']").first().click();
  await expect(native(page)).toBeHidden();
  await page.locator(".tab-bar [role='tab']").last().click();
  await expect(native(page)).toBeVisible();
  // A menu over the window: hidden while it is open.
  await page
    .locator(".window-bar .app-menu-button, [aria-label='Menu']")
    .first()
    .click();
  await expect(page.getByRole("menu").first()).toBeVisible();
  await expect(native(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(native(page)).toBeVisible();
});

test("closing the tab lets its page go", async ({ page }) => {
  await openPage(page);
  // Delete on the tab closes it.
  await page.locator(".tab-bar [role='tab']").last().focus();
  await page.keyboard.press("Delete");
  await expect(native(page)).toHaveCount(0);
});

const emit = (page: Page, payload: unknown) =>
  page.evaluate(
    (p) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (n: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent("web-page-navigated", p),
    payload,
  );

test("a page that doesn't finish loading says so, and Reload tries again", async ({
  page,
}) => {
  await page.clock.install();
  await openPage(page);
  const id = await page
    .locator('[data-active-tab="true"]')
    .getAttribute("data-tab-id");
  // A load starts and never finishes (a refused certificate, no network).
  await emit(page, { id, url: "https://example.test/page", loading: true });
  await page.clock.fastForward(16_000);
  const failed = page.locator(".web-page-failed");
  await expect(failed).toBeVisible();
  await expect(native(page)).toBeHidden();
  await failed.getByRole("button", { name: "Reload" }).click();
  await expect(failed).toHaveCount(0);
  await expect(native(page)).toBeVisible();
});

test("a page long out of sight is let go, and loads again when shown", async ({
  page,
}) => {
  await page.clock.install();
  await openPage(page);
  await page.locator(".tab-bar [role='tab']").first().click();
  await expect(native(page)).toBeHidden();
  await page.clock.fastForward(5 * 60_000 + 1_000);
  await expect(native(page)).toHaveCount(0);
  await page.locator(".tab-bar [role='tab']").last().click();
  await expect(
    page.frameLocator(".dev-native-web-page").locator("h1"),
  ).toHaveText("Example page");
});
