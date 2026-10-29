import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";
import { openPath, openWithPlugins, pluginsAtStart } from "./plugin-helpers";

/**
 * Split panes: two documents at once, through the View menu, shortcuts, the
 * divider and its menu, and a tab's right-click menu.
 */

const panes = ".main-pane-split > .split-pane";
const pane = (which: "first" | "second" | "third") =>
  `.split-pane[data-pane="${which}"]`;

/** A View menu item, as the native menu sends it. */
async function emit(page: Page, name: string) {
  await page.evaluate(
    (name) =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent(name),
    name,
  );
}

/** An item of the divider's right-click menu. */
async function dividerMenu(page: Page, item: string) {
  await page
    .getByRole("separator", { name: "Divider between the documents" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: item }).click();
}

/** Two tabs: one.md, and a new one with "Two" in front. */
async function openTwo(page: Page) {
  await openWithPlugins(page, {
    plugins: {},
    folder: { "/notes/one.md": "# One\n\nThe first.\n" },
  });
  await openPath(page, "/notes/one.md");
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText(
    "One",
  );
  await emit(page, "menu-new-file");
  await expect(page.locator('.tab-bar [role="tab"]')).toHaveCount(2);
  await pasteMarkdown(page, "# Two\n\nThe second.");
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText(
    "Two",
  );
}

test("Split Right shows the document beside another, and a click brings either to the front", async ({
  page,
}) => {
  await openTwo(page);
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  // Its shortcut.
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+Alt+s");
    await expect(page.locator(panes)).toHaveCount(2, { timeout: 500 });
  }).toPass();
  // The one in front stays where it is; the other tab shows beside it.
  await expect(page.locator(`${pane("first")} h1`)).toContainText("Two");
  await expect(page.locator(`${pane("second")} h1`)).toContainText("One");
  const [a, b] = await Promise.all(
    ["first", "second"].map((w) =>
      page.locator(pane(w as "first")).boundingBox(),
    ),
  );
  expect(b!.x).toBeGreaterThan(a!.x + a!.width - 2);
  expect(Math.abs(a!.width - b!.width)).toBeLessThan(4);

  // A click in the other pane brings its tab to the front.
  await page.locator(`${pane("second")} p`).click();
  await expect(page.locator(pane("second"))).toHaveAttribute(
    "data-active-tab",
    "true",
  );
  await page.keyboard.type(" Typed.");
  await expect(page.locator(`${pane("second")} p`)).toContainText("Typed.");
  await expect(page.locator(`${pane("first")} p`)).not.toContainText("Typed.");

  // Close Split: one document, the one in front.
  await emit(page, "menu-close-split");
  await expect(page.locator(panes)).toHaveCount(0);
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText(
    "One",
  );
});

test("Split Down puts one above the other, and the line between them shares the space", async ({
  page,
}) => {
  await openTwo(page);
  await emit(page, "menu-split-down");
  await expect(page.locator(panes)).toHaveCount(2);
  const first = (await page.locator(pane("first")).boundingBox())!;
  const second = (await page.locator(pane("second")).boundingBox())!;
  expect(second.y).toBeGreaterThan(first.y + first.height - 2);

  const line = page.getByRole("separator", {
    name: "Divider between the documents",
  });
  const box = (await line.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, first.y + first.height * 0.5, {
    steps: 4,
  });
  await page.mouse.up();
  const smaller = (await page.locator(pane("first")).boundingBox())!;
  expect(smaller.height).toBeLessThan(first.height * 0.75);
  // A double click halves it again.
  await line.dblclick();
  await expect
    .poll(async () => (await page.locator(pane("first")).boundingBox())!.height)
    .toBeGreaterThan(first.height - 4);
});

