import { expect, test, type Page } from "@playwright/test";
import { emit, openApp, pasteMarkdown } from "./helpers";

// Create › Theme without the AI: a starting theme, its type adjusted beside a
// page that shows it, then installed as a theme and put in use.

async function openWorkshop(page: Page, textusAi: boolean) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page, { settings: { menuBarShown: false, textusAi } });
  await emit(page, "menu-settings");
  await page.locator(".sidebar").getByText("外观").first().click();
  await page.getByText("制作你的主题").first().click();
  await expect(page.locator(".theme-workshop")).toBeVisible();
}

/** Types a number into the workshop's field and settles it. */
async function setNumber(page: Page, name: string, value: string) {
  const field = page.getByRole("textbox", { name, exact: true });
  await field.fill(value);
  await field.press("Enter");
}

const installedCss = (page: Page) =>
  page.evaluate(
    () => document.getElementById("textus-custom-theme")?.textContent ?? "",
  );

test("the workshop makes a theme from size and font, with the AI off", async ({
  page,
}) => {
  await openWorkshop(page, false);
  // Nothing to describe to with the AI off.
  await expect(page.getByText("用 AI 描述")).toHaveCount(0);
  const write = page.frameLocator(".theme-workshop-frame").locator("#write");
  // The page in the reader's language: Chinese here.
  await expect(write.locator("h1")).toHaveText("红楼梦");
  await expect(write.locator("table")).toBeVisible();

  await setNumber(page, "正文字号", "20");
  await expect(write).toHaveCSS("font-size", "20px");

  await page.getByRole("button", { name: "正文字体" }).click();
  const font = page.locator(".quick-pick-item").nth(1);
  const label = (await font.locator(".quick-pick-label").textContent()) ?? "";
  await font.click();
  await expect(page.getByRole("button", { name: "正文字体" })).not.toHaveText(
    "跟随主题",
  );
  const chosen = await page
    .getByRole("button", { name: "正文字体" })
    .textContent();
  expect(label).toContain(chosen ?? "-");
  await expect
    .poll(() => write.evaluate((el) => getComputedStyle(el).fontFamily))
    .toMatch(new RegExp(`^"?${chosen}`));

  await page.locator(".theme-workshop-actions .primary").click();
  const dialog = page.locator(".app-dialog");
  await dialog.locator(".app-dialog-input").fill("大字主题");
  await dialog.locator(".close-prompt-primary").click();
  await expect(page.getByRole("status")).toContainText(
    "「大字主题」已安装并开启",
  );
  // In use: the window's own document takes it.
  await expect(page.locator("html")).toHaveAttribute("data-user-theme", "");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.getElementById("textus-custom-theme")?.textContent ?? "",
      ),
    )
    .toContain("--doc-font-size: 20px");
  const saved = await page.evaluate(
    () => document.getElementById("textus-custom-theme")?.textContent ?? "",
  );
  expect(saved).toContain(`--doc-font: "${chosen}"`);
  // ...and it is listed with the installed themes.
  await emit(page, "menu-settings");
  await page.locator(".sidebar").getByText("外观").first().click();
  await expect(
    page.getByRole("combobox", { name: "编辑器主题" }),
  ).toContainText("大字主题");
});

test("with the AI on, the workshop sits beside describing the theme", async ({
  page,
}) => {
  await openWorkshop(page, true);
  await page.getByRole("tab", { name: "用 AI 描述" }).click();
  await expect(page.locator(".theme-workshop")).toHaveCount(0);
  await expect(page.locator(".create-studio-title")).toBeVisible();
  await page.getByRole("tab", { name: "自己调" }).click();
  await expect(page.locator(".theme-workshop")).toBeVisible();

  // What was made goes into the conversation, to carry on from.
  await setNumber(page, "行高", "2");
  await page.locator(".theme-workshop-actions .primary").click();
  await page.locator(".app-dialog .close-prompt-primary").click();
  await page.getByRole("button", { name: "交给 AI 继续改" }).click();
  await expect(page.locator(".theme-workshop")).toHaveCount(0);
  await expect(page.locator(".inline-chat-input")).toHaveValue(
    /在我的主题「我的 默认」上继续改[\s\S]*--doc-line-height: 2;/,
  );

  // A theme in the AI's answer (the shim echoes the message): its card
  // installs it and opens it in the workshop.
  const composer = page.locator(".inline-chat-input");
  await composer.fill(
    "Red links:\n\n```css\n/* Tiny - x */\n:root { --doc-accent: #b00020; }\n```",
  );
  await composer.press("Enter");
  await page.getByRole("button", { name: "使用此主题" }).click();
  await page.getByRole("button", { name: "在工坊里继续改" }).click();
  await expect(page.locator(".theme-workshop")).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "从这个主题开始" }),
  ).toContainText("Tiny");
});

