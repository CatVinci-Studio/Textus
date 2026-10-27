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
 * The official plugins, each turned on with its permissions through the dev
 * shim and used as a writer would: a file in its tab, its panel, its command.
 */

test("a picture opens in the Image Viewer's tab", async ({ page }) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.image-viewer": [] },
    binary: { "/notes/dot.png": PNG },
  });
  await openPath(page, "/notes/dot.png");
  const frame = tabFrame(page);
  await expect(frame.locator("#info")).toContainText("1 × 1");
  // The figure switches between fitted and the picture's own size.
  await expect(frame.locator("#zoom")).toHaveAttribute("title", "Actual size");
  await frame.locator("#zoom").click();
  await expect(frame.locator("#zoom")).toHaveText("100%");
  await expect(frame.locator("#zoom")).toHaveAttribute("title", "Fit");
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

test("a pinch zooms the PDF in place: the page never goes blank, then is drawn sharp", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.pdf-viewer": [] },
    binary: { "/notes/paper.pdf": minimalPdf("Hello PDF") },
  });
  await openPath(page, "/notes/paper.pdf");
  const frame = tabFrame(page);
  await expect(frame.locator(".page canvas")).toHaveCount(1, {
    timeout: 15_000,
  });
  // Whether a page was ever without its picture while zooming.
  await frame.locator("#viewer").evaluate((viewer) => {
    const w = window as unknown as { blank: boolean; redrawn: number };
    w.blank = false;
    w.redrawn = 0;
    new MutationObserver(() => {
      const page = viewer.querySelector(".page");
      if (!page?.querySelector("canvas")) w.blank = true;
      else w.redrawn++;
    }).observe(viewer, { childList: true, subtree: true });
  });
  const width = () =>
    frame.locator(".page").evaluate((d) => d.getBoundingClientRect().width);
  const before = await width();
  const box = (await frame.locator(".page").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -10);
  await page.keyboard.up("Control");
  expect(await width()).toBeGreaterThan(before * 1.3);
  await expect
    .poll(() =>
      frame.locator("#viewer").evaluate(() => {
        return (window as unknown as { redrawn: number }).redrawn;
      }),
    )
    .toBeGreaterThan(0);
  expect(
    await frame
      .locator("#viewer")
      .evaluate(() => (window as unknown as { blank: boolean }).blank),
  ).toBe(false);
  await expect(frame.locator(".textLayer")).toContainText("Hello PDF");
});

test("Find in the PDF tints the words and says when there are none; the zoom is kept", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.pdf-viewer": [] },
    binary: { "/notes/paper.pdf": minimalPdf("Hello PDF") },
  });
  await openPath(page, "/notes/paper.pdf");
  const frame = tabFrame(page);
  await expect(frame.locator(".textLayer")).toContainText("Hello PDF", {
    timeout: 15_000,
  });
  await frame.getByRole("button", { name: "Find in the PDF" }).click();
  const find = frame.getByRole("searchbox", { name: "Find in the PDF" });
  await find.fill("hello");
  await find.press("Enter");
  await expect(frame.locator("#find-count")).toHaveText("1/1");
  await expect(frame.locator(".textLayer span.hit")).not.toHaveCount(0);
  await find.fill("nowhere");
  await find.press("Enter");
  await expect(frame.locator("#find-count")).toHaveText("Not found");
  await expect(frame.locator(".textLayer span.hit")).toHaveCount(0);
  // A zoom chosen is where the PDF opens next time.
  await frame.getByRole("button", { name: "Zoom in" }).click();
  const zoom = (await frame.locator("#zoom").textContent()) ?? "";
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stores = (
          window as unknown as {
            __devPluginStore?: Record<string, { kv: Record<string, unknown> }>;
          }
        ).__devPluginStore;
        const kept = stores?.["catvinci.pdf-viewer|global|"]?.kv.positions as
          Record<string, { page: number; scale: number | null }> | undefined;
        return kept?.["/notes/paper.pdf"]?.scale ?? null;
      }),
    )
    .toBeCloseTo(Number(zoom.replace("%", "")) / 100, 2);
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
  // Framed, as on Linux.
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
    plugins: { "catvinci.web-view": ["network:*", "editor.read"] },
  });
  await pasteMarkdown(page, "See [the page](https://example.test/linked).");
  const link = page.locator('[data-active-tab="true"] .ProseMirror a');
  await link.click({ modifiers: ["ControlOrMeta"] });
  const web = page.frameLocator('[data-active-tab="true"] .web-page-frame');
  await expect(web.locator("h1")).toHaveText("Linked page");
  // The address bar folds to a handle, and stays folded for the next page.
  const address = page.getByRole("textbox", { name: "Web address" });
  await expect(address).toHaveValue("https://example.test/linked");
  await page.getByRole("button", { name: "Hide the address bar" }).click();
  await expect(address).toHaveCount(0);
  const show = page.getByRole("button", { name: "Show the address bar" });
  await expect(show).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("textus.webPageBarHidden")),
  ).toBe("1");
  await show.click();
  await expect(address).toBeVisible();
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