test("a new tab opens in the pane in use; closing a pane's last tab ends the split", async ({
  page,
}) => {
  await openTwo(page);
  await page.locator('.tab-bar [role="tab"]').first().click();
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText(
    "One",
  );
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  // Its shortcut.
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+Alt+s");
    await expect(page.locator(panes)).toHaveCount(2, { timeout: 500 });
  }).toPass();
  await expect(page.locator(`${pane("first")} h1`)).toContainText("One");
  // A third tab joins the front pane's own tab bar.
  await emit(page, "menu-new-file");
  await expect(page.locator(panes)).toHaveCount(2);
  await expect(page.locator(`${pane("second")} h1`)).toContainText("Two");
  await expect(page.locator(pane("first"))).toHaveAttribute(
    "data-active-tab",
    "true",
  );
  const bars = page.locator(".main-pane-split > .tab-bar");
  await expect(bars).toHaveCount(2);
  await expect(bars.first().locator('[role="tab"]')).toHaveCount(2);
  await expect(bars.last().locator('[role="tab"]')).toHaveCount(1);
  // Closing it: the pane shows its other tab again.
  await page.keyboard.press("ControlOrMeta+w");
  await expect(page.locator(panes)).toHaveCount(2);
  await expect(page.locator(`${pane("first")} h1`)).toContainText("One");
  // Closing the pane's last tab: one document again.
  await page.locator(`${pane("first")} .ProseMirror`).click();
  await page.keyboard.press("ControlOrMeta+w");
  await expect(page.locator(panes)).toHaveCount(0);
});

test("a tab dragged onto the other pane moves into its tab bar", async ({
  page,
}) => {
  await openTwo(page);
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+Alt+s");
    await expect(page.locator(panes)).toHaveCount(2, { timeout: 500 });
  }).toPass();
  await emit(page, "menu-new-file");
  const bars = page.locator(".main-pane-split > .tab-bar");
  await expect(bars.first().locator('[role="tab"]')).toHaveCount(2);
  await pasteMarkdown(page, "# Three");
  const three = bars.first().locator('[role="tab"][aria-selected="true"]');
  await expect(three).toHaveCount(1);
  const from = (await three.boundingBox())!;
  const to = (await page.locator(pane("second")).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + 120, { steps: 5 });
  // In its middle: the light takes the whole pane, as the drop does.
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  const hint = (await page.locator(".split-drop-hint").boundingBox())!;
  expect(Math.round(hint.height)).toBe(Math.round(to.height));
  await page.mouse.up();
  await expect(bars.last().locator('[role="tab"]')).toHaveCount(2);
  await expect(bars.first().locator('[role="tab"]')).toHaveCount(1);
  await expect(page.locator(pane("second"))).toContainText("Three");
  await expect(page.locator(pane("first"))).toContainText("Two");
});

/** Split with Three in front of the first pane, beside Two. */
async function splitThree(page: Page) {
  await openTwo(page);
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+Alt+s");
    await expect(page.locator(panes)).toHaveCount(2, { timeout: 500 });
  }).toPass();
  await emit(page, "menu-new-file");
  // The new tab in front first, or the paste goes into Two.
  await expect(
    page.locator(".main-pane-split > .tab-bar").first().locator('[role="tab"]'),
  ).toHaveCount(2);
  await pasteMarkdown(page, "# Three");
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText(
    "Three",
  );
}

/** Each pane's tab titles: its bar's, in order. */
async function barTitles(page: Page) {
  const bars = page.locator(".main-pane-split > .tab-bar");
  return [
    await bars.first().locator('[role="tab"]').allTextContents(),
    await bars.last().locator('[role="tab"]').allTextContents(),
  ];
}

