import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown, mockInvoke } from "./helpers";

const editor = (page: Page) =>
  page.locator('[data-active-tab="true"] .ProseMirror');
async function setup(page: Page) {
  await page.clock.install();
  await openApp(page, {
    settings: { enableMagicDiary: true },
    animations: true,
  });
  await mockInvoke(page, { ai_diary_reply: "我记得。" });
}
async function reachInk(page: Page) {
  const walker = page.locator(".magic-footprint-layer");
  await expect(walker).toHaveAttribute("data-stage", /approach|standing/);
  for (
    let i = 0;
    i < 150 && (await walker.getAttribute("data-stage")) === "approach";
    i++
  ) {
    await page.clock.runFor(650);
  }
  await expect(walker).toHaveAttribute("data-stage", "standing");
  await page.clock.runFor(650);
}
async function send(page: Page, text: string) {
  await pasteMarkdown(page, text);
  await editor(page).press("End");
  await editor(page).press("Enter");
  await reachInk(page);
  await expect(page.locator(".magic-diary-reply-settled")).toBeVisible();
}

test("answer expires ten seconds after writing, returning focus for another turn", async ({
  page,
}) => {
  await setup(page);
  await send(page, "第一句话");
  await page.clock.runFor(9000);
  await expect(page.locator(".magic-diary-reply")).toBeVisible();
  await page.clock.runFor(1600);
  await expect(page.locator(".magic-diary-reply")).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await page.clock.resume();
  await send(page, "第二句话");
  await expect(page.locator(".magic-diary-reply")).toHaveCount(1);
  await expect(page.locator(".magic-diary-archived")).toHaveCount(2);
});

test("up and down browse answers and restore an unfinished draft", async ({
  page,
}) => {
  await setup(page);
  await send(page, "第一句话");
  await editor(page).press("Escape");
  await expect(page.locator(".magic-diary-reply")).toHaveCount(0);
  await pasteMarkdown(page, "还没写完");
  await editor(page).press("ArrowUp");
  await expect(page.locator(".magic-diary-reply")).toHaveText("我记得。");
  await editor(page).press("ArrowDown");
  await expect(page.locator(".magic-diary-reply")).toHaveCount(0);
  await expect(editor(page)).toContainText("还没写完");
});

test("input and a multiline answer remain centered in the writing area", async ({
  page,
}) => {
  await setup(page);
  await pasteMarkdown(page, "今晚想说些什么");
  const center = async () => {
    const pane = await page
      .locator('[data-active-tab="true"] .editor-scroll')
      .boundingBox();
    const block = await editor(page)
      .locator(":scope > p:not(.magic-diary-archived)")
      .last()
      .boundingBox();
    expect(
      Math.abs(block!.y + block!.height / 2 - (pane!.y + pane!.height / 2)),
    ).toBeLessThan(12);
  };
  await center();
  await mockInvoke(page, { ai_diary_reply: "第一行\n第二行\n第三行" });
  await editor(page).press("End");
  await editor(page).press("Enter");
  await reachInk(page);
  await expect(page.locator(".magic-diary-reply-settled")).toBeVisible();
  await center();
  await page.screenshot({ path: test.info().outputPath("centered-reply.png") });
  await page.setViewportSize({ width: 760, height: 900 });
  await center();
});

test("one walker leaves the perimeter for a reply and returns after it fades", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator(".magic-footprint-layer")).toHaveAttribute(
    "data-stage",
    "orbit",
  );
  await send(page, "来聊聊");
  await expect(page.locator(".magic-footprint-layer")).toHaveAttribute(
    "data-stage",
    "standing",
  );
  await page.clock.runFor(10600);
  await expect(page.locator(".magic-footprint-layer")).toHaveAttribute(
    "data-stage",
    "leaving",
  );
  for (
    let i = 0;
    i < 150 &&
    (await page
      .locator(".magic-footprint-layer")
      .getAttribute("data-stage")) === "leaving";
    i++
  ) {
    await page.clock.runFor(650);
  }
  await expect(page.locator(".magic-footprint-layer")).toHaveAttribute(
    "data-stage",
    "orbit",
  );
});

