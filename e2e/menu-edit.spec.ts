import { expect, test, type Page } from "@playwright/test";
import { MAC, emit, openApp, pasteMarkdown, settled } from "./helpers";
import { openPath } from "./plugin-helpers";
import { STORY, streamRevise } from "./revise-mock";

// On a Mac, ⌘Z, ⇧⌘Z and ⌘A reach the app as the native Edit menu's events
// (menu.rs MAC_EDIT_ITEMS): these send those same events, so the islands
// route them to the document in use - the second island's too.

const docs = (page: Page) => page.locator(".ProseMirror:visible");
const text = (page: Page, i: number) =>
  docs(page)
    .nth(i)
    .evaluate((e) => (e as HTMLElement).innerText.trim());

test("the Edit menu's Undo, Redo and Select All act on the document in use", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  await docs(page).first().click();
  await page.keyboard.type("alpha");
  await expect.poll(() => text(page, 0)).toBe("alpha");
  await emit(page, "menu-undo");
  await expect.poll(() => text(page, 0)).toBe("");
  await emit(page, "menu-redo");
  await expect.poll(() => text(page, 0)).toBe("alpha");

  // Split: the second island's document is the one in use.
  await emit(page, "menu-split-right");
  await expect(docs(page)).toHaveCount(2);
  await docs(page).nth(1).click();
  await page.keyboard.type("beta");
  // Its key takes that island's document alone...
  await page.keyboard.press("ControlOrMeta+a");
  await expect
    .poll(() => page.evaluate(() => String(getSelection()).trim()))
    .toBe("beta");
  // ...as the menu's item does.
  await page.keyboard.press("ArrowRight");
  await emit(page, "menu-select-all");
  await expect
    // WebKit's selection text ends with the block's line break.
    .poll(() => page.evaluate(() => String(getSelection()).trim()))
    .toBe("beta");
  // WebKit's highlight painted by the app over that document alone, gone
  // once the caret moves; Chromium draws its own.
  const painted = () =>
    page.evaluate(() =>
      [...(CSS.highlights.get("select-all") ?? [])].map((r) =>
        String(r).trim(),
      ),
    );
  expect(await painted()).toEqual(browserName === "webkit" ? ["beta"] : []);
  await page.keyboard.press("ArrowRight");
  await expect.poll(painted).toEqual([]);
  await emit(page, "menu-select-all");
  await emit(page, "menu-undo");
  await expect.poll(() => text(page, 1)).toBe("");
  // The first island's document kept its own.
  expect(await text(page, 0)).toBe("alpha");
});

test("Find and Replace work in source mode, on the source in use", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  await docs(page).first().click();
  await page.keyboard.type("cat dog cat");
  await emit(page, "menu-toggle-source-mode");
  const source = page.locator(".source-view .cm-content");
  await expect(source).toContainText("cat dog cat");
  await source.click();
  await emit(page, "menu-find-replace");
  const bar = page.locator(".find-replace-bar");
  await expect(bar).toBeVisible();
  await bar.getByRole("textbox").first().fill("cat");
  await expect(page.locator(".source-view .find-match")).toHaveCount(2);
  await emit(page, "menu-replace");
  await bar.getByRole("textbox").nth(1).fill("cow");
  await bar.getByRole("button", { name: /全部替换|Replace All/ }).click();
  await expect(source).toContainText("cow dog cow");
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);

  // Back in the editor, the source's change is one step to undo, and what
  // was typed before it is still there to undo after it.
  await emit(page, "menu-toggle-source-mode");
  await expect.poll(() => text(page, 0)).toBe("cow dog cow");
  await docs(page).first().click();
  await emit(page, "menu-undo");
  await expect.poll(() => text(page, 0)).toBe("cat dog cat");
  await emit(page, "menu-undo");
  await expect.poll(() => text(page, 0)).toBe("");
});