for (const way of ["along the bars", "down and across"])
  test(`a tab dragged ${way} onto the other pane's bar joins it where let go`, async ({
    page,
  }) => {
    await splitThree(page);
    const bars = page.locator(".main-pane-split > .tab-bar");
    const three = bars.first().locator('[role="tab"][aria-selected="true"]');
    const from = (await three.boundingBox())!;
    const before = (await bars.last().locator('[role="tab"]').boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    if (way === "down and across")
      await page.mouse.move(from.x + from.width / 2, from.y + 120, {
        steps: 5,
      });
    // Just before the other pane's one tab.
    await page.mouse.move(before.x + 4, before.y + before.height / 2, {
      steps: 12,
    });
    if (way === "down and across") {
      // The pane the tab will join lights up, not its tab bar.
      const hint = (await page.locator(".split-drop-hint").boundingBox())!;
      const body = (await page.locator(pane("second")).boundingBox())!;
      expect(Math.round(hint.y)).toBe(Math.round(body.y));
      expect(Math.round(hint.height)).toBe(Math.round(body.height));
    }
    await page.mouse.up();
    await expect(bars.last().locator('[role="tab"]')).toHaveCount(2);
    await expect(bars.last().locator('[role="tab"]').first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(pane("second"))).toContainText("Three");
    await expect(page.locator(".tab-pull-ghost")).toHaveCount(0);
  });

test("a pulled tab whose release the page never heard is let go at the next move", async ({
  page,
}) => {
  await splitThree(page);
  const bars = page.locator(".main-pane-split > .tab-bar");
  const three = bars.first().locator('[role="tab"][aria-selected="true"]');
  const from = (await three.boundingBox())!;
  const to = (await bars.last().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + 120, { steps: 5 });
  await page.mouse.move(to.x + to.width - 30, to.y + to.height / 2, {
    steps: 8,
  });
  await expect(page.locator(".tab-pull-ghost")).toHaveCount(1);
  // The release lost on its way, as WebView2 can lose it.
  await page.evaluate(() =>
    document.addEventListener("pointerup", (e) => e.stopPropagation(), {
      capture: true,
      once: true,
    }),
  );
  await page.mouse.up();
  await page.mouse.move(to.x + to.width - 32, to.y + to.height / 2);
  await expect(page.locator(".tab-pull-ghost")).toHaveCount(0);
  expect((await barTitles(page)).map((titles) => titles.length)).toEqual([
    1, 2,
  ]);
});

test("a tab dragged onto another pane's edge opens in a new pane on that side", async ({
  page,
}) => {
  await splitThree(page);
  const bars = page.locator(".main-pane-split > .tab-bar");
  const three = bars.first().locator('[role="tab"][aria-selected="true"]');
  const from = (await three.boundingBox())!;
  const to = (await page.locator(pane("second")).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + 120, { steps: 5 });
  // Near the second pane's bottom edge, short of the window's: its lower
  // half lights.
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 70, {
    steps: 8,
  });
  const hint = (await page.locator(".split-drop-hint").boundingBox())!;
  expect(Math.round(hint.height)).toBe(Math.round(to.height / 2));
  await page.mouse.up();
  await expect(page.locator(panes)).toHaveCount(3);
  await expect(page.locator(pane("third"))).toContainText("Three");
  const second = (await page.locator(pane("second")).boundingBox())!;
  const third = (await page.locator(pane("third")).boundingBox())!;
  // Below the second, the same width; the first stays the full height.
  expect(Math.round(third.x)).toBe(Math.round(second.x));
  expect(third.y).toBeGreaterThan(second.y + second.height - 1);
  const first = (await page.locator(pane("first")).boundingBox())!;
  expect(first.y + first.height).toBeGreaterThan(third.y);
});

test("a tab dragged to the split's outer edge opens beside all its panes, the full height", async ({
  page,
}) => {
  await openTwo(page);
  await emit(page, "menu-split-down");
  await expect(page.locator(panes)).toHaveCount(2);
  await emit(page, "menu-new-file");
  await pasteMarkdown(page, "# Three");
  // The pane with both tabs gives up the one in front.
  const bar = page
    .locator(".main-pane-split > .tab-bar")
    .filter({ has: page.locator('[role="tab"]').nth(1) });
  await expect(bar).toHaveCount(1);
  const from = (await bar
    .locator('[role="tab"][aria-selected="true"]')
    .boundingBox())!;
  const top = (await page.locator(pane("first")).boundingBox())!;
  const bottom = (await page.locator(pane("second")).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + 120, { steps: 5 });
  // At the right edge, halfway down the top pane: the window's right half
  // lights, top to bottom.
  const edge = top.x + top.width - 10;
  await page.mouse.move(edge, top.y + top.height / 2, { steps: 8 });
  const hint = (await page.locator(".split-drop-hint").boundingBox())!;
  expect(Math.round(hint.y)).toBe(Math.round(top.y));
  expect(Math.round(hint.y + hint.height)).toBe(
    Math.round(bottom.y + bottom.height),
  );
  await page.mouse.up();
  await expect(page.locator(panes)).toHaveCount(3);
  const right = (await page.locator(pane("third")).boundingBox())!;
  const left = (await page.locator(pane("first")).boundingBox())!;
  expect(right.x).toBeGreaterThan(left.x + left.width - 1);
  expect(Math.round(right.y + right.height)).toBe(
    Math.round(bottom.y + bottom.height),
  );
  await expect(page.locator(pane("third"))).toContainText("Three");
});

