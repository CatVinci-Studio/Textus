import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

const editor = '[data-active-tab="true"] .ProseMirror';
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function imageAlign(page: import("@playwright/test").Page) {
  await pasteMarkdown(page, `Before\n\n![dot](${PIXEL})\n\nAfter`);
  const paragraph = page.locator(`${editor} p.image-paragraph`);
  await expect(paragraph).toHaveCount(1);
  return paragraph.evaluate((p) => getComputedStyle(p).textAlign);
}

test("an image on its own line is centered by default", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  expect(await imageAlign(page)).toBe("center");
});

test("the setting puts it on the left", async ({ page }) => {
  await openApp(page, { settings: { language: "en", imageAlign: "left" } });
  expect(await imageAlign(page)).toBe("left");
});

test("a row of images lines up whether or not each is a link", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    `[![linked](${PIXEL})](https://example.com)![plain](${PIXEL})`,
  );
  await expect(page.locator(`${editor} p.image-paragraph`)).toHaveCount(1);
  const [linked, plain] = await page
    .locator(`${editor} p.image-paragraph .image-view`)
    .evaluateAll((views) =>
      views.map((view) => view.getBoundingClientRect().bottom),
    );
  expect(linked).toBeCloseTo(plain, 0);
});

test("a badge has no zoom button; a picture keeps it", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  const big =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="teal"/></svg>',
    );
  const badge =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="20"><rect width="90" height="20" fill="green"/></svg>',
    );
  await pasteMarkdown(page, `Badge ![badge](${badge})\n\n![big](${big})`);
  const views = page.locator(`${editor} .image-view`);
  await expect(views).toHaveCount(2);
  await views.first().hover();
  await expect(views.first().locator(".mermaid-zoom")).toBeHidden();
  await views.last().hover();
  await expect(views.last().locator(".mermaid-zoom")).toBeVisible();
});