test("a source view let go for memory comes back with its undo, caret and place", async ({
  page,
}) => {
  const lines = Array.from({ length: 120 }, (_, i) => `line ${i}`);
  await page.addInitScript((text) => {
    (window as unknown as Record<string, unknown>).__devFs = {
      "/work/a.md": text,
      "/work/b.md": "# B\n",
    };
  }, lines.join("\n\n"));
  await page.setViewportSize({ width: 1200, height: 600 });
  await openApp(page, { settings: { menuBarShown: false } });
  await openPath(page, "/work/b.md");
  await openPath(page, "/work/a.md");
  await emit(page, "menu-toggle-source-mode");
  const source = page.locator(".cm-content:visible");
  await source.getByText("line 2", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" typed");
  const scroller = page.locator(".cm-scroller:visible");
  // The last key's own scroll to the caret lands on CodeMirror's next
  // frame: only then the reader's, and the view has heard it.
  await settled(page);
  await scroller.evaluate((el) => (el.scrollTop = 900));
  await settled(page);
  expect(await scroller.evaluate((el) => Math.round(el.scrollTop))).toBe(900);
  // Into split view and back: each rebuilt source keeps its place and the
  // keys, the caret where it was.
  for (const toggle of ["menu-toggle-split-view", "menu-toggle-source-mode"]) {
    await emit(page, toggle);
    await expect(source).toBeFocused();
    await expect
      .poll(() => scroller.evaluate((el) => Math.round(el.scrollTop)))
      .toBeGreaterThan(850);
  }
  await page.keyboard.type("+");
  await expect(source).toContainText("line 2 typed+");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(source).not.toContainText("+");
  // The undo's own scroll to the caret first, then the reader's.
  await settled(page);
  await scroller.evaluate((el) => (el.scrollTop = 900));
  await settled(page);
  expect(await scroller.evaluate((el) => Math.round(el.scrollTop))).toBe(900);
  // Short of memory with b's source on screen: a's, out of sight, goes.
  await page.locator(".tab-pill", { hasText: "b.md" }).click();
  await expect(source).toContainText("# B");
  await emit(page, "memory-level", { totalMb: 16384, pressure: 2 });
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  await page.locator(".tab-pill", { hasText: "a.md" }).click();
  await expect(source).toContainText("line 2 typed");
  await expect
    .poll(() => scroller.evaluate((el) => Math.round(el.scrollTop)))
    .toBeGreaterThan(850);
  await expect(source).toBeFocused();
  await page.keyboard.type("!");
  await expect(source).toContainText("line 2 typed!");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(source).not.toContainText("typed");
});

test("a find bar left open comes back with its tab, the page where it was read", async ({
  page,
}) => {
  const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`);
  await page.addInitScript(
    (text) => {
      (window as unknown as Record<string, unknown>).__devFs = {
        "/work/a.md": text,
        "/work/b.md": "# B\n",
      };
    },
    [...lines, "the needle"].join("\n\n"),
  );
  await page.setViewportSize({ width: 1200, height: 600 });
  await openApp(page, { settings: { menuBarShown: false } });
  await openPath(page, "/work/b.md");
  await openPath(page, "/work/a.md");
  await docs(page).first().locator("p").first().click();
  await emit(page, "menu-find-replace");
  const bar = page.locator(".find-replace-bar");
  await bar.getByRole("textbox").first().fill("needle");
  await expect(page.locator(".find-match")).toHaveCount(1);
  // Read on elsewhere, the bar still open.
  const scroller = page.locator(".editor-scroll").first();
  await scroller.evaluate((el) => (el.scrollTop = 600));
  await settled(page);
  const read = await scroller.evaluate((el) => el.scrollTop);

  await page.locator(".tab-pill", { hasText: "b.md" }).click();
  await expect(bar).toHaveCount(0);
  await page.locator(".tab-pill", { hasText: "a.md" }).click();
  await expect(bar.getByRole("textbox").first()).toHaveValue("needle");
  await expect(page.locator(".find-match")).toHaveCount(1);
  await settled(page);
  expect(
    Math.abs((await scroller.evaluate((el) => el.scrollTop)) - read),
  ).toBeLessThan(2);
});

test("a find match is brought to the page's middle, the caret followed, and the find bar stays over the document", async ({
  page,
}) => {
  const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`);
  await page.addInitScript(
    (text) => {
      (window as unknown as Record<string, unknown>).__devFs = {
        "/work/a.md": text,
      };
    },
    [...lines, "the needle", ...lines].join("\n\n"),
  );
  await page.setViewportSize({ width: 1200, height: 600 });
  await openApp(page, { settings: { menuBarShown: false } });
  await openPath(page, "/work/a.md");
  const scroller = page.locator(".editor-scroll").first();
  await docs(page).first().locator("p").first().click();
  await emit(page, "menu-find-replace");
  const bar = page.locator(".find-replace-bar");
  await bar.getByRole("textbox").first().fill("needle");
  const offCentre = () =>
    scroller.evaluate((el) => {
      const match = document.querySelector(".find-match")!;
      const m = match.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return Math.abs(m.top + m.height / 2 - (box.top + el.clientHeight / 2));
    });
  await expect.poll(offCentre).toBeLessThan(30);
  // The bar stays where it is however the page scrolls.
  const before = await bar.boundingBox();
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
    el.scrollTop = el.scrollHeight;
  });
  await expect(bar).toBeInViewport();
  expect((await bar.boundingBox())?.y).toBe(before?.y);
  // The caret walked past the page's foot: the page follows it there.
  await page.keyboard.press("Escape");
  await docs(page).first().locator("p").first().click();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowDown");
  const caretShown = () =>
    scroller.evaluate((el) => {
      const r = getSelection()!.getRangeAt(0).getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return r.top >= box.top && r.bottom <= box.top + el.clientHeight;
    });
  await expect.poll(caretShown).toBe(true);
});

