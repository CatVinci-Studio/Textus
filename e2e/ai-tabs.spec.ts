import { expect, test, type Page } from "@playwright/test";
import { emit, openApp, pasteMarkdown } from "./helpers";

// Textus AI's conversations are tabs: the AI button opens one in an island
// of its own on the right; they drag like any tab; the button collapses
// them only from an island of AI tabs alone.

const tabs = (page: Page) => page.locator(".tab-pill");
const islands = (page: Page) => page.locator(".main-pane > .split-pane");
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

test("pressed again in front of its own island, it collapses; again, it comes back", async ({
  page,
}) => {
  await open(page);
  await aiButton(page).click();
  await expect(conversation(page)).toHaveCount(1);
  await aiButton(page).click();
  await expect(tabs(page)).toHaveText(["未命名"]);
  await expect(islands(page)).toHaveCount(0);
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
  await expect(islands(page)).toHaveCount(0);
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
  await expect(islands(page)).toHaveCount(0);
  await expect(page.locator(".ai-tab:visible")).toHaveCount(0);
  await emit(page, "menu-toggle-zen-mode");
  await expect(islands(page)).toHaveCount(2);
});
