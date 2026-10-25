import { expect, test, type Page } from "@playwright/test";
import { pasteMarkdown } from "./helpers";
import { openPath, openWithPlugins } from "./plugin-helpers";

/**
 * Split Panes (catvinci.split-panes): two documents at once through the
 * app's layout API - the panes and the line between them are the app's,
 * the commands the plugin's.
 */

const panes = ".main-pane-split > .split-pane";
const pane = (which: "first" | "second") => `.split-pane[data-pane="${which}"]`;

async function command(page: Page, id: string) {
  await page.evaluate(
    (id) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent("menu-plugin-command", id),
    id,
  );
}

async function emit(page: Page, name: string) {
  await page.evaluate(
    (name) =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent(name),
    name,
  );
}

/** Two tabs: one.md, and a new one with "Two" in front. */
async function openTwo(page: Page) {
  await openWithPlugins(page, {
    plugins: { "catvinci.split-panes": [] },
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
  // Its shortcut, once the plugin has started.
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
  await command(page, "catvinci.split-panes.close");
  await expect(page.locator(panes)).toHaveCount(0);
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText(
    "One",
  );
});

test("Split Down puts one above the other, and the line between them shares the space", async ({
  page,
}) => {
  await openTwo(page);
  await command(page, "catvinci.split-panes.down");
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

test("a tab chosen from the tab bar opens in the pane in front; closing a pane's tab ends the split", async ({
  page,
}) => {
  await openTwo(page);
  await page.locator('.tab-bar [role="tab"]').first().click();
  await expect(page.locator('[data-active-tab="true"] h1')).toContainText(
    "One",
  );
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  // Its shortcut, once the plugin has started.
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+Alt+s");
    await expect(page.locator(panes)).toHaveCount(2, { timeout: 500 });
  }).toPass();
  await expect(page.locator(`${pane("first")} h1`)).toContainText("One");
  // A third tab, chosen in the tab bar, takes the front pane's place.
  await emit(page, "menu-new-file");
  await expect(page.locator(panes)).toHaveCount(2);
  await expect(page.locator(`${pane("second")} h1`)).toContainText("Two");
  await expect(page.locator(pane("first"))).toHaveAttribute(
    "data-active-tab",
    "true",
  );
  // Closing it: one document again.
  await page.keyboard.press("ControlOrMeta+w");
  await expect(page.locator(panes)).toHaveCount(0);
});

test("with one tab, Split Right opens a blank one beside it", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: { "catvinci.split-panes": [] },
  });
  await command(page, "catvinci.split-panes.right");
  await expect(page.locator(panes)).toHaveCount(2);
  await expect(page.locator('.tab-bar [role="tab"]')).toHaveCount(2);
});

test("an open split turns, swaps its sides and evens them out", async ({
  page,
}) => {
  await openTwo(page);
  await command(page, "catvinci.split-panes.toggle");
  await expect(page.locator(panes)).toHaveCount(2);
  await expect(page.locator(`${pane("first")} h1`)).toContainText("Two");

  // Side by side becomes one above the other.
  await command(page, "catvinci.split-panes.turn");
  await expect(async () => {
    const first = (await page.locator(pane("first")).boundingBox())!;
    const second = (await page.locator(pane("second")).boundingBox())!;
    expect(second.y).toBeGreaterThan(first.y + first.height - 2);
  }).toPass();

  // The two tabs change places.
  await command(page, "catvinci.split-panes.swap");
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
  await command(page, "catvinci.split-panes.even");
  await expect(async () => {
    const a = (await page.locator(pane("first")).boundingBox())!;
    const b = (await page.locator(pane("second")).boundingBox())!;
    expect(Math.abs(a.height - b.height)).toBeLessThan(4);
  }).toPass();

  // The same key again: one document.
  await command(page, "catvinci.split-panes.toggle");
  await expect(page.locator(panes)).toHaveCount(0);
});
