import { expect, test, type Page } from "@playwright/test";
import { emit, openApp, pasteMarkdown } from "./helpers";

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

/** A point of the page where the native side reports the pointer: on the
 *  screen, which the window is placed on (not at 0, 0 in WebKit). */
async function onScreen(page: Page, x: number, y: number) {
  const { left, top } = await page.evaluate(() => ({
    left: window.screenX,
    top: window.screenY,
  }));
  return { x: x + left, y: y + top };
}

async function open(page: Page) {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
}

test("let go over the documents' right edge, it opens an island there", async ({
  page,
}) => {
  await open(page);
  const sheet = (await page.locator("section.island").first().boundingBox())!;
  const at = await onScreen(
    page,
    sheet.x + sheet.width - 30,
    sheet.y + sheet.height / 2,
  );
  await emit(page, "drag-hover", {
    title: "Elsewhere",
    dirty: false,
    ...at,
    row: false,
  });
  await page.waitForTimeout(300);
  // Before it lands: its island is only a dashed room, nothing drawn in it.
  const room = page.locator(".main-pane > section.island").last();
  await expect(room).toHaveCSS("background-image", /svg/);
  await expect(room.locator(".ProseMirror")).toBeHidden();
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
  const at = await onScreen(
    page,
    pill.x + pill.width + 40,
    pill.y + pill.height / 2,
  );
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
  const at = await onScreen(page, pill.x + 4, pill.y + pill.height / 2);
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

test("a tab dragged along its row swaps places when let go, and stays with Esc", async ({
  page,
}) => {
  await open(page);
  await pasteMarkdown(page, "# One\n");
  await emit(page, "menu-new-file");
  const pills = page.locator(".tab-pill");
  await expect(pills).toHaveCount(2);
  const ids = () =>
    pills.evaluateAll((els) => els.map((el) => el.getAttribute("data-tab")));
  const before = await ids();
  const drag = async (escape: boolean) => {
    const a = (await pills.nth(0).boundingBox())!;
    const b = (await pills.nth(1).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.8, a.y + a.height / 2, {
      steps: 8,
    });
    if (escape) await page.keyboard.press("Escape");
    await page.mouse.up();
  };
  await drag(true);
  await expect.poll(ids).toEqual(before);
  await drag(false);
  await expect.poll(ids).toEqual([before[1], before[0]]);
});
