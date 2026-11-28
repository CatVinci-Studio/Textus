import { expect, test, type Locator, type Page } from "@playwright/test";
import { MAC, emit, openApp, settled } from "./helpers";

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
  // A highlight keeps the text's colour, not the browser's black for <mark>.
  const colour = (sel: string) =>
    doc(page)
      .locator(sel)
      .last()
      .evaluate((el) => getComputedStyle(el).color);
  expect(await colour("mark")).toBe(await colour("p"));
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

test("a menu button opens on the mouse's press; let go over a row picks it, in place picks nothing", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await typeAndSelectLast(page, "a title", 5);
  const heading = bar(page).getByRole("button", {
    name: "Heading",
    exact: true,
  });
  const menu = page.locator("[data-floating-menu]");
  const centre = async (target: Locator) => {
    const box = (await target.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const at = await centre(heading);
  await page.mouse.move(at.x, at.y);
  // Open before the button comes up; let go in place, it stays open and
  // chooses nothing.
  await page.mouse.down();
  await expect(menu).toHaveCount(1);
  await expect(heading).toHaveAttribute("aria-expanded", "true");
  await page.mouse.up();
  await expect(menu).toHaveCount(1);
  await expect(doc(page).locator("h3")).toHaveCount(0);
  // Pressed again while open: closed, and the click of that press does not
  // open it anew.
  await page.mouse.down();
  await page.mouse.up();
  await expect(menu).toHaveCount(0);
  // Held, moved onto a row and let go: that row is chosen, the menu closes,
  // and the keys are back in the document.
  await page.mouse.down();
  await expect(menu).toHaveCount(1);
  const row = await centre(
    page.getByRole("menuitemradio", { name: "Heading 3" }),
  );
  await page.mouse.move(row.x, row.y, { steps: 6 });
  await page.mouse.up();
  await expect(doc(page).locator("h3")).toContainText("a title");
  await expect(menu).toHaveCount(0);
  await expect(doc(page)).toBeFocused();
  // Neither the right button nor a Ctrl press opens it on the press.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: "right" });
  await expect(menu).toHaveCount(0);
  await page.mouse.up({ button: "right" });
  await page.keyboard.down("Control");
  await page.mouse.down();
  await expect(menu).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up("Control");
});

test("a format bar button's tooltip shows its key as a keycap", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await typeAndSelectLast(page, "alpha beta", 4);
  await bar(page).getByRole("button", { name: "Bold", exact: true }).hover();
  const keycap = page.getByRole("tooltip").locator(".tx-kbd");
  await expect(keycap).toHaveCount(1);
  await expect(keycap).toHaveText(MAC ? "⌘B" : "Ctrl+B");
});

test("brought back to the top, the document's first block shows below the format bar", async ({
  page,
}) => {
  await openApp(page);
  const body = Array.from({ length: 60 }, (_, i) => `paragraph ${i}`);
  await doc(page).click();
  await page.keyboard.type(["first block", ...body].join("\n"), { delay: 0 });
  // The document's end and start: ⌘↓ ⌘↑ on a Mac, Ctrl+End Ctrl+Home elsewhere.
  const mac = process.platform === "darwin";
  await page.keyboard.press(mac ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.press(mac ? "Meta+ArrowUp" : "Control+Home");
  const barBox = await bar(page).boundingBox();
  // The scroll back settles over a few frames.
  await expect
    .poll(async () => (await doc(page).locator("> *").first().boundingBox())!.y)
    .toBeGreaterThanOrEqual(barBox!.y + barBox!.height);

  // Its scrollbar too: the scroller starts where the bar ends.
  const scroller = await page
    .locator(".split-pane:has(> .format-bar) .editor-scroll")
    .boundingBox();
  expect(scroller!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height);

  // A short new document, the wheel turned: nothing to scroll it under.
  await emit(page, "menu-new-file");
  await doc(page).click();
  await page.keyboard.type("one line");
  await page.mouse.wheel(0, 200);
  await settled(page);
  expect(
    (await doc(page).locator("> *").first().boundingBox())!.y,
  ).toBeGreaterThanOrEqual(barBox!.y + barBox!.height);
  // In typewriter mode too, which centres the caret's line.
  await emit(page, "menu-toggle-typewriter-mode");
  await page.keyboard.type(" and more");
  await settled(page);
  expect(
    (await doc(page).locator("> *").first().boundingBox())!.y,
  ).toBeGreaterThanOrEqual(barBox!.y + barBox!.height);
});

test("View › Format Bar puts the bar on a side of the sheet, the text beside it, or hides it", async ({
  page,
}) => {
  await openApp(page);
  await doc(page).click();
  await page.keyboard.type("words");
  const box = async (sel: string) =>
    (await page.locator(sel).first().boundingBox())!;
  for (const side of ["left", "right"] as const) {
    await emit(page, `menu-format-bar-${side}`);
    await expect(bar(page)).toHaveAttribute("aria-orientation", "vertical");
    const b = await box(".format-bar");
    const pane = await box(".split-pane:has(> .format-bar)");
    const text = await box(".ProseMirror:visible");
    expect(b.height).toBeGreaterThan(b.width * 4);
    if (side === "left") {
      expect(Math.abs(b.x - pane.x)).toBeLessThan(2);
      expect(text.x).toBeGreaterThanOrEqual(b.x + b.width);
    } else {
      expect(Math.abs(b.x + b.width - (pane.x + pane.width))).toBeLessThan(2);
      expect(text.x + text.width).toBeLessThanOrEqual(b.x);
    }
    // Every button still reachable: shown, or folded behind "⋯".
    await expect(bar(page).getByRole("button", { name: "加粗" })).toBeVisible();
  }
  await emit(page, "menu-format-bar-hidden");
  await expect(bar(page)).toHaveCount(0);
  await emit(page, "menu-format-bar-top");
  await expect(bar(page)).not.toHaveAttribute("aria-orientation", "vertical");
});