test("cancelling a pending answer restores the input and allows a fresh request", async ({
  page,
}) => {
  await setup(page);
  await pasteMarkdown(page, "第一句");
  await editor(page).press("End");
  await editor(page).press("Enter");
  await editor(page).press("Escape");
  await expect(page.locator(".magic-diary-reply")).toHaveCount(0);
  await expect(editor(page)).toContainText("第一句");
  await editor(page).press("Enter");
  await reachInk(page);
  await expect(page.locator(".magic-diary-reply-settled")).toBeVisible();
});

test("normal editing remains available outside diary mode", async ({
  page,
}) => {
  await openApp(page, { settings: { enableMagicDiary: false } });
  await pasteMarkdown(page, "普通文本");
  await editor(page).press("End");
  await editor(page).press("Enter");
  await expect(editor(page).locator("p")).toHaveCount(2);
  await expect(page.locator(".magic-diary-reply")).toHaveCount(0);
});

test("history keeps chronological order and sends previous exchanges to the model", async ({
  page,
}) => {
  await setup(page);
  await send(page, "第一句");
  await editor(page).press("Escape");
  await mockInvoke(page, { ai_diary_reply: "继续说。" });
  await page.evaluate(() => {
    const bridge = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = bridge.invoke;
    bridge.invoke = (cmd, args) => {
      if (cmd === "ai_diary_reply")
        (window as unknown as { diaryPayload: unknown }).diaryPayload = args;
      return invoke(cmd, args);
    };
  });
  await send(page, "第二句");
  expect(
    await page.evaluate(
      () => (window as unknown as { diaryPayload: unknown }).diaryPayload,
    ),
  ).toMatchObject({
    line: "第二句",
    history: [{ line: "第一句", reply: "我记得。" }],
  });
  // Reading the newest answer should also allow immediate history navigation.
  await editor(page).press("ArrowUp");
  await expect(page.locator(".magic-diary-reply")).toHaveText("我记得。");
  await editor(page).press("ArrowDown");
  await expect(page.locator(".magic-diary-reply")).toHaveText("继续说。");
  await editor(page).press("ArrowDown");
  await editor(page).press("Backspace");
  await expect(page.locator(".magic-diary-archived")).toHaveCount(2);
  await editor(page).press("ArrowUp");
  await expect(page.locator(".magic-diary-reply")).toHaveText("继续说。");
  await editor(page).press("ArrowUp");
  await expect(page.locator(".magic-diary-reply")).toHaveText("我记得。");
  await editor(page).press("ArrowDown");
  await expect(page.locator(".magic-diary-reply")).toHaveText("继续说。");
  await editor(page).press("ArrowDown");
  await expect(page.locator(".magic-diary-reply")).toHaveCount(0);
});

test("a missing provider still produces an answer and Chinese composition does not submit", async ({
  page,
}) => {
  await setup(page);
  await mockInvoke(page, { ai_diary_reply: { __reject: "No provider" } });
  await pasteMarkdown(page, "你好");
  await editor(page).press("End");
  await editor(page).evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        keyCode: 229,
        isComposing: true,
        bubbles: true,
      }),
    );
    el.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "你好" }),
    );
  });
  await page.clock.runFor(100);
  await expect(page.locator(".magic-diary-archived")).toHaveCount(0);
  await editor(page).press("Enter");
  await reachInk(page);
  await expect(page.locator(".magic-diary-reply-settled")).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator(".magic-diary-ink")).not.toBeEmpty();
});

