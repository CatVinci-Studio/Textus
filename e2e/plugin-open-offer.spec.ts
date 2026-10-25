import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";
import { minimalPdf, openPath, tabFrame } from "./plugin-helpers";

// No plugin comes with Textus: a PDF opened without one offers the PDF
// Viewer from the market, and Install and open opens the file with it.

async function openWithPdf(page: import("@playwright/test").Page) {
  await page.addInitScript((pdf) => {
    if (window.top !== window) return;
    (window as unknown as Record<string, unknown>).__devBinaryFiles = {
      "/notes/paper.pdf": pdf,
    };
  }, minimalPdf("Hello PDF"));
  await openApp(page, { settings: { language: "en" } });
}

test("a PDF without its plugin offers it, installs it and opens the file", async ({
  page,
}) => {
  await openWithPdf(page);
  await openPath(page, "/notes/paper.pdf");
  const dialog = page.locator(".app-dialog");
  await expect(dialog).toContainText("opens “paper.pdf”");
  await dialog.getByRole("button", { name: "Install and open" }).click();
  // Its permissions, as any install asks.
  const allow = page.locator(".app-dialog").getByRole("button", {
    name: "Allow",
  });
  if (await allow.isVisible().catch(() => false)) await allow.click();
  await expect(tabFrame(page).locator(".textLayer")).toContainText("Hello PDF");
});

test("declined, the file isn't opened and nothing is installed", async ({
  page,
}) => {
  await openWithPdf(page);
  await openPath(page, "/notes/paper.pdf");
  const dialog = page.locator(".app-dialog");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".plugin-webview-frame")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (
          (window as unknown as { __devPlugins?: { id: string }[] })
            .__devPlugins ?? []
        ).length,
    ),
  ).toBe(0);
});
