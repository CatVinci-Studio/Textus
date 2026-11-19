import { expect, test, type Page } from "@playwright/test";
import { MAC, emit, openApp, pasteMarkdown, settled } from "./helpers";

// Formulas, diagrams, HTML and embedded notes are drawn only within a few
// screens of the view: a document holding hundreds keeps a page the size
// of a few screens.

/** Where each block of the document, and each view in it, sits from the
 *  document's top, and how big it is. */
const layout = (page: Page, mark = false) =>
  page.evaluate((mark) => {
    const root = document.querySelector(".ProseMirror")!;
    const { top, left } = root.getBoundingClientRect();
    const at = (el: Element) => {
      const r = el.getBoundingClientRect();
      return [r.top - top, r.left - left, r.width, r.height].map(
        (n) => Math.round(n * 100) / 100,
      );
    };
    return {
      height: root.getBoundingClientRect().height,
      // The blocks shown; a diagram's source hides behind its drawing.
      blocks: [...root.children]
        .filter((el) => getComputedStyle(el).display !== "none")
        .map(at),
      views: [
        ...root.querySelectorAll(
          ".math-inline-rendered, .math-block-rendered, .mermaid-preview, .raw-html-rendered",
        ),
      ].map((el, i) => {
        // Known again by a mark set the first time: one in a block made a
        // placeholder is gone from the page.
        const view = el as HTMLElement;
        if (mark) view.dataset.seen = String(i);
        return {
          key: view.dataset.seen,
          drawn: !el.hasAttribute("data-draw-pending"),
          at: at(el),
        };
      }),
    };
  }, mark);

test("formulas far from the screen are let go where they were drawn, and drawn again as they come back", async ({
  page,
}) => {
  // Hundreds of formulas drawn and let go: minutes on a slow runner.
  test.setTimeout(120_000);
  // A window tall enough for all of them to be drawn first.
  await page.setViewportSize({ width: 1000, height: 12000 });
  await openApp(page, { settings: { menuBarShown: false } });
  const blocks = Array.from(
    { length: 150 },
    (_, i) =>
      `第 ${i} 段 $x^${i}$ 与 $\\frac{a}{b_{${i}}}$ 在行中\n\n$$\n\\frac{a_{${i}}}{b} + \\sqrt{c}\n$$` +
      (i % 25 === 0
        ? `\n\n长的公式 $${Array.from({ length: 40 }, (_, k) => `a_{${k}}`).join(" + ")}$ 折到下一行` +
          `\n\n<div align="center"><b>${i}</b></div>\n\n\`\`\`mermaid\ngraph LR\n  A${i} --> B${i}\n\`\`\``
        : ""),
  );
  await pasteMarkdown(page, blocks.join("\n\n"));
  const katex = page.locator(".ProseMirror .math-block-rendered .katex");
  const scroller = page.locator(".editor-scroll").first();
  await scroller.evaluate((s) => s.scrollTo(0, 0));
  await expect(katex.first()).toBeVisible();
  // The first diagram drawn in its source's place before anything is measured.
  await expect(
    page.locator(".ProseMirror .mermaid-block svg").first(),
  ).toBeVisible();
  await settled(page);
  const drawn = await layout(page, true);
  expect(drawn.views.every((v) => v.drawn)).toBe(true);
  await page.setViewportSize({ width: 1000, height: 700 });
  // Read to the end: those at the top go, the page doesn't move.
  const height = await scroller.evaluate((s) => s.scrollHeight);
  await scroller.hover();
  for (let y = 0; y <= height; y += 600) {
    // The wheel, as a reader scrolls: WebKit on Linux runs no frame for a
    // script's scroll alone.
    await page.mouse.wheel(0, 600);
    // Real time: a frame or so a step.
    await page.waitForTimeout(20);
  }
  await expect.poll(() => katex.count()).toBeLessThan(100);
  const first = page.locator(".ProseMirror .math-block-rendered").first();
  await expect(first).toHaveAttribute("data-draw-pending", "");
  await settled(page);
  // Each view let go holds the place it was drawn in, and every block
  // stays where it was, to half a pixel, a block made a placeholder too.
  const letGo = await layout(page);
  const moved: string[] = [];
  const near = (a: number[], b: number[]) =>
    a.every((n, i) => Math.abs(n - b[i]!) < 0.5);
  // Where each starts (a placeholder's height holds its margins too).
  drawn.blocks.forEach((at, i) => {
    // An empty one (a formula's hidden source) has no place of its own.
    if (at[3] && !near(at.slice(0, 3), letGo.blocks[i]!))
      moved.push(`block ${i}: ${at} -> ${letGo.blocks[i]}`);
  });
  const after = new Map(
    letGo.views.filter((view) => view.key).map((view) => [view.key, view]),
  );
  drawn.views.forEach((view, i) => {
    const now = after.get(view.key);
    // Where it sits in its line and how wide: how tall its line is, the
    // blocks say (a fraction reaches past the formula's own box).
    if (
      now &&
      view.drawn &&
      !now.drawn &&
      !near([view.at[1]!, view.at[2]!], [now.at[1]!, now.at[2]!])
    )
      moved.push(`view ${i}: ${view.at} -> ${now.at}`);
  });
  // Let go: waiting to be drawn, or gone with a block made a placeholder.
  const stillDrawn = letGo.views.filter((v) => v.drawn).length;
  expect(drawn.views.length - stillDrawn).toBeGreaterThan(20);
  expect(moved.slice(0, 20)).toEqual([]);
  expect(Math.abs(letGo.height - drawn.height)).toBeLessThan(0.5);
  await scroller.evaluate((s) => s.scrollTo(0, 0));
  await expect(first.locator(".katex")).toBeVisible();
});