test("the Image Viewer turns a picture and answers to its keys", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.image-viewer": [] },
    binary: { "/notes/dot.png": PNG },
  });
  await openPath(page, "/notes/dot.png");
  const frame = tabFrame(page);
  await expect(frame.locator("#info")).toContainText("1 × 1");
  await frame.getByRole("button", { name: "Rotate" }).click();
  await expect(frame.locator("#image")).toHaveAttribute(
    "style",
    /rotate\(90deg\)/,
  );
  // 0 is the picture's own size, + zooms in, F fits it again.
  await frame.locator("#stage").click();
  await page.keyboard.press("0");
  await expect(frame.locator("#zoom")).toHaveText("100%");
  await page.keyboard.press("+");
  await expect(frame.locator("#zoom")).toHaveText("125%");
  await page.keyboard.press("f");
  await expect(frame.locator("#stage")).toHaveClass(/fit/);
});

test("the Word Reader finds words, zooms, and says which page", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.word-reader": [] },
    binary: {
      "/notes/letter.docx": await minimalDocx("Dear reader, dear friend"),
    },
  });
  await openPath(page, "/notes/letter.docx");
  const frame = tabFrame(page);
  await expect(frame.locator("section.docx")).toContainText("Dear reader", {
    timeout: 15_000,
  });
  await expect(frame.locator("#page")).toHaveText("Page 1 of 1");
  await frame.getByRole("button", { name: "Find" }).click();
  await frame.locator("#find-input").fill("dear");
  await expect(frame.locator("mark.hit")).toHaveCount(2);
  await expect(frame.locator("#find-count")).toHaveText("1 of 2");
  await frame.locator("#find-input").press("Enter");
  await expect(frame.locator("#find-count")).toHaveText("2 of 2");
  await frame.locator("#find-input").press("Escape");
  await expect(frame.locator("mark.hit")).toHaveCount(0);
  await frame.getByRole("button", { name: "Zoom in" }).click();
  await expect(frame.locator("#zoom")).toHaveText("110%");
});

test("Web View searches words that aren't an address, and offers pages opened before", async ({
  page,
}) => {
  await page.route("https://duckduckgo.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Results</h1>" }),
  );
  await openWithPlugins(page, {
    plugins: { "catvinci.web-view": ["network:*", "editor.read"] },
  });
  const run = (command: string) =>
    page.evaluate(
      (c) =>
        (
          window as unknown as {
            __devEmitTauriEvent: (n: string, payload: unknown) => void;
          }
        ).__devEmitTauriEvent("menu-plugin-command", c),
      command,
    );
  await run("catvinci.web-view.open");
  await page.locator(".app-dialog-input").fill("markdown tables");
  await page.keyboard.press("Enter");
  const web = page.frameLocator('[data-active-tab="true"] .web-page-frame');
  await expect(web.locator("h1")).toHaveText("Results");
  await expect(page.getByRole("textbox", { name: "Web address" })).toHaveValue(
    "https://duckduckgo.com/?q=markdown%20tables",
  );
  // Next time, the page is offered first.
  await run("catvinci.web-view.open");
  await expect(page.locator(".quick-pick-item").nth(1)).toContainText(
    "duckduckgo.com/?q=markdown%20tables",
  );
});
