import { expect, test } from "@playwright/test";
import { MAC, mockInvoke, openApp, PHONE, settled, sourceOf } from "./helpers";
import { openPath, PNG } from "./plugin-helpers";

// `![[...]]` while the caret is away: a picture drawn in place of its source.
test("an image embed shows as its picture, its source hidden", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __devFiles: Record<string, string> }).__devFiles = {
      "/work/a.md": "Before\n\n![[pic.png]]\n\nAfter\n",
      "/work/pic.png": "",
    };
  });
  // The picture's file, as the asset protocol serves it.
  await page.route("http://asset.localhost/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(PNG, "base64"),
    }),
  );
  await openApp(page);
  // Found in the folder by its name, as the native side finds it.
  await mockInvoke(page, { resolve_vault_image: "/work/pic.png" });
  await openPath(page, "/work/a.md");
  const doc = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(doc).toContainText("After");
  await expect(doc.locator(".obsidian-embed-source-hidden")).toHaveCount(1);
  // The picture itself, loaded.
  await expect
    .poll(() =>
      doc
        .locator(".obsidian-embed-rendered img")
        .first()
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
});

// `[TOC]` lists the document's headings, on the desktop and on a phone.
for (const phone of [false, true]) {
  test.describe(phone ? "on a phone" : "on the desktop", () => {
    if (phone) test.use(PHONE);
    test("[TOC] lists the headings", async ({ page }) => {
      await page.addInitScript(() => {
        (
          window as unknown as { __devFiles: Record<string, string> }
        ).__devFiles = {
          "/work/toc.md": "# Title\n\n[TOC]\n\n## One\n\nText\n\n## Two\n",
        };
      });
      await openApp(page);
      await openPath(page, "/work/toc.md");
      const toc = page.locator('[data-active-tab="true"] .ProseMirror .md-toc');
      await expect(toc.locator(".md-toc-item")).toHaveText([
        "Title",
        "One",
        "Two",
      ]);
    });
  });
}

test("a diagram folds to its line, its source kept, and stays folded", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __devFiles: Record<string, string> }).__devFiles = {
      "/work/d.md": "before\n\n```mermaid\ngraph LR\n  A --> B\n```\n\nafter\n",
    };
  });
  await openApp(page);
  await openPath(page, "/work/d.md");
  const doc = page.locator('[data-active-tab="true"] .ProseMirror');
  const block = doc.locator(".mermaid-block");
  await expect(block.locator(".mermaid-preview svg")).toBeVisible();
  await block.hover();
  await block.getByRole("button", { name: "折叠: 图表" }).click();
  await expect(block.locator(".mermaid-preview")).toBeHidden();
  await expect(
    block.getByRole("button", { name: "展开: 图表" }).last(),
  ).toBeVisible();
  expect(await sourceOf(page)).toBe(
    "before\n\n```mermaid\ngraph LR\n  A --> B\n```\n\nafter",
  );
  // Kept through the document being opened again.
  await page.reload();
  await openPath(page, "/work/d.md");
  await expect(doc.locator(".mermaid-block")).toHaveAttribute(
    "data-folded",
    "",
  );
  await doc.locator(".mermaid-block .block-folded-line").click();
  await expect(doc.locator(".mermaid-preview svg")).toBeVisible();
});

// #801: a diagram first in a document sat under the caret the document
// opened with, and showed only its source.
test("a diagram first in a document is drawn as it opens, its source a click away", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __devFiles: Record<string, string> }).__devFiles = {
      "/work/d.md": "```mermaid\ngraph LR\n  A --> B\n```\n\nafter\n",
    };
  });
  await openApp(page);
  await openPath(page, "/work/d.md");
  const doc = page.locator('[data-active-tab="true"] .ProseMirror');
  const drawing = doc.locator(".mermaid-preview svg");
  await expect(drawing).toBeVisible();
  await expect(doc.locator(".mermaid-source-hidden")).toHaveCount(1);
  await drawing.click();
  await expect(doc.locator(".mermaid-source-hidden")).toHaveCount(0);
});