test("in source mode the format keys and the Format menu write Markdown", async ({
  page,
}) => {
  await openApp(page, { settings: { menuBarShown: false } });
  await docs(page).first().click();
  await page.keyboard.type("word");
  await emit(page, "menu-toggle-source-mode");
  const source = page.locator(".source-view .cm-content");
  await expect(source).toContainText("word");
  await source.click();
  await page.keyboard.press(MAC ? "Meta+a" : "Control+a");
  await page.keyboard.press(MAC ? "Meta+b" : "Control+b");
  await expect(source).toHaveText("**word**");
  await emit(page, "menu-insert-block", "h2");
  await expect(source).toHaveText("## **word**");
  await page.keyboard.press(MAC ? "Meta+a" : "Control+a");
  await emit(page, "menu-toggle-mark", "highlight");
  await expect(source).toHaveText("==## **word**==");
});

test("a ⌘ or Ctrl click in the text places the caret, never selects the block", async ({
  page,
}) => {
  await openApp(page);
  await pasteMarkdown(page, "> **W1:** quoted words here\n\nafter\n");
  const quoted = docs(page).first().locator("blockquote p");
  await quoted.click({ modifiers: [MAC ? "Meta" : "Control"] });
  await settled(page);
  await expect(page.locator(".ProseMirror-selectednode")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => !!getSelection()?.anchorNode?.parentElement?.closest("blockquote"),
    ),
  ).toBe(true);
});

test("a heading key reaching the page mid-pinyin (Windows) waits for the text and doubles nothing", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Windows draws in Chromium (WebView2)");
  await openApp(page, { settings: { menuBarShown: false } });
  const doc = docs(page).first();
  await doc.click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.insertText", { text: "你" });
  await cdp.send("Input.imeSetComposition", {
    text: "hi",
    selectionStart: 2,
    selectionEnd: 2,
  });
  // As the input method hands it on: a plain key, no isComposing.
  await page.evaluate((mac) => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "3",
        code: "Digit3",
        ctrlKey: !mac,
        metaKey: mac,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, MAC);
  await cdp.send("Input.insertText", { text: "hi" });
  await cdp.send("Input.insertText", { text: "哎" });
  await expect(doc.locator("h3")).toHaveText(/你hi哎$/);
  await expect(doc).not.toContainText("hihi");
});

