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
  await expect(tabs(page)).toHaveText(["未命名", "设置：通用"]);
  await aiButton(page).click();
  await expect(islands(page)).toHaveCount(2);
  const rows = page.locator(".island-row");
  await expect(rows.first().locator(".tab-pill")).toHaveText([
    "未命名",
    "设置：通用",
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
  await expect(rows.last().locator(".tab-pill")).toHaveText(["未命名", "设置：通用"]);

  // And back, the document's island to the left of the AI's: each first
  // open tab at its island's edge still joins its sheet's square corner.
  await tabs(page).filter({ hasText: "未命名" }).click();
  const back = (await tabs(page).filter({ hasText: "未命名" }).boundingBox())!;
  const left = (await page.locator("section.island").first().boundingBox())!;
  await page.keyboard.down("Alt");
  await page.mouse.move(back.x + back.width / 2, back.y + back.height / 2);
  await page.mouse.down();
  await page.mouse.move(back.x - 40, back.y + 160, { steps: 10 });
  await page.mouse.move(left.x + 8, left.y + left.height / 2, { steps: 20 });
  await page.waitForTimeout(500);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(rows.first().locator(".tab-pill")).toHaveText([
    "未命名",
    "设置：通用",
  ]);
  await page.waitForTimeout(600);
  const corners = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".island-row")].map((row) => {
      const bar = row.querySelector(".tab-bar");
      const first = bar?.querySelector(
        ":scope > .tab-strip > .tab-pill:not(.tab-pill-preview)",
      );
      const sheet = document.querySelector(
        `section.island[data-pane-id="${row.dataset.paneId}"]`,
      );
      return {
        joins:
          row.hasAttribute("data-at-corner") &&
          !!first?.classList.contains("tab-pill-active"),
        joined: !!sheet?.hasAttribute("data-corner-joined"),
      };
    }),
  );
  for (const { joins, joined } of corners) expect(joined).toBe(joins);
  expect(corners.some((c) => c.joins)).toBe(true);
});

test("with only Settings open, the AI opens beside it and can be used; Settings' island is kept, not rebuilt", async ({
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
  await expect(tabs(page)).toHaveText(["设置：通用"]);
  const settings = page.locator("section.island").first();
  await settings.evaluate((el) => ((el as HTMLElement).dataset.mark = "kept"));
  await aiButton(page).click();
  await expect(page.locator("section.island")).toHaveCount(2);
  await expect(settings).toHaveAttribute("data-mark", "kept");
  await expect(page.locator(".ai-tab textarea").first()).toBeVisible();
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
  // Near its top the room for a new island opens above; held over that
  // room it stays, and once the pointer leaves it upwards the island comes
  // back, the pointer over its row: let go there, the tab stays in it.
  {
    const a = (await tabs(page).last().boundingBox())!;
    const sheet = (await page.locator("section.island").first().boundingBox())!;
    const row = (await page.locator(".island-row").first().boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x - 100, a.y + 200, { steps: 10 });
    await page.mouse.move(
      sheet.x + sheet.width / 2,
      sheet.y + sheet.height * 0.02,
      {
        steps: 20,
      },
    );
    await page.waitForTimeout(500);
    await expect(page.locator("section.island")).toHaveCount(2);
    const room = (await page.locator("section.island").first().boundingBox())!;
    await page.mouse.move(sheet.x + sheet.width / 2, room.y + room.height / 2, {
      steps: 10,
    });
    await page.waitForTimeout(500);
    await expect(page.locator("section.island")).toHaveCount(2);
    await page.mouse.move(sheet.x + sheet.width / 3, row.y + row.height / 2, {
      steps: 10,
    });
    await page.waitForTimeout(500);
    await expect(page.locator("section.island")).toHaveCount(1);
    await page.mouse.up();
    await expect(islands(page)).toHaveCount(1);
  }
  await drag(0.04);
  await expect(islands(page)).toHaveCount(2);
  await expect(
    page.locator(".island-row").first().locator(".tab-pill"),
  ).toHaveText(["新对话"]);
});

test("in a window already split, the AI opens as a column of its own at the right of all of it", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-split-down");
  await expect(islands(page)).toHaveCount(2);
  await aiButton(page).click();
  await expect(islands(page)).toHaveCount(3);
  const ai = (await page.locator(".ai-tab").first().boundingBox())!;
  const docs = await page
    .locator("section.island")
    .evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).map((r) => [r.top, r.right]),
    );
  // Full height beside both stacked islands, right of each.
  const sheets = page.locator("section.island");
  const aiSheet = (await sheets.last().boundingBox())!;
  expect(aiSheet.height).toBeGreaterThan(500);
  for (const [, right] of docs.slice(0, 2)) expect(right).toBeLessThan(ai.x);
});