test("the reader's indent and width stay over a workshop theme's", async ({
  page,
}) => {
  await openWorkshop(page, false);
  await setNumber(page, "首行缩进", "0");
  await setNumber(page, "行宽", "640");
  await page.locator(".theme-workshop-actions .primary").click();
  await page.locator(".app-dialog .close-prompt-primary").click();
  await expect(page.getByRole("status")).toBeVisible();

  await page.locator(".tab-pill").first().click();
  await pasteMarkdown(page, "One.\n\nTwo.\n");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  const paragraph = editor.locator(":scope > p").first();
  await expect(editor).toHaveCSS("max-width", "640px");
  // As in Typora: the theme's width is the text's, the margins round it.
  expect(
    await editor.evaluate((e) => Math.round(e.getBoundingClientRect().width)),
  ).toBe(640);
  await expect(paragraph).toHaveCSS("text-indent", "0px");

  await emit(page, "menu-settings");
  await page.locator(".sidebar").getByText("外观").first().click();
  await page.getByRole("switch", { name: "首行缩进" }).click();
  await page.getByRole("combobox", { name: "正文宽度" }).click();
  await page.getByRole("option", { name: "标准" }).click();
  await page.locator(".tab-pill").first().click();
  await expect(editor).toHaveCSS("max-width", "none");
  await expect
    .poll(() =>
      paragraph.evaluate((e) => parseFloat(getComputedStyle(e).textIndent)),
    )
    .toBeGreaterThan(0);
});

test("palettes colour the document, not the window, and generate as picked", async ({
  page,
}) => {
  await openWorkshop(page, false);
  const chrome = () =>
    page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return ["--ui-bg", "--ui-text", "--ui-muted", "--ui-border", "--ui-hover"]
        .map((name) => style.getPropertyValue(name).trim())
        .join(" ");
    });
  const save = async (name: string) => {
    await page.locator(".theme-workshop-actions button").nth(1).click();
    await page.locator(".app-dialog-input").fill(name);
    await page.locator(".app-dialog .close-prompt-primary").click();
    await expect(page.getByRole("status")).toContainText(name);
  };
  // A theme from the same start without a palette: the window it gives.
  await setNumber(page, "行高", "2");
  await save("Plain");
  const plain = await chrome();

  const write = page.frameLocator(".theme-workshop-frame").locator("#write");
  await page
    .getByRole("radiogroup", { name: "页面配色" })
    .getByRole("radio", { name: "青苔" })
    .click();
  await page
    .getByRole("radiogroup", { name: "代码配色" })
    .getByRole("radio", { name: "海湾" })
    .click();
  // The page shows them at once.
  await expect(write).toHaveCSS("color", "rgb(36, 48, 31)");
  await save("Moss");
  await expect.poll(() => installedCss(page)).toContain("--doc-bg: #f5f7f1");
  expect(await chrome()).toBe(plain);

  // The document takes them.
  await page.locator(".tab-pill").first().click();
  await pasteMarkdown(
    page,
    "Text.\n\n```js\nfunction f() { return 1; }\n```\n",
  );
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).toHaveCSS("color", "rgb(36, 48, 31)");
  await expect(editor.locator(".token.keyword").first()).toHaveCSS(
    "color",
    "rgb(29, 95, 168)",
  );
});