test.describe("the app-drawn menu (Windows, Linux)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
      Object.defineProperty(navigator, "userAgent", {
        get: () => "Mozilla/5.0 (Win32) AppleWebKit/537.36 Chrome/157.0",
      });
    });
    await page.setViewportSize({ width: 1200, height: 760 });
  });

  const menus = (page: Page) => page.getByRole("menu");
  // A row by its label (its shortcut follows it): an action or an on/off.
  const row = (page: Page, name: string) =>
    page
      .locator('[role="menuitem"], [role="menuitemcheckbox"]')
      .filter({ hasText: new RegExp(`^${name}`) });

  test("the bar's lists are walked with ← and →, and Edit › Undo acts on the source in use", async ({
    page,
  }) => {
    await openApp(page, { settings: { menuBarShown: true, language: "en" } });
    await docs(page).first().click();
    await page.keyboard.type("alpha");
    await emit(page, "menu-toggle-source-mode");
    const source = page.locator(".source-view .cm-content");
    await expect(source).toContainText("alpha");
    await source.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" beta");
    await expect(source).toContainText("alpha beta");
    const bar = page.getByRole("menubar");
    await bar.getByRole("menuitem", { name: "Edit" }).click();
    await expect(row(page, "Undo")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(bar.getByRole("menuitem", { name: "Format" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, "Undo")).toBeVisible();
    await row(page, "Undo").click();
    await expect(menus(page)).toHaveCount(0);
    await expect(source).not.toContainText("beta");
    await expect(source).toContainText("alpha");
  });

  test("the window's menu opens a section beside it, and that section's submenu beside that", async ({
    page,
  }) => {
    await openApp(page, { settings: { menuBarShown: false, language: "en" } });
    await page.getByRole("button", { name: "Menu" }).click();
    await row(page, "View").hover();
    await expect(row(page, "Zen Mode")).toBeVisible();
    await row(page, "Editing view").hover();
    await expect(menus(page)).toHaveCount(3);
    const [first, second, third] = await Promise.all(
      [0, 1, 2].map((i) => menus(page).nth(i).boundingBox()),
    );
    expect(second!.x).toBeGreaterThanOrEqual(first!.x + first!.width);
    expect(third!.x).toBeGreaterThanOrEqual(second!.x + second!.width);
    await page.keyboard.press("Escape");
    await expect(menus(page)).toHaveCount(0);
  });
});

test.describe("the phone's menu", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    viewport: { width: 402, height: 874 },
    hasTouch: true,
    isMobile: true,
  });

  test("opens a submenu in place under its row", async ({ page }) => {
    await openApp(page, { settings: { language: "en" } });
    await page.getByRole("button", { name: "Menu" }).first().tap();
    const group = page
      .locator('[role="menuitem"][aria-haspopup="menu"]')
      .first();
    await group.tap();
    await expect(group).toHaveAttribute("aria-expanded", "true");
    // In place: its rows inside the one panel, none beside it.
    await expect(page.locator('[role="menu"] [role="menu"]')).toHaveCount(1);
    await expect(page.locator('[role="menu"]')).toHaveCount(2);
    await page.screenshot({ path: "test-results/phone-menu.png" });
  });
});

test("a look at the source and back keeps the document's undo and its caret", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__devFs = {
      "/work/a.md": "# A\n\nThe first line.\n",
    };
  });
  await openApp(page);
  await openPath(page, "/work/a.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  const line = editor.locator("p");
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ONE");
  // Past the editor's undo grouping (500 ms): the two words undo apart.
  await page.waitForTimeout(700);
  await page.keyboard.type(" TWO");
  await expect(line).toHaveText("The first line. ONE TWO");
  await emit(page, "menu-toggle-source-mode");
  await expect(
    page.locator('[data-active-tab="true"] .cm-content'),
  ).toContainText("ONE TWO");
  await emit(page, "menu-toggle-source-mode");
  await expect(line).toHaveText("The first line. ONE TWO");
  await settled(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(line).toHaveText("The first line. ONE");
  await page.keyboard.type("!");
  await expect(line).toHaveText("The first line. ONE!");
});

test("Find Next from the menu reaches its match while the AI writes, and the page stays there", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "original" },
  });
  const filler = Array.from({ length: 80 }, (_, i) => `Filler line ${i}.`);
  await pasteMarkdown(
    page,
    [STORY, ...filler, "The needle is here."].join("\n\n"),
  );
  await emit(page, "menu-toggle-agent-panel");
  await streamRevise(
    page,
    [
      {
        id: "s1",
        args: {
          action: "replace",
          anchor: "搬到窗边",
          text: "移至窗边，又寻来一盏台灯照着，慢慢地拆",
        },
      },
    ],
    { chunk: 2, every: 40, hold: "慢慢" },
  );
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Classical Chinese, please");
  await composer.press("Enter");
  await expect(page.locator(".pending-reading").first()).toBeAttached();
  await docs(page).first().locator("p", { hasText: "Filler line 0." }).click();
  await emit(page, "menu-find-replace");
  await page.keyboard.type("needle");
  // Past the reader's last key: the jump is the menu's alone.
  await page.waitForTimeout(1000);
  await emit(page, "menu-find-next");
  const needle = docs(page).first().locator("p", { hasText: "needle" });
  await expect(needle).toBeInViewport();
  await settled(page);
  await expect(needle).toBeInViewport();
});