test("undo during absorption never leaves the input locked", async ({
  page,
}) => {
  await setup(page);
  await pasteMarkdown(page, "撤销这一句");
  await editor(page).press("End");
  await editor(page).press("Enter");
  await editor(page).press("ControlOrMeta+z");
  await expect(editor(page)).toHaveAttribute("aria-busy", "false");
  await send(page, "重新开始");
});

test("undoing only submission restores a separately typed prompt", async ({
  page,
}) => {
  await setup(page);
  await pasteMarkdown(page, "保留这句话");
  await page.clock.runFor(750);
  await editor(page).press("End");
  await editor(page).press("Enter");
  await editor(page).press("ControlOrMeta+z");
  await expect(editor(page)).toHaveAttribute("aria-busy", "false");
  await expect(editor(page)).toContainText("保留这句话");
  await editor(page).press("Enter");
  await reachInk(page);
  await expect(page.locator(".magic-diary-reply-settled")).toBeVisible();
});

test("a new tab's submission releases the displaced pending turn", async ({
  page,
}) => {
  await setup(page);
  await pasteMarkdown(page, "第一页的问题");
  await editor(page).press("End");
  await editor(page).press("Enter");
  await page.clock.resume();
  await page.evaluate(() => {
    (
      window as unknown as { __devEmitTauriEvent: (name: string) => void }
    ).__devEmitTauriEvent("menu-new-file");
  });
  await expect(page.locator(".tab-pill")).toHaveCount(2);
  await pasteMarkdown(page, "第二页的问题");
  await editor(page).press("End");
  await editor(page).press("Enter");
  await reachInk(page);
  await expect(
    editor(page).locator(".magic-diary-reply-settled"),
  ).toBeVisible();
  await page.clock.resume();
  await page.locator(".tab-bar > [data-flip-id]").first().click();
  await expect(editor(page)).toHaveAttribute("aria-busy", "false");
  await expect(editor(page)).toContainText("第一页的问题");
  await editor(page).press("Enter");
  await reachInk(page);
  await expect(
    editor(page).locator(".magic-diary-reply-settled"),
  ).toBeVisible();
});

test("a ready model answer waits for the slower walker to arrive", async ({
  page,
}) => {
  await setup(page);
  await pasteMarkdown(page, "等你走过来");
  await editor(page).press("End");
  await editor(page).press("Enter");
  await page.clock.runFor(3000);
  await expect(page.locator(".magic-footprint-layer")).toHaveAttribute(
    "data-stage",
    "approach",
  );
  await expect(page.locator(".magic-diary-reply")).toHaveCount(0);
  await reachInk(page);
  await expect(page.locator(".magic-footprint-layer")).toHaveAttribute(
    "data-stage",
    "standing",
  );
  await expect(page.locator(".magic-diary-reply-settled")).toBeVisible();
});

test("diary ink wraps without creating scroll containers or scrolling the page", async ({
  page,
}) => {
  await setup(page);
  await send(page, "不要滚动");
  for (const selector of [
    ".magic-diary-reply",
    '[data-active-tab="true"] .editor-scroll',
  ]) {
    expect(
      await page
        .locator(selector)
        .evaluate((el) => getComputedStyle(el).overflowY),
    ).not.toMatch(/auto|scroll/);
  }
  const scroll = page.locator('[data-active-tab="true"] .editor-scroll');
  await scroll.evaluate((el) => (el.scrollTop = 100));
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(0);
});

test("a long reply fits a short window at large zoom without clipping or scrolling", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 760, height: 500 });
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--content-zoom", "2"),
  );
  await mockInvoke(page, {
    ai_diary_reply: "先慢慢写，不必急着找到答案。".repeat(15),
  });
  await pasteMarkdown(page, "还有很多话想说");
  await editor(page).press("End");
  await editor(page).press("Enter");
  await reachInk(page);
  await page.clock.runFor(17000);
  await expect(page.locator(".magic-diary-reply-settled")).toBeVisible();
  const reply = await page.locator(".magic-diary-reply").boundingBox();
  const pane = await page
    .locator('[data-active-tab="true"] .editor-scroll')
    .boundingBox();
  expect(reply!.y).toBeGreaterThanOrEqual(pane!.y);
  expect(reply!.y + reply!.height).toBeLessThanOrEqual(pane!.y + pane!.height);
  await page.screenshot({ path: test.info().outputPath("fitted-reply.png") });
});