test("an installed theme exports, imports back and reopens in the workshop as left", async ({
  page,
}) => {
  await openWorkshop(page, false);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {};
    w.__devSavePick = "/out/Mine.css";
    w.__devCssPick = "/out/Mine.css";
  });
  await setNumber(page, "行高", "2.2");
  await page
    .getByRole("radiogroup", { name: "页面配色" })
    .getByRole("radio", { name: "暮色" })
    .click();
  await page.locator(".theme-workshop-actions .primary").click();
  await page.locator(".app-dialog-input").fill("Mine");
  await page.locator(".app-dialog .close-prompt-primary").click();
  await expect(page.getByRole("status")).toBeVisible();
  // Made here: saved over, or as a new one.
  await expect(page.getByRole("button", { name: "覆盖保存" })).toBeVisible();

  await emit(page, "menu-settings");
  await page.locator(".sidebar").getByText("外观").first().click();
  const card = page.locator(".theme-gallery-item", { hasText: "Mine" });
  await card.getByRole("button", { name: "更多: Mine" }).click();
  await page.getByRole("menuitem", { name: "导出…" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys((window as unknown as { __devFs: object }).__devFs),
      ),
    )
    .toEqual(["/out/Mine.css", "/out/Mine-dark.css"]);

  await card.getByRole("button", { name: "更多: Mine" }).click();
  await page.getByRole("menuitem", { name: "删除" }).click();
  await page.locator(".app-dialog .close-prompt-primary").click();
  await expect(card).toHaveCount(0);

  await page.getByRole("button", { name: "更多" }).first().click();
  await page.getByRole("menuitem", { name: "导入 CSS…" }).click();
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "在工坊里改" }).click();
  await expect(page.locator(".theme-workshop")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "行高", exact: true }),
  ).toHaveValue("2.2");
  await expect(
    page
      .getByRole("radiogroup", { name: "页面配色" })
      .getByRole("radio", { name: "暮色" }),
  ).toHaveAttribute("aria-checked", "true");
  // Imported, not made here: only saved as a new theme.
  await expect(page.getByRole("button", { name: "覆盖保存" })).toHaveCount(0);
  await expect(page.locator(".theme-workshop-actions .primary")).toHaveText(
    "生成主题",
  );
});

test("in a narrow window the workshop is one column that scrolls to the page", async ({
  page,
}) => {
  await openWorkshop(page, false);
  await page.setViewportSize({ width: 900, height: 600 });
  const preview = page.locator(".theme-workshop-preview");
  const controls = page.locator(".theme-workshop-controls");
  // Under the rows, not squeezed beside them, once the resize is laid out.
  await expect
    .poll(async () => {
      const box = await preview.boundingBox();
      const rows = await controls.boundingBox();
      return box && rows ? box.y - (rows.y + rows.height) : -1;
    })
    .toBeGreaterThanOrEqual(0);
  // ...and tall enough to read.
  expect((await preview.boundingBox())?.height ?? 0).toBeGreaterThan(400);
  // Reached by scrolling the workshop.
  await preview.scrollIntoViewIfNeeded();
  await expect(
    page.frameLocator(".theme-workshop-frame").locator("#write h1"),
  ).toBeInViewport();
  await expect(page.locator(".theme-workshop-actions .primary")).toBeVisible();
});

test("the workshop scrolls as one page, its bar at the tab's edge", async ({
  page,
}) => {
  await openWorkshop(page, false);
  await page.setViewportSize({ width: 1280, height: 600 });
  const tab = page.locator(".create-tab");
  await expect(tab).toHaveClass(/tx-scroll-reveal/);
  // The tab scrolls; the rows don't, on their own.
  const scrolls = (el: Element) => el.scrollHeight > el.clientHeight + 1;
  expect(await tab.evaluate(scrolls)).toBe(true);
  expect(await page.locator(".theme-workshop-controls").evaluate(scrolls)).toBe(
    false,
  );
  // Scrolled to the end, the sample page and the buttons are still in view.
  await tab.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(page.locator(".theme-workshop-preview")).toBeInViewport();
  await expect(
    page.locator(".theme-workshop-actions .primary"),
  ).toBeInViewport();
});
