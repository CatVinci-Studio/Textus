import { expect, test } from "@playwright/test";
import { PHONE, openPhone, pasteMarkdown } from "./helpers";

// The iPhone layout, checked in Chromium with touch and a phone-sized
// viewport.
test.use(PHONE);

test("the phone menu opens the sidebar as a drawer over the page", async ({
  page,
}) => {
  await openPhone(page);
  await page.locator(".window-menu-button").tap();
  // A flat list - no File/Edit/View flyouts on a phone - led by Documents.
  await expect(page.getByRole("menuitem").first()).toHaveText("Documents");
  const sidebarItem = page.getByRole("menuitemcheckbox", { name: "Sidebar" });
  await expect(sidebarItem).toHaveAttribute("aria-checked", "false");
  await sidebarItem.tap();

  const sidebar = page.locator(".sidebar");
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  // Over the editor, not beside it: the page keeps the full width.
  const pane = await page.locator(".main-pane").boundingBox();
  expect(pane?.x).toBe(0);
  expect(pane?.width).toBe(430);

  // The screen's edge strips are the page as the scrim dims it, light and dark.
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const [strip, dimmed] = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const pixel = (...colours: string[]) => {
        for (const colour of colours) {
          ctx.fillStyle = colour;
          ctx.fillRect(0, 0, 1, 1);
        }
        return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      };
      const page = getComputedStyle(document.documentElement)
        .getPropertyValue("--ui-bg")
        .trim();
      const scrim = getComputedStyle(
        document.querySelector(".sidebar-scrim")!,
      ).backgroundColor;
      return [
        pixel(getComputedStyle(document.body).backgroundColor),
        pixel(page, scrim),
      ];
    });
    strip.forEach((value, i) =>
      expect(Math.abs(value - dimmed[i])).toBeLessThanOrEqual(2),
    );
  }

  // A tap beside the drawer closes it.
  await page.locator(".sidebar-scrim").tap({ position: { x: 400, y: 500 } });
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
});

test("the phone menu is short; the view modes are switched in Settings", async ({
  page,
}) => {
  await openPhone(page);
  await page.locator(".window-menu-button").tap();
  await expect(page.locator(".app-menu-item")).toHaveText([
    "Documents",
    "New File",
    "Open…",
    "Save",
    "Share…",
    "Find & Replace…",
    "Sidebar",
    "Textus AI",
    "Plugins",
    "Settings…",
  ]);
  await page.getByRole("menuitem", { name: "Settings…" }).tap();
  await page.getByRole("button", { name: "Editor & Appearance" }).tap();
  // Source mode is the window's, not a setting: the switch follows it.
  const source = page.getByRole("checkbox", { name: "Source Mode" });
  await expect(source).not.toBeChecked();
  await source.tap();
  await expect(source).toBeChecked();
  await expect(
    page.locator(".source-textarea, .cm-editor, textarea").first(),
  ).toBeAttached();
});

test("opening Textus AI while typing puts the keyboard away", async ({
  page,
}) => {
  await openPhone(page);
  await page.locator('[data-active-tab="true"] .milkdown p').first().click();
  await page.locator(".window-bar-toggle").tap();
  await expect(page.locator(".agent-panel .inline-chat-input")).toBeVisible();
  // Neither the document nor the sheet's input holds the focus, so the
  // keyboard goes down once rather than down and up again.
  expect(
    await page.evaluate(() => {
      const el = document.activeElement;
      return !el || el === document.body
        ? "none"
        : (el as HTMLElement).className;
    }),
  ).toBe("none");
});

test("Textus AI is a bottom sheet that leaves the document in view", async ({
  page,
}) => {
  await openPhone(page);
  await page.locator(".window-bar-toggle").tap();
  const half = await page.locator(".agent-panel").boundingBox();
  expect(half).toMatchObject({ x: 0, width: 430 });
  // Docked to the bottom, about half the screen.
  expect(Math.round(half!.y + half!.height)).toBe(932);
  expect(half!.height).toBeLessThan(932 * 0.6);

  // The handle pulls it up to full height and back.
  await page.locator(".agent-panel-grip").tap();
  await expect
    .poll(
      async () => (await page.locator(".agent-panel").boundingBox())!.height,
    )
    .toBeGreaterThan(932 * 0.9);
  await page.locator(".agent-panel-grip").tap();
  await expect
    .poll(
      async () => (await page.locator(".agent-panel").boundingBox())!.height,
    )
    .toBeLessThan(932 * 0.6);

  // The title row's toggle still closes it.
  await page.locator(".window-bar-toggle").tap();
  await expect(page.locator(".agent-panel")).toHaveCount(0);
});

