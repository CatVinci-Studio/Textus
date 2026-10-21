import { expect, test } from "@playwright/test";
import {
  minimalPdf,
  openPath,
  openWithPlugins,
  PNG,
  tabFrame,
} from "./plugin-helpers";

/**
 * The official plugins (public/plugins/official/), each turned on with its
 * permissions through the dev shim (window.__devPluginState) and used as
 * a writer would: a file opened in its tab, its sidebar panel, its command.
 */

test("a picture opens in the Image Viewer's tab", async ({ page }) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.image-viewer": [] },
    binary: { "/notes/dot.png": PNG },
  });
  await openPath(page, "/notes/dot.png");
  const frame = tabFrame(page);
  await expect(frame.locator("#info")).toContainText("1 × 1");
  await expect(frame.locator("#fit")).toHaveText("Fit");
  await frame.locator("#actual").click();
  await expect(frame.locator("#zoom")).toHaveText("100%");
  await frame.locator("#zoom-in").click();
  await expect(frame.locator("#zoom")).toHaveText("125%");
});

test("an SVG shows as a picture, its source a click away", async ({ page }) => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>';
  await openWithPlugins(page, {
    plugins: { "catvinci.image-viewer": [] },
    binary: { "/notes/box.svg": Buffer.from(svg).toString("base64") },
    language: "zh",
  });
  await openPath(page, "/notes/box.svg");
  const frame = tabFrame(page);
  await expect(frame.locator("#info")).toContainText("40 × 20");
  await frame.locator("#source").click();
  await expect(frame.locator("#code")).toContainText("<rect");
  await expect(frame.locator("#source")).toHaveText("图片");
});

test("a PDF opens in the PDF Viewer, its words there to select", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.pdf-viewer": [] },
    binary: { "/notes/paper.pdf": minimalPdf("Hello PDF") },
  });
  await openPath(page, "/notes/paper.pdf");
  const frame = tabFrame(page);
  await expect(frame.locator("#count")).toHaveText("/ 1", { timeout: 15_000 });
  await expect(frame.locator(".page canvas")).toHaveCount(1);
  await expect(frame.locator(".textLayer")).toContainText("Hello PDF");
  const before = await frame.locator("#zoom").textContent();
  await frame.locator("#zoom-in").click();
  await expect(frame.locator("#zoom")).not.toHaveText(before ?? "");
});