test("Split Down in a split splits the pane in use again, and its divider resizes those two", async ({
  page,
}) => {
  await splitThree(page);
  // Three in front of the first pane, Two beside it in the same pane.
  await page.locator(pane("first")).click();
  await emit(page, "menu-split-down");
  await expect(page.locator(panes)).toHaveCount(3);
  const dividers = page.getByRole("separator", {
    name: "Divider between the documents",
  });
  await expect(dividers).toHaveCount(2);
  const lower = page.locator(pane("second"));
  const before = (await lower.boundingBox())!;
  const line = page.locator('.split-divider[aria-orientation="horizontal"]');
  const box = (await line.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 80, { steps: 5 });
  await page.mouse.up();
  const after = (await lower.boundingBox())!;
  expect(after.height).toBeGreaterThan(before.height + 40);
  // The third pane, beside them, didn't change.
  const right = (await page.locator(pane("third")).boundingBox())!;
  expect(Math.round(right.y)).toBeLessThan(Math.round(before.y));
});

test("with one tab, Split Right opens a blank one beside it", async ({
  page,
}) => {
  await openWithPlugins(page, { plugins: {} });
  await emit(page, "menu-split-right");
  await expect(page.locator(panes)).toHaveCount(2);
  await expect(page.locator('.tab-bar [role="tab"]')).toHaveCount(2);
});

test("an open split turns, swaps its sides and evens them out", async ({
  page,
}) => {
  await openTwo(page);
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  await page.keyboard.press("ControlOrMeta+Alt+s");
  await expect(page.locator(panes)).toHaveCount(2);
  await expect(page.locator(`${pane("first")} h1`)).toContainText("Two");

  // Side by side becomes one above the other.
  await dividerMenu(page, "Side by Side ⇄ One Above the Other");
  await expect(async () => {
    const first = (await page.locator(pane("first")).boundingBox())!;
    const second = (await page.locator(pane("second")).boundingBox())!;
    expect(second.y).toBeGreaterThan(first.y + first.height - 2);
  }).toPass();

  // The two tabs change places.
  await dividerMenu(page, "Swap the Two Sides");
  await expect(page.locator(`${pane("first")} h1`)).toContainText("One");
  await expect(page.locator(`${pane("second")} h1`)).toContainText("Two");

  // Dragged off-centre, Even puts the line back in the middle.
  const line = page.getByRole("separator", {
    name: "Divider between the documents",
  });
  const box = (await line.boundingBox())!;
  const first = (await page.locator(pane("first")).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, first.y + first.height * 0.6, {
    steps: 4,
  });
  await page.mouse.up();
  await dividerMenu(page, "Make Both Sides Equal");
  await expect(async () => {
    const a = (await page.locator(pane("first")).boundingBox())!;
    const b = (await page.locator(pane("second")).boundingBox())!;
    expect(Math.abs(a.height - b.height)).toBeLessThan(4);
  }).toPass();

  // The same keys again: one document.
  await page.locator(`${pane("first")} .ProseMirror`).click();
  await page.keyboard.press("ControlOrMeta+Alt+s");
  await expect(page.locator(panes)).toHaveCount(0);
});

test("a tab's right-click menu opens it beside the one in front", async ({
  page,
}) => {
  await openTwo(page);
  await page
    .locator('.tab-bar [role="tab"]')
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open to the Side" }).click();
  await expect(page.locator(panes)).toHaveCount(2);
  await expect(page.locator(`${pane("first")} h1`)).toContainText("Two");
  await expect(page.locator(`${pane("second")} h1`)).toContainText("One");
});