test("a heading folds its section away, keeps the text, and opens for a caret", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __devFiles: Record<string, string> }).__devFiles = {
      "/work/f.md":
        "# One\n\nfirst body\n\n## Inner\n\ninner body\n\n# Two\n\nsecond body\n",
    };
  });
  await openApp(page);
  await openPath(page, "/work/f.md");
  const doc = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(doc).toContainText("second body");
  await doc.locator("h1", { hasText: "One" }).hover();
  await page
    .locator('[data-active-tab="true"] .block-handle .block-handle-fold')
    .click();
  // Everything under One, up to Two, is gone; Two's section stays.
  await expect(doc.getByText("first body")).toBeHidden();
  await expect(doc.getByText("inner body")).toBeHidden();
  await expect(doc.getByText("second body")).toBeVisible();
  // Only the drawing changed: the text is the same.
  expect(await sourceOf(page)).toBe(
    "# One\n\nfirst body\n\n## Inner\n\ninner body\n\n# Two\n\nsecond body",
  );
  // Kept through the editor being made again. Arrows pass it by; a caret
  // sent into it (the outline's heading under it) opens it.
  await expect(doc.getByText("first body")).toBeHidden();
  await page.locator('[data-rail-id="outline"]').click();
  await page.locator(".outline-row", { hasText: "Inner" }).click();
  await expect(doc.getByText("first body")).toBeVisible();
  await expect(doc.getByText("inner body")).toBeVisible();
  // From the keyboard: the caret's section (Inner, from the outline's
  // jump) folds and opens.
  await page.keyboard.press(
    MAC ? "Meta+Alt+BracketLeft" : "Control+Shift+BracketLeft",
  );
  await expect(doc.getByText("inner body")).toBeHidden();
  await expect(doc.getByText("first body")).toBeVisible();
  await page.keyboard.press(
    MAC ? "Meta+Alt+BracketRight" : "Control+Shift+BracketRight",
  );
  await expect(doc.getByText("inner body")).toBeVisible();
});

// #775: a diagram that can't be drawn keeps its source and says why under
// it; fixed, the drawing replaces the note.
test("a diagram with a syntax error shows the error under its source", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __devFiles: Record<string, string> }).__devFiles = {
      "/work/d.md":
        "before\n\n```mermaid\ngraph LR\n  A --> B\n  linkStyle 5 stroke:#f00\n  A -->\n```\n\nafter\n",
    };
  });
  await openApp(page);
  await openPath(page, "/work/d.md");
  const doc = page.locator('[data-active-tab="true"] .ProseMirror');
  const note = doc.locator(".diagram-error");
  await expect(note).toBeVisible();
  await expect(note.locator(".diagram-error-title")).toHaveText("图表无法绘制");
  await expect(note.locator(".diagram-error-detail")).not.toBeEmpty();
  await expect(doc.locator(".mermaid-preview svg")).toHaveCount(0);
  // The note is not part of the document.
  expect(await sourceOf(page)).not.toContain("图表无法绘制");
});

test("a diagram drawn above the screen doesn't move what is on screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  const words = Array.from(
    { length: 40 },
    (_, i) => `Paragraph ${i} ${"words to read ".repeat(12)}`,
  );
  await page.addInitScript(
    (text) => {
      (window as unknown as { __devFiles: Record<string, string> }).__devFiles =
        {
          "/work/d.md": text,
        };
    },
    "Top\n\n```mermaid\ngraph TD\n  A --> B\n  B --> C\n  C --> D\n  D --> E\n```\n\n" +
      words.join("\n\n"),
  );
  // Mermaid arrives once the reader has scrolled past the diagram.
  await page.route(/\/\.vite\/deps\/mermaid\.js/, async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await openApp(page);
  await openPath(page, "/work/d.md");
  const doc = page.locator('[data-active-tab="true"] .ProseMirror');
  const read = doc.locator("p", { hasText: "Paragraph 6 " });
  await read.waitFor();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  await scroller.evaluate((s) => (s.scrollTop = 400));
  const before = (await read.boundingBox())!.y;
  await expect(doc.locator(".mermaid-preview svg")).toBeAttached({
    timeout: 10_000,
  });
  await settled(page);
  expect(Math.abs((await read.boundingBox())!.y - before)).toBeLessThan(1);
});

// #815: a picture after a list item's text wraps to a line of its own; the
// item is as tall as its lines, with no gap above them (WebKit's was).
test("a wide picture after a list item's text leaves no gap above the item", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __devFiles: Record<string, string> }).__devFiles = {
      "/work/a.md": "- one\n- two, then a picture![](wide.svg)\n\nAfter\n",
      "/work/wide.svg": "",
    };
  });
  await page.route("http://asset.localhost/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="red"/></svg>',
    }),
  );
  await openApp(page);
  await openPath(page, "/work/a.md");
  const item = page.locator('[data-active-tab="true"] .ProseMirror li').last();
  await expect
    .poll(() =>
      item
        .locator("img")
        .first()
        .evaluate((img) => img.clientHeight),
    )
    .toBeGreaterThan(100);
  const gap = await item.evaluate(
    (li) =>
      li.querySelector("p")!.getBoundingClientRect().top -
      li.getBoundingClientRect().top,
  );
  expect(gap).toBeLessThan(2);
});