test("perimeter, approach, and departure keep the same foot spacing", async ({
  page,
}) => {
  await setup(page);
  const checkSteps = async () => {
    const points = [];
    for (let i = 0; i < 4; i++) {
      await page.clock.runFor(650);
      points.push(
        await page
          .locator(".magic-foot")
          .last()
          .evaluate((el) => ({
            x: parseFloat((el as HTMLElement).style.left),
            y: parseFloat((el as HTMLElement).style.top),
          })),
      );
    }
    for (let i = 1; i < points.length; i++) {
      const spacing = Math.hypot(
        points[i].x - points[i - 1].x,
        points[i].y - points[i - 1].y,
      );
      expect(spacing).toBeGreaterThan(20);
      expect(spacing).toBeLessThan(28);
    }
  };
  await checkSteps();
  await pasteMarkdown(page, "慢慢走来");
  await editor(page).press("End");
  await editor(page).press("Enter");
  await checkSteps();
  await reachInk(page);
  await editor(page).press("Escape");
  await checkSteps();
});

test("a random ink wolf meets the walker, triggers a ward, then departs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0.99;
  });
  await setup(page);
  await expect(page.locator(".magic-map-landmark")).toHaveCount(4);
  await page.clock.runFor(40000);
  await expect(page.locator(".magic-map-visitor-beast")).toHaveAttribute(
    "data-phase",
    "greeting",
  );
  await expect(page.locator(".magic-map-shield")).toBeVisible();
  await expect(page.locator(".magic-footprint-layer")).toHaveAttribute(
    "data-stage",
    "encounter",
  );
  await page.screenshot({
    path: test.info().outputPath("wolf-encounter.png"),
    style:
      ".magic-map-visitor { animation:none!important; opacity:1!important } .magic-map-reaction { animation:none!important; opacity:.65!important } .magic-map-ripple { animation:none!important; opacity:.35!important }",
  });
  await page.clock.runFor(7000);
  await expect(page.locator(".magic-map-visitor")).toHaveCount(0);
  await expect(page.locator(".magic-footprint-layer")).toHaveAttribute(
    "data-stage",
    "orbit",
  );
});

test("a diary turn takes priority over a map encounter and clears its effects", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0.99;
  });
  await setup(page);
  await page.clock.runFor(40000);
  await expect(page.locator(".magic-map-shield")).toBeVisible();
  await send(page, "先来和我说话");
  await expect(page.locator(".magic-map-visitor")).toHaveCount(0);
  await expect(page.locator(".magic-map-reaction")).toHaveCount(0);
  await expect(page.locator(".magic-diary-reply-settled")).toBeVisible();
});

test("reduced motion suppresses ambient visitors", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await page.clock.runFor(60000);
  await expect(page.locator(".magic-map-visitor")).toHaveCount(0);
  await expect(page.locator(".magic-footprint-layer")).toBeHidden();
});