test("with the keyboard up the AI sheet keeps its handle, and drops what no longer fits whole", async ({
  page,
}) => {
  await openPhone(page);
  await page.locator(".window-bar-toggle").tap();
  await expect(page.locator(".agent-panel-empty-mark")).toBeVisible();
  // The keyboard shortens the web view to about this on a small phone.
  await page.setViewportSize({ width: 430, height: 440 });
  const sheet = await page.locator(".agent-panel").boundingBox();
  expect(Math.round(sheet!.y)).toBe(Math.round(440 * 0.45));
  // The hint stays whole; the spark gave its room up for it.
  await expect(page.locator(".agent-panel-empty-mark")).toBeHidden();
  const empty = (await page.locator(".agent-panel-empty").boundingBox())!;
  const hint = (await page.locator(".agent-panel-empty-text").boundingBox())!;
  expect(hint.y).toBeGreaterThanOrEqual(empty.y);
  expect(hint.y + hint.height).toBeLessThanOrEqual(empty.y + empty.height);

  // The / list fits under the handle instead of running up over it.
  await page.locator(".agent-panel .inline-chat-input").fill("/");
  const picker = page.locator(".agent-panel .composer-picker");
  await expect(picker).toBeVisible();
  const grip = (await page.locator(".agent-panel-grip").boundingBox())!;
  const list = (await picker.boundingBox())!;
  expect(list.y).toBeGreaterThanOrEqual(grip.y + grip.height);
  await expect(page.locator(".agent-panel-empty-text")).toBeHidden();
});

test("Documents opens as its own page and closes again", async ({ page }) => {
  await openPhone(page);
  await page.locator(".window-menu-button").tap();
  await page.getByRole("menuitem", { name: "Documents" }).tap();
  const list = page.getByRole("dialog", { name: "Documents" });
  await expect(list).toBeVisible();
  await list.getByRole("button", { name: "Close" }).tap();
  await expect(list).toHaveCount(0);
});

