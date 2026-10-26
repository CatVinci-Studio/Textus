import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * The composer's hover tooltips, which replace the native `title` WebKitGTK
 * shows late or not at all. They never take focus from the message field.
 */

const composer = (page: Page) => page.locator(".agent-panel-view textarea");
const tooltip = (page: Page) => page.getByRole("tooltip");
const deepThinking = (page: Page) =>
  page.getByRole("button", { name: "深度思考", exact: true });
const webSearch = (page: Page) =>
  page.getByRole("button", { name: "联网搜索", exact: true });

async function open(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      { ai_can_think_deeper: true };
  });
  await openApp(page, { storage: { "textus-agent-panel-open": "1" } });
  await expect(deepThinking(page)).toBeVisible();
}

test("Deep thinking explains itself on hover, and says when it is on", async ({
  page,
}) => {
  await open(page);
  await expect(deepThinking(page)).not.toHaveAttribute("title");
  await composer(page).focus();

  await deepThinking(page).hover();
  await expect(tooltip(page)).toHaveText(
    "深度思考：开启后 Textus AI 会先想得更久再回答；关闭时按模型默认的思考量",
  );
  // Above the button, which sits at the bottom of the panel.
  const tip = await tooltip(page).boundingBox();
  const button = await deepThinking(page).boundingBox();
  expect(tip!.y + tip!.height).toBeLessThanOrEqual(button!.y);
  // The caret never left the message field.
  await expect(composer(page)).toBeFocused();

  // A press answers the hint: it goes, and the next visit tells the state.
  await deepThinking(page).click();
  await expect(tooltip(page)).toHaveCount(0);
  await page.mouse.move(0, 0);
  await deepThinking(page).hover();
  await expect(tooltip(page)).toHaveText(
    "深度思考：开启后 Textus AI 会先想得更久再回答；关闭时按模型默认的思考量（已开启，再点关闭）",
  );
  await expect(deepThinking(page)).toHaveAccessibleDescription(
    "深度思考：开启后 Textus AI 会先想得更久再回答；关闭时按模型默认的思考量",
  );

  await page.keyboard.press("Escape");
  await expect(tooltip(page)).toHaveCount(0);
});

test("Tab onto a composer button shows its tooltip, Esc hides it", async ({
  page,
}) => {
  await open(page);
  await page.locator(".agent-panel-view .inline-chat-attach").focus();
  await expect(tooltip(page)).toHaveText(/^附加文件：PDF/);
  await page.keyboard.press("Tab");
  await expect(webSearch(page)).toBeFocused();
  await expect(tooltip(page)).toHaveText("联网搜索");
  await page.keyboard.press("Escape");
  await expect(tooltip(page)).toHaveCount(0);
  await expect(webSearch(page)).toBeFocused();
});

test("a mouse passing over the toolbar shows nothing", async ({ page }) => {
  await open(page);
  const box = await webSearch(page).boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  await expect(tooltip(page)).toHaveCount(0);
});
