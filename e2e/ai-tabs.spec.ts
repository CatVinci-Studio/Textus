import { expect, test, type Page } from "@playwright/test";
import { emit, openApp, pasteMarkdown } from "./helpers";

// Textus AI's conversations are tabs: the AI button opens one in an island
// of its own on the right; they drag like any tab; the button collapses
// them only from an island of AI tabs alone.

const tabs = (page: Page) => page.locator(".tab-pill");
const islands = (page: Page) => page.locator(".main-pane > section.island");
const conversation = (page: Page) =>
  page.locator(".ai-tab .agent-panel-mount > *");

async function open(page: Page) {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  await pasteMarkdown(page, "# 第三章\n\n雨下到第三天。");
}

const aiButton = (page: Page) =>
  page.getByRole("button", { name: "Textus AI" }).first();

test("the AI button opens a conversation tab in an island on the right", async ({
  page,
}) => {
  await open(page);
  await aiButton(page).click();
  await expect(tabs(page)).toHaveText(["未命名", "新对话"]);
  await expect(islands(page)).toHaveCount(2);
  await expect(conversation(page)).toHaveCount(1);
  const [doc, ai] = await Promise.all(
    [tabs(page).first(), tabs(page).last()].map((t) => t.boundingBox()),
  );
  expect(ai!.x).toBeGreaterThan(doc!.x + doc!.width);
});

test("a conversation keeps its turns when the document in front is closed and another opened", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  await aiButton(page).click();
  const box = page.locator(".ai-tab textarea").first();
  await box.fill("第三章写了什么？");
  await box.press("Enter");
  const turns = page.locator(".ai-tab .inline-chat-messages");
  const kept = async () => {
    await expect(turns).toContainText("第三章写了什么？");
    await expect(turns).toContainText("Canned dev-shim reply to:");
  };
  await kept();
  await expect(page.locator(".ai-tab .agent-streaming")).toHaveCount(0);
  // The window's own, not the document's: closing the document keeps it.
  const doc = tabs(page).filter({ hasText: "未命名" });
  await doc.hover();
  await doc.locator(".tab-pill-close").click();
  await expect(tabs(page)).toHaveText(["新对话"]);
  await kept();
  await emit(page, "menu-new-file");
  await expect(doc).toHaveCount(1);
  await kept();
});

test("pressed again in front of its own island, it collapses; again, it comes back", async ({
  page,
}) => {
  await open(page);
  await aiButton(page).click();
  await expect(conversation(page)).toHaveCount(1);
  await aiButton(page).click();
  await expect(tabs(page)).toHaveText(["未命名"]);
  await expect(islands(page)).toHaveCount(1);
  // The document is the tab in use again: the keys go to it.
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toBeVisible();
  await aiButton(page).click();
  await expect(tabs(page)).toHaveText(["未命名", "新对话"]);
  await expect(conversation(page)).toHaveCount(1);
});

test("dragged into the document's island, it stays there and the button leaves it", async ({
  page,
}) => {
  await open(page);
  await aiButton(page).click();
  await expect(islands(page)).toHaveCount(2);
  const a = (await tabs(page).last().boundingBox())!;
  const d = (await tabs(page).first().boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x - 100, a.y + 200, { steps: 10 });
  await page.mouse.move(d.x + d.width + 20, d.y + d.height / 2, {
    steps: 20,
  });
  // The room opens before the drop takes it.
  await page.waitForTimeout(500);
  await page.mouse.up();
  await expect(islands(page)).toHaveCount(1);
  await expect(tabs(page)).toHaveText(["未命名", "新对话"]);
  await expect(conversation(page)).toHaveCount(1);
  // In front of an island it shares: the button does nothing.
  await aiButton(page).click();
  await expect(tabs(page)).toHaveText(["未命名", "新对话"]);
});

test("Zen shows the tab in use alone, and the split comes back after", async ({
  page,
}) => {
  await open(page);
  await aiButton(page).click();
  await expect(islands(page)).toHaveCount(2);
  await page.locator(".ProseMirror").first().click();
  await emit(page, "menu-toggle-zen-mode");
  await expect(islands(page)).toHaveCount(1);
  await expect(page.locator(".ai-tab:visible")).toHaveCount(0);
  await emit(page, "menu-toggle-zen-mode");
  await expect(islands(page)).toHaveCount(2);
});

test("the window's other tabs stay with the document when the AI opens", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-open-settings");
  await expect(tabs(page)).toHaveText(["未命名", "设置"]);
  await aiButton(page).click();
  await expect(islands(page)).toHaveCount(2);
  const rows = page.locator(".island-row");
  await expect(rows.first().locator(".tab-pill")).toHaveText([
    "未命名",
    "设置",
  ]);
  await expect(rows.last().locator(".tab-pill")).toHaveText(["新对话"]);
});

