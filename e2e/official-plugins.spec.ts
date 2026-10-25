import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockInvoke, pasteMarkdown } from "./helpers";
import {
  minimalDocx,
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

test("a file that isn't a picture says it can't be opened", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.image-viewer": [] },
    binary: {
      "/notes/broken.png": Buffer.from("not a picture").toString("base64"),
    },
    language: "zh",
  });
  await openPath(page, "/notes/broken.png");
  await expect(tabFrame(page).locator("#info")).toHaveText("这张图片打不开。");
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
  const before = (await frame.locator("#zoom").textContent()) ?? "";
  await frame.locator("#zoom-in").click();
  await expect(frame.locator("#zoom")).not.toHaveText(before);
});

test("a Chinese PDF whose font isn't in the file draws its characters", async ({
  page,
}) => {
  // Made with ReportLab: STSong-Light, not embedded, with the predefined
  // CMap UniGB-UCS2-H - PDF.js's cmaps, shipped in the plugin, draw it.
  const pdf = readFileSync(new URL("./fixtures/cjk-cmap.pdf", import.meta.url));
  await openWithPlugins(page, {
    plugins: { "catvinci.pdf-viewer": [] },
    binary: { "/notes/poem.pdf": pdf.toString("base64") },
  });
  await openPath(page, "/notes/poem.pdf");
  const frame = tabFrame(page);
  await expect(frame.locator(".textLayer")).toHaveText("春眠不觉晓", {
    timeout: 15_000,
  });
});

test("a selected link opens in a web page tab of its own", async ({ page }) => {
  await page.route("https://example.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Example page</h1>" }),
  );
  await openWithPlugins(page, {
    plugins: { "catvinci.web-view": ["network:*", "document.read"] },
  });
  await pasteMarkdown(page, "https://example.test/page");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await editor.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open the Selected Link in a Tab" })
    .click();
  // Framed, as on Linux (native-web-page.spec.ts has the native page).
  const web = page.frameLocator('[data-active-tab="true"] .web-page-frame');
  await expect(web.locator("h1")).toHaveText("Example page");
  await expect(page.getByRole("textbox", { name: "Web address" })).toHaveValue(
    "https://example.test/page",
  );
});

test("a web link Ctrl/Cmd+clicked opens in Web View, not the browser", async ({
  page,
}) => {
  await page.route("https://example.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Linked page</h1>" }),
  );
  await openWithPlugins(page, {
    plugins: { "catvinci.web-view": ["network:*", "document.read"] },
  });
  await pasteMarkdown(page, "See [the page](https://example.test/linked).");
  const link = page.locator('[data-active-tab="true"] .ProseMirror a');
  await link.click({ modifiers: ["ControlOrMeta"] });
  const web = page.frameLocator('[data-active-tab="true"] .web-page-frame');
  await expect(web.locator("h1")).toHaveText("Linked page");
  // Not handed to the system's browser (the dev shim's record).
  expect(
    await page.evaluate(
      () => (window as unknown as { __devLinks?: unknown[] }).__devLinks ?? [],
    ),
  ).toEqual([]);
});

test("a Word document reads as laid out, and Edit as Markdown converts it", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.word-reader": [] },
    binary: { "/notes/letter.docx": await minimalDocx("Dear reader") },
  });
  await openPath(page, "/notes/letter.docx");
  const frame = tabFrame(page);
  await expect(frame.locator("section.docx")).toContainText("Dear reader", {
    timeout: 15_000,
  });
  await mockInvoke(page, {
    open_word_document: { markdown: "Dear reader, as Markdown" },
  });
  await frame.getByRole("button", { name: "Edit as Markdown" }).click();
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("Dear reader, as Markdown");
});