test("a tab pulled down onto the document splits it on the side it is let go", async ({
  page,
}) => {
  await openTwo(page);
  const tab = page.locator('.tab-bar [role="tab"]').first();
  const box = (await tab.boundingBox())!;
  const main = (await page.locator(".main-pane").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Down out of the bar, then to the document's right edge.
  await page.mouse.move(box.x + box.width / 2, box.y + 80, { steps: 4 });
  await page.mouse.move(main.x + main.width - 20, main.y + main.height / 2, {
    steps: 6,
  });
  await expect(page.locator(".split-drop-hint")).toBeVisible();
  await expect(page.locator(".tab-pull-ghost")).toHaveText("one.md");
  await page.mouse.up();
  await expect(page.locator(".split-drop-hint")).toHaveCount(0);
  await expect(page.locator(panes)).toHaveCount(2);
  // One on the right, the other on the left.
  await expect(page.locator(`${pane("first")} h1`)).toContainText("Two");
  await expect(page.locator(`${pane("second")} h1`)).toContainText("One");
  await expect(page.locator('.tab-bar [role="tab"]')).toHaveCount(2);
});

test("a tab pulled down and let go in the middle only comes to the front", async ({
  page,
}) => {
  await openTwo(page);
  const tab = page.locator('.tab-bar [role="tab"]').first();
  const box = (await tab.boundingBox())!;
  const main = (await page.locator(".main-pane").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 80, { steps: 4 });
  await page.mouse.move(main.x + main.width / 2, main.y + main.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(page.locator(panes)).toHaveCount(0);
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText(
    "One",
  );
});

test("the split is remembered and comes back once its documents are open", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    localStorage.setItem(
      "textus-split-layout",
      JSON.stringify({
        direction: "column",
        ratio: 0.5,
        paths: ["/notes/two.md", "/notes/one.md"],
      }),
    );
  });
  await pluginsAtStart(page, {
    plugins: {},
    folder: {
      "/notes/one.md": "# One\n\nThe first.\n",
      "/notes/two.md": "# Two\n\nThe second.\n",
    },
  });
  // Each document in a tab of its own, as a restored session has them.
  await openApp(page, {
    settings: { language: "en", newDocumentMode: "tab" },
  });
  await openPath(page, "/notes/one.md");
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText(
    "One",
  );
  // As the next document of a session arrives: a tab of its own.
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (n: string, p: unknown) => void;
      }
    ).__devEmitTauriEvent("open-paths-as-tabs", ["/notes/two.md"]),
  );
  await expect(page.locator(panes)).toHaveCount(2);
  await expect(page.locator(".main-pane-split")).toHaveAttribute(
    "data-split",
    "column",
  );
  await expect(page.locator(`${pane("first")} h1`)).toContainText("Two");
  await expect(page.locator(`${pane("second")} h1`)).toContainText("One");

  // Turned and closed, it is saved as it is now.
  await dividerMenu(page, "Side by Side ⇄ One Above the Other");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("textus-split-layout")),
    )
    .toContain('"row"');
  await emit(page, "menu-close-split");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("textus-split-layout")),
    )
    .toBe("null");
});

test("a tab's Move to New Window hands it to a new window and takes it out of this one", async ({
  page,
}) => {
  await openTwo(page);
  await mockInvoke(page, { move_tab_to_new_window: null });
  await page
    .locator('.tab-bar [role="tab"]', { hasText: "one.md" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to New Window" }).click();
  await expect(page.locator('.tab-bar [role="tab"]')).toHaveCount(0);
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText(
    "Two",
  );
  const sent = await page.evaluate(() =>
    (
      (
        window as unknown as {
          __devInvokeCalls?: {
            cmd: string;
            tab?: { path?: string };
          }[];
        }
      ).__devInvokeCalls ?? []
    ).filter((c) => c.cmd === "move_tab_to_new_window"),
  );
  expect(sent).toHaveLength(1);
  expect(sent[0].tab?.path).toBe("/notes/one.md");
});

test.describe("on Linux", () => {
  // Playwright's desktop Chrome reports Windows, which drags tabs out itself.
  test.use({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  });

  test("a tab let go outside the window opens in a new window", async ({
    page,
  }) => {
    await openTwo(page);
    await mockInvoke(page, { move_tab_to_new_window: null });
    const tab = page.locator('.tab-bar [role="tab"]', { hasText: "one.md" });
    const box = (await tab.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 5 });
    await page.mouse.move(box.x + box.width / 2, -40, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.tab-bar [role="tab"]')).toHaveCount(0);
    const sent = await page.evaluate(() =>
      (
        (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
          .__devInvokeCalls ?? []
      ).filter((c) => c.cmd === "move_tab_to_new_window"),
    );
    expect(sent).toHaveLength(1);
  });
});