test("with Alt held, a tab's drag moves its whole island", async ({ page }) => {
  await open(page);
  await emit(page, "menu-open-settings");
  await aiButton(page).click();
  const rows = page.locator(".island-row");
  await expect(rows).toHaveCount(2);
  const from = (await tabs(page).filter({ hasText: "设置" }).boundingBox())!;
  const sheet = (await page.locator("section.island").last().boundingBox())!;
  await page.keyboard.down("Alt");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 160, { steps: 10 });
  // The right edge of the AI's island: the whole island goes there.
  await page.mouse.move(sheet.x + sheet.width - 8, sheet.y + sheet.height / 2, {
    steps: 20,
  });
  await page.waitForTimeout(500);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(rows.first().locator(".tab-pill")).toHaveText(["新对话"]);
  await expect(rows.last().locator(".tab-pill")).toHaveText(["未命名", "设置"]);
});

test("with only Settings open, the AI grows in at a panel's width and can be used; Settings' island slides, not rebuilt", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, {
    settings: { menuBarShown: false },
    animations: true,
  });
  await emit(page, "menu-open-settings");
  const doc = tabs(page).filter({ hasText: "未命名" });
  await doc.click();
  await doc.hover();
  await doc.locator(".tab-pill-close").click();
  await expect(tabs(page)).toHaveText(["设置"]);
  const settings = page.locator("section.island").first();
  await settings.evaluate((el) => ((el as HTMLElement).dataset.mark = "kept"));
  await aiButton(page).click();
  const sheet = page.locator("section.island").last();
  await expect(page.locator("section.island")).toHaveCount(2);
  await expect(settings).toHaveAttribute("data-mark", "kept");
  // It grows in from the right edge, not shown whole at once.
  const width = () => sheet.evaluate((el) => el.getBoundingClientRect().width);
  const first = await width();
  await page.waitForTimeout(600);
  expect(first).toBeLessThan((await width()) - 50);
  await expect(page.locator(".ai-tab textarea").first()).toBeVisible();
  // Its composer drawn as a hosted one's: a framed box.
  const frame = await page
    .locator(".ai-tab .inline-chat-field")
    .first()
    .evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(frame).toBe("1px");
  const w = (await sheet.boundingBox())!.width;
  expect(w).toBeLessThan(600);
});

test("let go in the middle of the document's island, it joins it; near its edge, it opens beside", async ({
  page,
}) => {
  await open(page);
  await aiButton(page).click();
  await expect(islands(page)).toHaveCount(2);
  const drag = async (fx: number) => {
    const a = (await tabs(page).last().boundingBox())!;
    const sheet = (await page.locator("section.island").first().boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x - 100, a.y + 200, { steps: 10 });
    await page.mouse.move(
      sheet.x + sheet.width * fx,
      sheet.y + sheet.height / 2,
      {
        steps: 20,
      },
    );
    await page.waitForTimeout(500);
    await page.mouse.up();
  };
  await drag(0.5);
  await expect(islands(page)).toHaveCount(1);
  await expect(tabs(page)).toHaveText(["未命名", "新对话"]);
  await drag(0.1);
  await expect(islands(page)).toHaveCount(2);
  await expect(
    page.locator(".island-row").first().locator(".tab-pill"),
  ).toHaveText(["新对话"]);
});

test("a pulled tab's copy gathers from where the tab was, never from far off", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, {
    settings: { menuBarShown: false },
    animations: true,
  });
  await emit(page, "menu-open-settings");
  const pill = (await tabs(page).last().boundingBox())!;
  await page.evaluate(() => {
    const w = window as unknown as { __far: number; __at: [number, number] };
    w.__far = 0;
    w.__at = [0, 0];
    addEventListener("pointermove", (e) => (w.__at = [e.clientX, e.clientY]));
    const tick = () => {
      const ghost = document.querySelector(".drag-ghost");
      if (ghost) {
        const r = ghost.getBoundingClientRect();
        const far = Math.hypot(
          r.left + r.width / 2 - w.__at[0],
          r.top + r.height / 2 - w.__at[1],
        );
        w.__far = Math.max(w.__far, far);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(pill.x + pill.width / 2, pill.y + pill.height / 2);
  await page.mouse.down();
  await page.mouse.move(pill.x + pill.width / 2, pill.y + 200, { steps: 12 });
  await page.waitForTimeout(400);
  const far = await page.evaluate(
    () => (window as unknown as { __far: number }).__far,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  // At most the way from the tab down to the pointer, never more.
  expect(far).toBeLessThan(220);
});

test("the open tab is its island's paper wherever it is in the row", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-open-settings");
  const paper = (i: number) =>
    tabs(page)
      .nth(i)
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  const sheet = await page
    .locator("section.island")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  // Last in the row, then first, with a tab after it.
  expect(await paper(1)).toBe(sheet);
  await tabs(page).first().click();
  await expect(tabs(page).first()).toHaveClass(/tab-pill-active/);
  expect(await paper(0)).toBe(sheet);
});