test("jumped straight to the end, the formulas there are drawn; folded and opened again, they come back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await openApp(page, { settings: { menuBarShown: false } });
  const blocks = Array.from(
    { length: 150 },
    (_, i) => `第 ${i} 段\n\n$$\n\\frac{a_{${i}}}{b} + \\sqrt{c}\n$$`,
  );
  await pasteMarkdown(page, `## 开头\n\n$$\nx^2\n$$\n\n${blocks.join("\n\n")}`);
  const scroller = page.locator(".editor-scroll").first();
  const formulas = page.locator(".ProseMirror .math-block-rendered");
  await scroller.evaluate((s) => s.scrollTo(0, 0));
  await expect(formulas.first().locator(".katex")).toBeVisible();
  // One jump to the far end: what is on screen there is drawn.
  await scroller.evaluate((s) => s.scrollTo(0, s.scrollHeight));
  await expect(formulas.last().locator(".katex")).toBeVisible();
  // Back at the top, the heading's section folded and opened again.
  await scroller.evaluate((s) => s.scrollTo(0, 0));
  await expect(formulas.first().locator(".katex")).toBeVisible();
  await page.locator(".ProseMirror h2").click();
  // The editor has the click's caret before the keys go to it.
  await expect
    .poll(() =>
      page.evaluate(
        () => !!window.getSelection()?.anchorNode?.parentElement?.closest("h2"),
      ),
    )
    .toBe(true);
  await page.keyboard.press(
    MAC ? "Meta+Alt+BracketLeft" : "Control+Shift+BracketLeft",
  );
  await expect(formulas.first()).toBeHidden();
  await page.keyboard.press(
    MAC ? "Meta+Alt+BracketRight" : "Control+Shift+BracketRight",
  );
  await expect(formulas.first().locator(".katex")).toBeVisible();
});

test("jumped to from the outline past many formulas, a heading lands at the top and stays", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await openApp(page, { settings: { menuBarShown: false } });
  const blocks = Array.from(
    { length: 120 },
    (_, i) => `第 ${i} 段\n\n$$\n\\frac{a_{${i}}}{b} + \\sqrt{c}\n$$`,
  );
  const after = Array.from({ length: 40 }, (_, i) => `后文 ${i}`);
  await pasteMarkdown(
    page,
    `${blocks.join("\n\n")}\n\n## 结尾\n\n${after.join("\n\n")}`,
  );
  const scroller = page.locator(".editor-scroll").first();
  await scroller.evaluate((s) => s.scrollTo(0, 0));
  await settled(page);
  // The editor taking the keys doesn't scroll it away (WebKit would, to
  // where it thought the caret was).
  await page.locator('[data-rail-id="outline"]').click();
  await page.locator(".outline-row", { hasText: "结尾" }).click();
  const end = page.locator(".ProseMirror h2", { hasText: "结尾" });
  await expect(end).toBeInViewport();
  await settled(page);
  const box = (await scroller.boundingBox())!;
  const top = (await end.boundingBox())!.y - box.y;
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(box.height / 3);
});

/** A document past the size where its blocks out of sight are
 *  placeholders: sections of long paragraphs, inline formulas in every
 *  third, a display formula every tenth, a diagram every 250th. */
