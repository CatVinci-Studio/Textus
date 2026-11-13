import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

const doc = (page: Page) => page.locator(".ProseMirror:visible").first();
const bar = (page: Page) => page.getByRole("toolbar");

async function typeAndSelectLast(page: Page, text: string, chars: number) {
  await doc(page).click();
  // ProseMirror re-applies its own selection a timer after gaining focus:
  // a later timer runs after it, so keys pressed then are not undone.
  await page.evaluate(() => new Promise((done) => setTimeout(done, 30)));
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  // Selected by keys: the browser's selection runs ahead of the editor's.
  for (let i = 0; i < chars; i++) await page.keyboard.press("Shift+ArrowLeft");
}

test("the format bar's styles wrap what is selected", async ({ page }) => {
  await openApp(page);
  for (const [name, tag] of [
    ["加粗", "strong"],
    ["斜体", "em"],
    ["删除线", "del"],
    ["高亮", "mark"],
  ] as const) {
    await typeAndSelectLast(page, "alpha beta gamma", 5);
    await bar(page).getByRole("button", { name, exact: true }).click();
    await expect(doc(page).locator(tag)).toHaveText("gamma");
  }
});

test("the format bar's heading button picks a level", async ({ page }) => {
  await openApp(page);
  await typeAndSelectLast(page, "a title", 5);
  const heading = bar(page).getByRole("button", { name: "标题", exact: true });
  await heading.click();
  await page.getByRole("menuitemradio", { name: "标题 3" }).click();
  await expect(doc(page).locator("h3")).toContainText("a title");

  await heading.click();
  await expect(
    page.getByRole("menuitemradio", { name: "标题 3" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "正文" }).click();
  await expect(doc(page).locator("h3")).toHaveCount(0);
  await expect(doc(page).locator("p")).toHaveText("a title");
});

test("brought back to the top, the document's first block shows below the format bar", async ({
  page,
}) => {
  await openApp(page);
  const body = Array.from({ length: 60 }, (_, i) => `paragraph ${i}`);
  await doc(page).click();
  await page.keyboard.type(["first block", ...body].join("\n"), { delay: 0 });
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await page.keyboard.press("ControlOrMeta+ArrowUp");
  const top = await doc(page).locator("> *").first().boundingBox();
  const barBox = await bar(page).boundingBox();
  expect(top!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height);
});
