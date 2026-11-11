import { expect, test, type Page } from "@playwright/test";
import { emit, openApp } from "./helpers";

// A tab dragged in from another window: the native side sends where the
// pointer is (drag-hover) and then the tab itself (receive-detached-tab).
// Over the documents it opens an island where it was let go; over the row
// it joins the row.

const doc = (title: string) => ({
  path: null,
  content: `# ${title}\n`,
  savedContent: "",
  title,
});

async function open(page: Page) {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
}

test("let go over the documents' right edge, it opens an island there", async ({
  page,
}) => {
  await open(page);
  const sheet = (await page.locator("section.island").first().boundingBox())!;
  const at = { x: sheet.x + sheet.width - 30, y: sheet.y + sheet.height / 2 };
  await emit(page, "drag-hover", {
    title: "Elsewhere",
    dirty: false,
    ...at,
    row: false,
  });
  await page.waitForTimeout(300);
  await emit(page, "receive-detached-tab", {
    ...doc("Elsewhere"),
    ...at,
    row: false,
  });
  await expect(page.locator(".main-pane > section.island")).toHaveCount(2);
  const rows = page.locator(".island-row");
  await expect(rows.last().locator(".tab-pill")).toHaveCount(1);
  await expect(page.locator(".ProseMirror:visible").last()).toContainText(
    "Elsewhere",
  );
});

test("let go over the row, it joins the row", async ({ page }) => {
  await open(page);
  const pill = (await page.locator(".tab-pill").first().boundingBox())!;
  const at = { x: pill.x + pill.width + 40, y: pill.y + pill.height / 2 };
  await emit(page, "drag-hover", {
    title: "Elsewhere",
    dirty: false,
    ...at,
    row: true,
  });
  await page.waitForTimeout(300);
  await emit(page, "receive-detached-tab", {
    ...doc("Elsewhere"),
    ...at,
    row: true,
  });
  await expect(page.locator(".tab-pill")).toHaveCount(2);
  await expect(page.locator(".main-pane > section.island")).toHaveCount(1);
});

test("in a split, let go over an island's row, it joins that island at that slot", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-split-right");
  const rows = page.locator(".island-row");
  await expect(rows).toHaveCount(2);
  // Before the left island's tab, on its row.
  const pill = (await rows.first().locator(".tab-pill").first().boundingBox())!;
  const at = { x: pill.x + 4, y: pill.y + pill.height / 2 };
  await emit(page, "drag-hover", {
    title: "Elsewhere",
    dirty: false,
    ...at,
    row: true,
  });
  await page.waitForTimeout(300);
  await emit(page, "receive-detached-tab", {
    ...doc("Elsewhere"),
    ...at,
    row: true,
  });
  await expect(rows.first().locator(".tab-pill")).toHaveCount(2);
  await expect(rows.last().locator(".tab-pill")).toHaveCount(1);
  // The slot it was let go at: first, in front, its document showing.
  await expect(rows.first().locator(".tab-pill").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("Elsewhere");
});