test("the walker takes an optional side trip, wakes a building event, then returns to the perimeter", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0.1;
  });
  await setup(page);
  await page.clock.runFor(10000);
  await expect(page.locator(".magic-map-landmark[data-visit]")).toHaveCount(0);
  await page.clock.runFor(11000);
  const walker = page.locator(".magic-footprint-layer");
  await expect(walker).toHaveAttribute("data-stage", "visiting");
  const selected = page.locator(".magic-map-landmark[data-visit]");
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAttribute("data-visit", "approaching");
  for (
    let i = 0;
    i < 150 && (await walker.getAttribute("data-stage")) === "visiting";
    i++
  )
    await page.clock.runFor(650);
  await expect(walker).toHaveAttribute("data-stage", "landmark");
  await expect(selected).toHaveAttribute("data-visit", "active");
  await expect(page.locator(".magic-landmark-event")).toBeVisible();
  await expect(page.locator(".magic-diary-reply")).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("library-visit.png"),
    style:
      ".magic-landmark-event { animation:none!important; opacity:1!important }",
  });
  await page.clock.runFor(4100);
  await expect(walker).toHaveAttribute("data-stage", "returning");
  for (
    let i = 0;
    i < 150 && (await walker.getAttribute("data-stage")) === "returning";
    i++
  )
    await page.clock.runFor(650);
  await expect(walker).toHaveAttribute("data-stage", "orbit");
  await expect(page.locator(".magic-map-landmark[data-visit]")).toHaveCount(0);
});

test("submitting a line interrupts a building visit without triggering a stray reply", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Math.random = () => 0.1;
  });
  await setup(page);
  await page.clock.runFor(21000);
  await expect(page.locator(".magic-map-landmark[data-visit]")).toHaveCount(1);
  await send(page, "先听我说");
  await expect(page.locator(".magic-map-landmark[data-visit]")).toHaveCount(0);
  await expect(page.locator(".magic-landmark-event")).toHaveCount(0);
  await expect(page.locator(".magic-diary-reply")).toHaveCount(1);
});

test("an empty diary always shows a blinking input caret, including while unfocused", async ({
  page,
}) => {
  await setup(page);
  await expect(editor(page)).toBeFocused();
  const caret = page.locator(".magic-diary-input-caret:visible");
  await expect(caret).toHaveCount(1);
  expect(
    await caret.evaluate((el) =>
      el
        .getAnimations()
        .some(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getTiming().iterations === Infinity,
        ),
    ),
  ).toBe(true);
  await editor(page).evaluate((el) => (el as HTMLElement).blur());
  await expect(caret).toBeVisible();
  await pasteMarkdown(page, "还在这里");
  await expect(caret).toBeVisible();
});

test("the waiting caret returns after the answer disappears and clicking paper focuses input", async ({
  page,
}) => {
  await setup(page);
  await send(page, "你好");
  await expect(page.locator(".magic-diary-input-caret:visible")).toHaveCount(0);
  await editor(page).press("Escape");
  await expect(page.locator(".magic-diary-input-caret:visible")).toHaveCount(1);
  await editor(page).evaluate((el) => (el as HTMLElement).blur());
  await page.clock.resume();
  await page
    .locator('[data-active-tab="true"] .editor-content')
    .click({ position: { x: 20, y: 100 } });
  await expect(editor(page)).toBeFocused();
});

test("the book's own story answers and continues without a provider", async ({
  page,
}) => {
  await setup(page);
  await mockInvoke(page, { ai_diary_reply: { __reject: "No provider" } });
  const fragment = async (line: string) => {
    await pasteMarkdown(page, line);
    await editor(page).press("End");
    await editor(page).press("Enter");
    await reachInk(page);
    await page.clock.runFor(10000);
    await expect(page.locator(".magic-diary-reply-settled")).toBeVisible();
  };
  await fragment("你是谁？");
  await expect(page.locator(".magic-diary-ink")).toContainText("Textus");
  await editor(page).press("Escape");
  await fragment("后来呢？");
  await expect(page.locator(".magic-diary-ink")).toContainText("薇拉来过");
  await expect(page.locator(".magic-diary-ink")).toContainText("未竟之城");
});

test("ordinary chat keeps a practical answer with a magical background offline", async ({
  page,
}) => {
  await setup(page);
  await mockInvoke(page, { ai_diary_reply: { __reject: "No provider" } });
  await send(page, "今天好累，想休息");
  await expect(page.locator(".magic-diary-ink")).toContainText("回声钟");
  await expect(page.locator(".magic-diary-ink")).toContainText("放下");
});