test("the keyboard toolbar formats without leaving the document, and leaves copy and paste to the system's menu", async ({
  page,
}) => {
  await openPhone(page);
  await pasteMarkdown(page, "plain words");
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  const para = page.locator('[data-active-tab="true"] .milkdown p').first();
  await para.click();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Copy" })).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "Paste" })).toHaveCount(0);
  // A selection inside the paragraph, as the iPhone's handles make one.
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await toolbar.getByRole("button", { name: "Bold" }).tap();
  await expect(para.locator("strong")).toHaveText("plain words");
  // A second tap makes it plain again; italic works the same way.
  await toolbar.getByRole("button", { name: "Bold" }).tap();
  await expect(para.locator("strong")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Italic" }).tap();
  await expect(para.locator("em")).toHaveText("plain words");
  // Still editing: the toolbar didn't take the focus.
  await expect(toolbar).toBeVisible();
});

test("a tap on the suggestion accepts it", async ({ page }) => {
  await openPhone(page);
  await pasteMarkdown(page, "The plan");
  await page.locator(".milkdown p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" works");
  const ghost = page.locator(".ghost-text");
  await expect(ghost).toHaveAttribute(
    "data-suggestion",
    " and this ghost text is a canned dev-shim suggestion.",
  );
  await ghost.tap();
  await expect(page.locator(".milkdown p").first()).toHaveText(
    "The plan works and this ghost text is a canned dev-shim suggestion.",
  );
});

test("a dragged AI sheet settles without replaying its entrance", async ({
  page,
}) => {
  await openPhone(page, { animations: true });
  await page.locator(".window-bar-toggle").tap();
  const sheet = page.locator(".agent-panel");
  await expect(sheet).toBeVisible();
  // Up to full height with the handle, and let it land.
  await page.locator(".agent-panel-grip").tap();
  await expect
    .poll(async () => (await sheet.boundingBox())!.height)
    .toBeGreaterThan(932 * 0.9);
  await expect(sheet).toHaveAttribute("data-settled", "");
  // Back at its stop, no animation starts over.
  expect(
    await sheet.evaluate((el) => ({
      name: getComputedStyle(el).animationName,
      running: el.getAnimations().length,
    })),
  ).toEqual({ name: "none", running: 0 });
  // Closing still plays its way out.
  await page.locator(".window-bar-toggle").tap();
  await expect(sheet).toHaveAttribute("data-state", "closing");
  expect(
    await sheet.evaluate((el) => getComputedStyle(el).animationName),
  ).not.toBe("none");
});

test("the line being typed stays above the keyboard toolbar", async ({
  page,
}) => {
  await openPhone(page);
  await pasteMarkdown(
    page,
    Array.from({ length: 60 }, (_, i) => `Paragraph ${i} with words.`).join(
      "\n\n",
    ),
  );
  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  await scroller.evaluate((el) => (el.scrollTop = 0));
  // A tap low on the screen, then the keyboard comes up: the web view
  // shortens, which a smaller viewport stands in for.
  await page.touchscreen.tap(100, 800);
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await expect(toolbar).toBeVisible();
  await page.setViewportSize({ width: 430, height: 440 });
  const caretAndBars = () =>
    page.evaluate(() => ({
      caret: getSelection()!.getRangeAt(0).getBoundingClientRect().bottom,
      scroller: document
        .querySelector('[data-active-tab="true"] .editor-scroll')!
        .getBoundingClientRect().bottom,
      toolbar: document
        .querySelector(".keyboard-toolbar")!
        .getBoundingClientRect().top,
    }));
  // The scroller ends at the strip, and the caret is brought up into it.
  await expect
    .poll(async () => {
      const m = await caretAndBars();
      return m.caret <= m.toolbar && m.scroller <= m.toolbar + 1;
    })
    .toBe(true);
  // Return keeps the new line above the strip as well.
  for (let i = 0; i < 4; i++) await page.keyboard.press("Enter");
  const m = await caretAndBars();
  expect(m.caret).toBeLessThanOrEqual(m.toolbar);
});

test("with the keyboard up, the AI sheet rises once it has gone", async ({
  page,
}) => {
  await openPhone(page);
  await page.locator('[data-active-tab="true"] .milkdown p').first().click();
  await page.setViewportSize({ width: 430, height: 440 });
  await page.waitForTimeout(100);
  await page.locator(".window-bar-toggle").tap();
  // Not yet: the web view is still short.
  await page.waitForTimeout(100);
  await expect(page.locator(".agent-panel")).toHaveCount(0);
  // The keyboard goes; the sheet comes, laid out at the full height.
  await page.setViewportSize({ width: 430, height: 932 });
  await expect(page.locator(".agent-panel")).toBeVisible();
  const box = (await page.locator(".agent-panel").boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(932);
});

test("Settings fills the phone's screen, its edge strips take its colour in light and dark, and Done closes it", async ({
  page,
}) => {
  await openPhone(page);
  await page.locator(".window-menu-button").tap();
  await page.getByRole("menuitem", { name: "Settings…" }).tap();
  const panel = page.getByRole("dialog", { name: "Settings" });
  expect(await panel.boundingBox()).toMatchObject({
    x: 0,
    y: 0,
    width: 430,
    height: 932,
  });
  // A list of the categories; a phone has no Shortcuts.
  await expect(page.getByRole("button", { name: "General" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Shortcuts" })).toHaveCount(0);
  // No group stands empty for what a phone doesn't have.
  await expect(panel.locator(".settings-group-body:empty")).toHaveCount(0);
  // The screen's edge strips take Settings' colour, a different one in dark.
  const strips: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .poll(async () => {
        const [body, settings] = await page.evaluate(() => [
          getComputedStyle(document.body).backgroundColor,
          getComputedStyle(document.querySelector(".settings-panel")!)
            .backgroundColor,
        ]);
        return body === settings ? body : null;
      })
      .not.toBeNull();
    strips.push(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    );
  }
  expect(strips[0]).not.toBe(strips[1]);
  await page.getByRole("button", { name: "Done" }).tap();
  await expect(panel).toHaveCount(0);
});

test("document thumbnails are the page's colour in dark mode", async ({
  page,
}) => {
  await openPhone(page);
  await page.emulateMedia({ colorScheme: "dark" });
  const [sheet, text] = await page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "document-page";
    el.innerHTML = '<div class="document-page-text">Text</div>';
    document.body.appendChild(el);
    return [
      getComputedStyle(el).backgroundColor,
      getComputedStyle(el.firstElementChild!).color,
    ];
  });
  expect(sheet).not.toBe("rgb(255, 255, 255)");
  expect(text).not.toBe(sheet);
});

test("opening the sidebar closes the find bar, without bringing the keyboard up", async ({
  page,
}) => {
  await openPhone(page);
  await pasteMarkdown(page, "plain words");
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("textus:toggle-find-replace")),
  );
  const bar = page.locator(".find-replace-bar");
  await expect(bar).toBeVisible();
  await page.locator(".window-menu-button").tap();
  await page.getByRole("menuitemcheckbox", { name: "Sidebar" }).tap();
  await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-collapsed/);
  await expect(bar).toHaveCount(0);
  // The document didn't take the focus back (that would raise the keyboard).
  const editorFocused = await page.evaluate(
    () => !!document.activeElement?.closest(".ProseMirror"),
  );
  expect(editorFocused).toBe(false);
});