const longDoc = (end: string) =>
  [
    ...Array.from({ length: 1700 }, (_, i) =>
      [
        i % 100 === 0 ? `## 第 ${i / 100} 节` : "",
        `第 ${i} 段 ${"长文写作".repeat(20)}` +
          (i % 3 === 0 ? ` 其中 $x_{${i}}^2$ 与 $\\frac{1}{n}$ 并列` : ""),
        i % 10 === 0 ? `$$\n\\frac{a_{${i}}}{b} + \\sqrt{c}\n$$` : "",
        i % 250 === 0
          ? `\`\`\`mermaid\ngraph LR\n  A${i} --> B${i}\n\`\`\``
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    ),
    end,
  ].join("\n\n");

/** A paragraph drawn above the screen that scrolling up by `by` brings
 *  onto it, found again by its words a few frames on: how far it moved
 *  besides, as blocks around it were drawn. */
const jumpWhile = (page: Page, by: number) =>
  page.evaluate(async (by) => {
    const scroller = document.querySelector(
      '[data-active-tab="true"] .editor-scroll',
    )!;
    const box = scroller.getBoundingClientRect();
    const y = box.top + box.height * 0.75 - by;
    const paragraphs = () => [...scroller.querySelectorAll(".ProseMirror > p")];
    const at = paragraphs().find((p) => {
      const r = p.getBoundingClientRect();
      return r.top <= y && r.bottom >= y;
    });
    const words = at?.textContent!.slice(0, 8);
    const before = at?.getBoundingClientRect().top ?? 0;
    // By what it really scrolled: the position is whole pixels.
    const from = scroller.scrollTop;
    scroller.scrollTop -= by;
    const scrolled = from - scroller.scrollTop;
    for (let i = 0; i < 10; i++)
      await new Promise((done) => requestAnimationFrame(done));
    if (!words) return null;
    const again = paragraphs().find((p) => p.textContent!.startsWith(words));
    return again
      ? again.getBoundingClientRect().top - (before + scrolled)
      : null;
  }, by);

test("a long document read upward through blocks out of sight: what is on screen stays still, and at rest nothing is redrawn", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1000, height: 700 });
  await openApp(page, { settings: { menuBarShown: false } });
  await pasteMarkdown(page, longDoc("末尾"));
  // Away from the editor: a suggestion at the caret would come and go.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  const scroller = page.locator(".editor-scroll").first();
  await expect(
    page.locator(".ProseMirror > .lazy-block").first(),
  ).toBeAttached();
  await scroller.evaluate((s) => s.scrollTo(0, s.scrollHeight));
  await settled(page);
  // KaTeX's fonts in: their loading moves formulas once, not this.
  await page.evaluate(() => document.fonts.ready);
  // Up a screen and a half at a time, faster than blocks are drawn ahead.
  const moves: number[] = [];
  for (let step = 0; step < 12; step++) {
    const moved = await jumpWhile(page, 1000);
    if (moved !== null) moves.push(moved);
  }
  // Most steps land a paragraph to follow (not a formula or a heading).
  expect(moves.length).toBeGreaterThan(6);
  expect(moves.filter((moved) => Math.abs(moved) >= 0.5)).toEqual([]);
  // At rest, nothing drawn or let go, frame after frame, once those far
  // away are let go.
  await settled(page);
  // Real time: they go a moment after the last scroll (SETTLE_MS).
  await page.waitForTimeout(400);
  const changes = await page.evaluate(async () => {
    const seen: string[] = [];
    const watch = new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as Element;
        seen.push(`${r.type} ${r.attributeName ?? ""} on ${el.className}`);
      }
    });
    watch.observe(document.querySelector(".ProseMirror")!, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-draw-pending", "style", "class"],
    });
    for (let i = 0; i < 60; i++)
      await new Promise((done) => requestAnimationFrame(done));
    watch.disconnect();
    return seen;
  });
  expect(changes).toEqual([]);
});

test("in a long document, find lands on a match far below and it stays on screen", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1000, height: 700 });
  await openApp(page, { settings: { menuBarShown: false } });
  await pasteMarkdown(page, longDoc("这里有一根针"));
  await page
    .locator(".editor-scroll")
    .first()
    .evaluate((s) => s.scrollTo(0, 0));
  await settled(page);
  await emit(page, "menu-find-replace");
  await page
    .locator(".find-replace-bar")
    .getByRole("textbox")
    .first()
    .fill("一根针");
  const match = page.locator(".find-match").first();
  await expect(match).toBeInViewport();
  await settled(page);
  await expect(match).toBeInViewport();
});

test("pictures loading above the screen as a document is read upward don't push what is on screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await openApp(page, { settings: { menuBarShown: false } });
  // Loaded only as they come near, and not at once: those above load on
  // the way up, a moment after the page has moved on.
  await page.route("https://pictures.test/**", async (route) => {
    await new Promise((done) => setTimeout(done, 100));
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#ccc"/></svg>',
    });
  });
  const blocks = Array.from(
    { length: 300 },
    (_, i) =>
      `第 ${i} 段 ${"长文写作".repeat(20)}` +
      (i % 15 === 0 ? `\n\n![p${i}](https://pictures.test/${i}.svg)` : ""),
  );
  await pasteMarkdown(page, blocks.join("\n\n"));
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  const scroller = page.locator(".editor-scroll").first();
  await scroller.evaluate((s) => s.scrollTo(0, s.scrollHeight));
  await settled(page);
  const moves: number[] = [];
  for (let step = 0; step < 12; step++) {
    const moved = await jumpWhile(page, 600);
    if (moved !== null) moves.push(moved);
  }
  expect(moves.length).toBeGreaterThan(6);
  expect(moves.filter((moved) => Math.abs(moved) >= 0.5)).toEqual([]);
});
