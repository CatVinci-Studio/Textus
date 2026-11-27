import { expect, test, type Page } from "@playwright/test";
import {
  MAC,
  PHONE,
  emit,
  openApp,
  pasteMarkdown,
  restedOn,
  END,
  selectionRead,
  settled,
  sourceOf,
} from "./helpers";
import { hasPlugin, openPath } from "./plugin-helpers";

// Sidebar panels: the plugin list opens a plugin's page in a tab of its
// own; the sidebar steps aside for the islands and widens by its edge.

async function open(page: Page) {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
}

test("a plugin in the list opens its page in a tab named for it", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-manage-plugins");
  const row = page.locator(".plugins-panel-row").first();
  await expect(row).toBeVisible();
  await row.locator(".plugins-panel-open").click();
  await expect(page.locator(".tab-pill").last()).toContainText("插件：");
  // Another plugin replaces it in the same tab.
  const count = await page.locator(".tab-pill").count();
  await page
    .locator(".plugins-panel-row")
    .nth(1)
    .locator(".plugins-panel-open")
    .click();
  await expect(page.locator(".tab-pill")).toHaveCount(count);
});

test("the plugins offered come by category, a computer-only one marked so", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.zotero"), "No textus-plugins checkout");
  // As the official manifests say it from their next release.
  await page.addInitScript(() =>
    Object.assign(window, {
      __devCatalogManifests: {
        "catvinci.tags": { category: "notes" },
        // No line: the mark stands alone.
        "catvinci.zotero": { category: "sync", description: undefined },
      },
    }),
  );
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { language: "en", menuBarShown: false } });
  await emit(page, "menu-manage-plugins");
  const available = page.getByRole("region", { name: "Available" });
  await expect(available.locator(".plugins-panel-row").first()).toBeVisible();
  const listed = await available
    .locator(".plugins-panel-category, .plugins-panel-row")
    .evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute("data-plugin"),
        text: el.textContent ?? "",
      })),
    );
  // Each plugin under its category's heading, the headings in the store's
  // order.
  let heading = "";
  const under: Record<string, string> = {};
  const headings: string[] = [];
  for (const { id, text } of listed)
    if (id) under[id] = heading;
    else headings.push((heading = text));
  expect(under["catvinci.tags"]).toBe("Notes & organizing");
  expect(under["catvinci.zotero"]).toBe("Sync & services");
  const order = [
    "Notes & organizing",
    "Editing & input",
    "Charts & diagrams",
    "Files & viewers",
    "Import & compatibility",
    "Sync & services",
    "AI",
    "Companions",
    "Other",
  ];
  expect(headings).toEqual(order.filter((h) => headings.includes(h)));
  const mark = (id: string) =>
    available.locator(`[data-plugin="${id}"]`).getByText("Computer only");
  await expect(mark("catvinci.zotero")).toBeVisible();
  await expect(mark("catvinci.tags")).toHaveCount(0);
  await expect(
    available.locator('[data-plugin="catvinci.zotero"] .plugins-panel-line'),
  ).toHaveCount(0);
});

for (const menuBarShown of [false, true])
  test(`the sidebar stepping aside keeps the row of tabs as it was drawn (menu bar ${menuBarShown ? "shown" : "hidden"})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 760 });
    await openApp(page, { settings: { menuBarShown } });
    await pasteMarkdown(page, "# 第三章");
    const sidebar = page.locator(".sidebar");
    await emit(page, "menu-toggle-sidebar");
    await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
    const parts = [".island-row", ".tab-bar", ".tab-pill"];
    await page.evaluate((parts) => {
      (window as unknown as { __drawn: Element[] }).__drawn = parts.map(
        (part) => document.querySelector(part)!,
      );
    }, parts);
    await page.setViewportSize({ width: 480, height: 760 });
    await expect(sidebar).toHaveClass(/sidebar-collapsed/);
    await settled(page);
    const kept = await page.evaluate(
      (parts) =>
        (window as unknown as { __drawn: Element[] }).__drawn.map(
          (el, i) => el.isConnected && document.querySelector(parts[i]!) === el,
        ),
      parts,
    );
    expect(kept).toEqual([true, true, true]);
  });

test("too narrow for the islands at their least, the sidebar steps aside, then the AI folds; they come back in turn", async ({
  page,
}) => {
  await open(page);
  await pasteMarkdown(page, "# 第三章");
  const sidebar = page.locator(".sidebar");
  await emit(page, "menu-toggle-sidebar");
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  await page.getByRole("button", { name: "Textus AI" }).first().click();
  await expect(page.locator("section.island")).toHaveCount(2);
  await page.setViewportSize({ width: 780, height: 760 });
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
  // Narrower still, the AI's island folds into the document's, and comes
  // back first; the sidebar after it.
  await page.setViewportSize({ width: 660, height: 760 });
  await expect(page.locator("section.island")).toHaveCount(1);
  await expect(page.locator(".tab-pill")).toHaveCount(2);
  await page.setViewportSize({ width: 780, height: 760 });
  await expect(page.locator("section.island")).toHaveCount(2);
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
  await page.setViewportSize({ width: 1200, height: 760 });
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  // Opened by hand in a narrow window, it stays.
  await page.setViewportSize({ width: 780, height: 760 });
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
  await emit(page, "menu-toggle-sidebar");
  await settled(page);
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  // Opening the AI where it leaves too little room puts nothing away, and
  // splits nothing: it joins the document's island as a tab.
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.getByRole("button", { name: "Textus AI" }).first().click();
  await expect(page.locator("section.island")).toHaveCount(1);
  await page.setViewportSize({ width: 800, height: 760 });
  await page.getByRole("button", { name: "Textus AI" }).first().click();
  await expect(page.locator(".tab-pill")).toHaveCount(2);
  await expect(page.locator("section.island")).toHaveCount(1);
  await settled(page);
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  // And the island it joined stays in the window.
  const island = (await page.locator("section.island").boundingBox())!;
  expect(island.x + island.width).toBeLessThanOrEqual(800);
  // Split with the AI in front: it and the document go apart, the sidebar
  // stepping aside for them - not made, then folded straight back.
  await emit(page, "menu-split-right");
  await expect(page.locator("section.island")).toHaveCount(2);
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
  await settled(page);
  await expect(page.locator("section.island")).toHaveCount(2);
});

test("its edge dragged out, the sidebar widens and the islands make room", async ({
  page,
}) => {
  await open(page);
  await emit(page, "menu-toggle-sidebar");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  await settled(page);
  const edge = (await page.locator(".sidebar-resizer").boundingBox())!;
  const before = (await sidebar.boundingBox())!;
  const island = (await page.locator("section.island").first().boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + 120, edge.y + edge.height / 2, { steps: 12 });
  await page.mouse.up();
  await settled(page);
  const after = (await sidebar.boundingBox())!;
  // Wider, and the islands moved over for it.
  expect(after.width).toBeGreaterThan(before.width + 100);
  const moved = (await page.locator("section.island").first().boundingBox())!;
  expect(moved.x).toBeGreaterThan(island.x + 100);
  // Dragged again and Esc pressed while held: back to where it was.
  const again = (await page.locator(".sidebar-resizer").boundingBox())!;
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.mouse.down();
  await page.mouse.move(again.x + 100, again.y + again.height / 2, {
    steps: 8,
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await settled(page);
  expect((await sidebar.boundingBox())!.width).toBeCloseTo(after.width, 0);
});

test("the folder's tools coming on hover move none of the tree's rows", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = { "/proj/a.md": "# A\n", "/proj/b.md": "# B\n" };
    w.__devPickFolder = "/proj";
  });
  await openApp(page);
  await emit(page, "menu-open-folder");
  const row = page.locator(".tree-row").first();
  await expect(row).toBeVisible();
  await page.mouse.move(900, 400);
  const before = (await row.boundingBox())!.y;
  await row.hover();
  await expect(page.locator(".tree-tool").first()).toBeVisible();
  expect((await row.boundingBox())!.y).toBe(before);
});

test("following the document, Open This Folder stays in sight; the other tools wait for the pointer", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = { "/w/a.md": "# A\n", "/w/b.md": "# B\n" };
  });
  await openApp(page, { settings: { language: "en" } });
  await openPath(page, "/w/a.md");
  await page
    .getByRole("navigation", { name: "Activity bar" })
    .getByRole("button", { name: "Files" })
    .click();
  await expect(page.locator(".tree-root-label")).toHaveText("w");
  await page.mouse.move(900, 400);
  const keep = page.getByRole("button", { name: "Open This Folder" });
  await expect(keep).toBeVisible();
  await expect(page.getByRole("button", { name: "Sort" })).toBeHidden();
  // Opened as the folder: no button to open it, the tools on hover alone.
  await keep.click();
  await page.mouse.move(900, 400);
  await expect(page.locator(".tree-tool:visible")).toHaveCount(0);
});

test("scrolled into, the folder's name and the folders' rows stay at the top until their rows go by; folded there, it stays in sight", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const fs: Record<string, string> = { "/proj/z.md": "# Z\n" };
    for (let i = 10; i < 50; i++) {
      fs[`/proj/notes/inner/i${i}.md`] = "# I\n";
      fs[`/proj/notes/n${i}.md`] = "# N\n";
      fs[`/proj/r${i}.md`] = "# R\n";
    }
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = fs;
    w.__devPickFolder = "/proj";
  });
  await page.setViewportSize({ width: 1200, height: 600 });
  await openApp(page);
  await emit(page, "menu-open-folder");
  const row = (name: string) =>
    page.locator(".tree-row", { has: page.getByText(name, { exact: true }) });
  await row("notes").click();
  await row("inner").click();
  await expect(row("i49.md")).toBeAttached();
  const scroller = page.locator(".sidebar-body");
  const top = async (name: string) =>
    (await row(name).boundingBox())!.y - (await scroller.boundingBox())!.y;
  const height = (await row("notes").boundingBox())!.height;
  const toolbar = page.locator(".tree-toolbar");
  const bar = (await toolbar.boundingBox())!.height;

  await scroller.evaluate((el) => (el.scrollTop = 600));
  await expect.poll(() => top("notes")).toBeCloseTo(bar, 0);
  expect(await top("inner")).toBeCloseTo(bar + height, 0);
  // The folder's name stays over them all.
  expect(
    (await toolbar.boundingBox())!.y - (await scroller.boundingBox())!.y,
  ).toBeCloseTo(0, 0);
  await expect(toolbar.locator(".tree-root-label")).toHaveText("proj");
  // Past inner's last row, inner goes up with it; notes stays.
  const pastInner = await row("n10.md").evaluate(
    (el, h) =>
      el.getBoundingClientRect().top -
      el.closest(".sidebar-body")!.getBoundingClientRect().top +
      el.closest(".sidebar-body")!.scrollTop -
      h / 2,
    height,
  );
  await scroller.evaluate((el, y) => (el.scrollTop = y), pastInner);
  await expect.poll(() => top("inner")).toBeLessThan(bar);
  expect(await top("notes")).toBeCloseTo(bar, 0);

  // Folded from the top, notes stays in sight.
  await scroller.evaluate((el) => (el.scrollTop = 600));
  await expect.poll(() => top("notes")).toBeCloseTo(bar, 0);
  await row("notes").click();
  await expect(row("inner")).toHaveCount(0);
  const folded = await top("notes");
  expect(folded).toBeGreaterThanOrEqual(-1);
  expect(folded).toBeLessThan((await scroller.boundingBox())!.height);
});

test("a file closed at once opens again at once", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = { "/proj/a.md": "# A\n", "/proj/b.md": "# B\n" };
    w.__devPickFolder = "/proj";
  });
  await openApp(page);
  await emit(page, "menu-open-folder");
  // Another tab, so closing this one leaves the window open.
  await page.locator(".tree-row", { hasText: "b.md" }).dblclick();
  await expect(page.locator(".tab-pill", { hasText: "b.md" })).toBeVisible();
  const row = page.locator(".tree-row", { hasText: "a.md" });
  const tab = page.locator(".tab-pill", { hasText: "a.md" });
  await row.dblclick();
  await expect(tab).toBeVisible();
  await emit(page, "menu-close-tab");
  await expect(tab).toHaveCount(0);
  await row.dblclick();
  await expect(tab).toBeVisible();
});

test("a picture's path completes from the folder as it is typed; a file's menu inserts a link to it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/proj/a.md": "# A\n",
      "/proj/b.md": "# B\n",
      "/proj/assets/pic.png": "",
    };
    w.__devPickFolder = "/proj";
  });
  await openApp(page);
  await emit(page, "menu-open-folder");
  const row = (name: string) => page.locator(".tree-row", { hasText: name });
  await row("a.md").dblclick();
  const doc = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(doc.locator("h1")).toContainText("A");
  await doc.locator("h1").click();
  await page.keyboard.press(END);
  await selectionRead(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("see ![](");
  const list = page.locator(".completion-list:not([hidden])");
  // Only images after "![".
  await expect(list.locator(".completion-label")).toHaveText([
    "assets/pic.png",
  ]);
  await page.keyboard.press("Enter");
  await expect(list).toHaveCount(0);

  await row("b.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "插入链接" }).click();
  await expect(doc.locator("a")).toHaveCount(1);
  // Its own undo step: the picture stays.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(doc.locator("a")).toHaveCount(0);
  expect(await sourceOf(page)).toBe("# A\n\nsee ![](assets/pic.png)");

  // The same in source mode: a link lists notes first.
  await emit(page, "menu-toggle-source-mode");
  const source = page.locator(
    '[data-active-tab="true"] .source-view .cm-content',
  );
  await source.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" [x](");
  await expect(list.locator(".completion-label").first()).toHaveText("b.md");
  await page.keyboard.press("Enter");
  await expect(list).toHaveCount(0);
  await row("b.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "插入链接" }).click();
  await expect(source).toContainText(
    "see ![](assets/pic.png) [x](b.md)[b](b.md)",
  );
});

test("a file dragged onto a folder moves into it; with Esc it stays; picked files go together", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/proj/a.md": "# A\n",
      "/proj/b.md": "# B\n",
      "/proj/c.md": "# C\n",
      "/proj/d.md": "# D\n",
      "/proj/notes/n.md": "# N\n",
    };
    w.__devPickFolder = "/proj";
  });
  await openApp(page);
  await emit(page, "menu-open-folder");
  const row = (name: string) => page.locator(".tree-row", { hasText: name });
  await expect(row("a.md")).toBeVisible();
  const drag = async (escape: boolean, name = "a.md") => {
    const from = (await row(name).boundingBox())!;
    const to = (await row("notes").boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 8 });
    if (escape) await page.keyboard.press("Escape");
    await page.mouse.up();
  };
  const files = () =>
    page.evaluate(() =>
      Object.keys(
        (window as unknown as { __devFs: Record<string, string> }).__devFs,
      ),
    );
  await drag(true);
  await expect.poll(files).toContain("/proj/a.md");
  await drag(false);
  await expect.poll(files).toContain("/proj/notes/a.md");

  // b to d by Shift, c let go of by ⌘/Ctrl: b and d go into notes together.
  const picked = () =>
    page.locator(".tree-row-picked .tree-label").allInnerTexts();
  await row("b.md").click();
  await row("d.md").click({ modifiers: ["Shift"] });
  await expect.poll(picked).toEqual(["b.md", "c.md", "d.md"]);
  await row("c.md").click({ modifiers: ["ControlOrMeta"] });
  await expect.poll(picked).toEqual(["b.md", "d.md"]);
  await drag(false, "b.md");
  await expect
    .poll(files)
    .toEqual(
      expect.arrayContaining([
        "/proj/notes/b.md",
        "/proj/notes/d.md",
        "/proj/c.md",
      ]),
    );
  await expect.poll(picked).toEqual([]);

  // Two picked, right-clicked: both to the Trash after one question.
  await row("c.md").click();
  await row("n.md").click({ modifiers: ["ControlOrMeta"] });
  await expect.poll(picked).toEqual(["n.md", "c.md"]);
  await row("c.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "移到废纸篓" }).click();
  await page.getByRole("button", { name: "移到废纸篓" }).click();
  await expect.poll(files).not.toContain("/proj/c.md");
  expect(await files()).not.toContain("/proj/notes/n.md");
});

test("the AI's edge stepped past what the window can show stops there, and steps back at once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await openApp(page);
  await page.getByRole("button", { name: "Textus AI" }).first().click();
  await expect(page.locator("section.island")).toHaveCount(2);
  const ai = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("section.island")]
        .map((e) => e.getBoundingClientRect().width)
        .at(-1)!,
    );
  // The composer takes the focus as the panel opens; the keys go to the
  // divider after that.
  await expect(page.locator(".inline-chat-input").first()).toBeFocused();
  // The islands' divider, not the composer's grip.
  const divider = page.locator(".split-divider");
  await divider.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowLeft");
  // Read once it has glided there.
  let widest = 0;
  await expect
    .poll(async () => {
      const was = widest;
      widest = await ai();
      return widest === was;
    })
    .toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect.poll(ai).toBeLessThan(widest - 10);
});

test("a split the window has no room for is not made, and says why", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 600 });
  // The page's clock, to let each note's time pass at once.
  await page.clock.install();
  await openApp(page, { settings: { menuBarShown: false } });
  const noteGone = async () => {
    await page.clock.fastForward(5000);
    await page.locator(".notice-text").waitFor({ state: "hidden" });
  };
  const islands = page.locator("section.island");
  // Splits while a document keeps its least, 240 wide, whatever its zoom.
  let count = 1;
  for (; count < 6; count++) {
    await emit(page, "menu-split-right");
    if ((await islands.count()) === count) break;
    await expect(islands).toHaveCount(count + 1);
  }
  expect(count).toBe(3);
  await expect(page.locator(".notice-text")).toBeVisible();
  await expect(islands).toHaveCount(3);

  // A tab dropped on the window's outer edge then joins the island there,
  // and the window says why.
  await noteGone();
  const box = (await islands.first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await emit(page, "menu-new-file");
  const rows = page.getByRole("tablist");
  await expect(rows.first().getByRole("tab")).toHaveCount(2);
  const tab = (await rows.first().getByRole("tab").last().boundingBox())!;
  const last = (await islands.last().boundingBox())!;
  await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
  await page.mouse.down();
  await page.mouse.move(tab.x + 40, tab.y + 150, { steps: 10 });
  await page.mouse.move(last.x + last.width - 6, last.y + last.height / 2, {
    steps: 25,
  });
  await restedOn(page);
  await page.mouse.up();
  await expect(page.locator(".notice-text")).toBeVisible();
  await expect(islands).toHaveCount(3);
  await expect(rows.last().getByRole("tab")).toHaveCount(2);

  // Its own island's edge, no room for another: it stays, and is told why.
  await noteGone();
  const own = (await rows.last().getByRole("tab").last().boundingBox())!;
  await page.mouse.move(own.x + own.width / 2, own.y + own.height / 2);
  await page.mouse.down();
  await page.mouse.move(own.x, own.y + 150, { steps: 10 });
  await page.mouse.move(last.x + last.width - 6, last.y + last.height / 2, {
    steps: 25,
  });
  await restedOn(page);
  await page.mouse.up();
  await expect(page.locator(".notice-text")).toBeVisible();
  await expect(islands).toHaveCount(3);
  await expect(rows.last().getByRole("tab")).toHaveCount(2);

  // Wide but short (a phone on its side, the keyboard up), the window says
  // it is too short, not too narrow.
  await noteGone();
  await page.setViewportSize({ width: 2400, height: 170 });
  // The islands laid out in the new window first: the split is weighed
  // against the room they have.
  await expect
    .poll(async () => (await islands.first().boundingBox())!.height)
    .toBeLessThan(170);
  await emit(page, "menu-split-right");
  await expect(page.locator(".notice-text")).toContainText("太矮");
});

test("another folder takes the open one's place: its documents close, and come back with it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = { "/one/a.md": "# A\n", "/two/b.md": "# B\n" };
    w.__devPickFolder = "/one";
  });
  await openApp(page);
  await emit(page, "menu-open-folder");
  await page.locator(".tree-row", { hasText: "a.md" }).dblclick();
  const a = page.locator(".tab-pill", { hasText: "a.md" });
  await expect(a).toBeVisible();

  await emit(page, "menu-open-recent-folder", "/two");
  await expect(page.locator(".tree-row", { hasText: "b.md" })).toBeVisible();
  await expect(a).toHaveCount(0);
  await page.locator(".tree-row", { hasText: "b.md" }).dblclick();
  await expect(page.locator(".tab-pill", { hasText: "b.md" })).toBeVisible();
  // An unsaved draft stays across the switch: the documents still come
  // back in this window, beside it.
  await emit(page, "menu-new-file");
  await page.locator(".ProseMirror:visible").first().click();
  await page.keyboard.type("draft");

  await emit(page, "menu-open-recent-folder", "/one");
  await expect(a).toBeVisible();
  await expect(page.locator(".tab-pill", { hasText: "b.md" })).toHaveCount(0);
});

test("a sidebar tab's own key shows it, and again puts the sidebar away; Search by its icon takes the keyboard", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = { "/one/a.md": "# A\n" };
    w.__devPickFolder = "/one";
  });
  await openApp(page, {
    settings: {
      menuBarShown: false,
      shortcuts: { showOutline: "mod+shift+u", showFiles: "mod+shift+y" },
    },
  });
  await emit(page, "menu-open-folder");
  await page.locator(".tree-row", { hasText: "a.md" }).click();
  await expect(page.locator(".ProseMirror:visible h1")).toContainText("A");
  const mod = MAC ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+Shift+u`);
  await expect(page.locator('[data-rail-id="outline"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // A heading clicked there: the caret at its end, typing goes on in it.
  await page.locator(".outline-row", { hasText: "A" }).click();
  await expect(page.locator(".ProseMirror:visible")).toBeFocused();
  await page.keyboard.type(" more");
  await expect(page.locator(".ProseMirror:visible h1")).toContainText("A more");
  await page.keyboard.press(`${mod}+Shift+u`);
  await expect(page.locator(".tree-row")).toHaveCount(0);
  await page.keyboard.press(`${mod}+Shift+y`);
  await expect(page.locator(".tree-row", { hasText: "a.md" })).toBeVisible();
  await page.locator('[data-rail-id="search"]').click();
  await expect(page.locator(".search-panel input").first()).toBeFocused();
});

test.describe("on a phone", () => {
  test.use(PHONE);

  test("a document brought to the front is read first: the keyboard comes up for a tap in its text", async ({
    page,
  }) => {
    await openApp(page);
    const editor = page.locator(".ProseMirror:visible");
    await editor.tap();
    await page.keyboard.type("some text");
    await page.locator(".tab-bar-add").first().tap();
    await expect(page.locator(".tab-pill")).toHaveCount(2);
    // A slow phone: the document is built well after the tap.
    const cdp = await page
      .context()
      .newCDPSession(page)
      .catch(() => null);
    await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 30 });
    // What was tapped goes (as a sidebar's row does): the document left
    // in front is not given the keys for it.
    await page.locator(".tab-pill").last().locator(".tab-pill-close").tap();
    const text = page.locator(".ProseMirror:visible p", { hasText: "some" });
    await expect(text).toBeVisible();
    // Long enough for any late focus of its own to have come.
    await page.waitForTimeout(2000);
    await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await expect(editor).not.toBeFocused();
    await text.tap();
    await expect(editor).toBeFocused();
  });
});

test("a file that takes the preview tab starts with its own history, not the last one's", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = { "/one/a.md": "# Alpha\n", "/one/b.md": "# Beta\n" };
    w.__devPickFolder = "/one";
  });
  await openApp(page, { settings: { menuBarShown: false } });
  await emit(page, "menu-open-folder");
  await page.locator(".tree-row", { hasText: "a.md" }).click();
  const doc = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(doc.locator("h1")).toContainText("Alpha");
  await page.locator(".tree-row", { hasText: "b.md" }).click();
  await expect(doc.locator("h1")).toContainText("Beta");
  await doc.click();
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(doc.locator("h1")).toContainText("Beta");
  await expect(doc).not.toContainText("Alpha");
});

test("the sidebar stepping aside and back leaves the rows of tabs in place, not drawn anew", async ({
  page,
}) => {
  await open(page);
  await pasteMarkdown(page, "# 第三章");
  await emit(page, "menu-toggle-sidebar");
  await page.getByRole("button", { name: "Textus AI" }).first().click();
  await expect(page.locator("section.island")).toHaveCount(2);
  const rows = page.locator(".tab-bar, .tab-pill[data-tab]");
  const before = await rows.elementHandles();
  const sidebar = page.locator(".sidebar");
  await page.setViewportSize({ width: 780, height: 760 });
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
  await page.setViewportSize({ width: 1200, height: 760 });
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  const kept = await Promise.all(
    before.map((el) => el.evaluate((n) => n.isConnected)),
  );
  expect(kept).toEqual(before.map(() => true));
  await expect(rows).toHaveCount(before.length);
});

test("Collapse All holds as a folder opens again, things made in the folders below it before", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = { "/proj/a.md": "# A\n", "/proj/notes/deep/d.md": "# D\n" };
    w.__devPickFolder = "/proj";
  });
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-folder");
  const row = (name: string) =>
    page.locator(".tree-row", { hasText: new RegExp(`^${name}$`) });
  await row("notes").click();
  await row("deep").click();
  await page.locator(".tree-toolbar").hover();
  await page.getByRole("button", { name: "New Folder", exact: true }).click();
  await page.locator(".tree-draft-input").fill("inner");
  await page.locator(".tree-draft-input").press("Enter");
  await expect(row("inner")).toBeVisible();

  await page.getByRole("button", { name: "Sort" }).click();
  await page.getByRole("menuitem", { name: "Collapse All" }).click();
  await expect(row("deep")).toHaveCount(0);
  await row("notes").click();
  await expect(row("deep")).toHaveAttribute("aria-expanded", "false");
});

test("New makes things in the folder last clicked, folders on the way too; Collapse All folds every folder", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/proj/a.md": "# A\n",
      "/proj/notes/n.md": "# N\n",
      "/proj/notes/deep/d.md": "# D\n",
    };
    w.__devPickFolder = "/proj";
  });
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-folder");
  const row = (name: string) =>
    page.locator(".tree-row", { hasText: new RegExp(`^${name}$`) });
  const files = () =>
    page.evaluate(() =>
      Object.keys(
        (window as unknown as { __devFs: Record<string, string> }).__devFs,
      ),
    );
  const make = async (tool: string, name: string) => {
    // The folder's tools show while the pointer is over it.
    await page.locator(".tree-toolbar").hover();
    await page.getByRole("button", { name: tool, exact: true }).click();
    const input = page.locator(".tree-draft-input");
    await input.fill(name);
    await input.press("Enter");
  };

  // A folder clicked: in it. A file clicked: in its folder.
  await row("notes").click();
  await make("New File", "fresh");
  await expect.poll(files).toContain("/proj/notes/fresh.md");
  await row("deep").click();
  await row("d.md").click();
  await make("New Folder", "inner");
  await expect.poll(files).toContain("/proj/notes/deep/inner/.keep");

  // The document in front is elsewhere: nothing but New opens the way.
  await openPath(page, "/proj/a.md");
  await expect(page.locator(".tab-pill", { hasText: "a.md" })).toBeVisible();

  // Collapse All, from the Sort menu: no folder below the root stays open.
  await page.getByRole("button", { name: "Sort" }).click();
  await page.getByRole("menuitem", { name: "Collapse All" }).click();
  await expect(row("notes")).toHaveAttribute("aria-expanded", "false");
  await expect(row("n.md")).toHaveCount(0);
  await expect(row("a.md")).toBeVisible();

  // New again: the folders on the way to the one last clicked open for it.
  await make("New File", "later");
  await expect.poll(files).toContain("/proj/notes/deep/later.md");
  await expect(row("notes")).toHaveAttribute("aria-expanded", "true");

  // Slashes in the name make the folders on the way, shown open.
  await make("New Folder", "week/days");
  await expect.poll(files).toContain("/proj/notes/deep/week/days/.keep");
  await expect(row("week")).toHaveAttribute("aria-expanded", "true");
  await expect(row("days")).toBeVisible();

  // The folder last clicked gone (moved elsewhere): New goes to the top.
  await page.evaluate(() => {
    const fs = (window as unknown as { __devFs: Record<string, string> })
      .__devFs;
    for (const f of Object.keys(fs))
      if (f.startsWith("/proj/notes/deep/")) delete fs[f];
  });
  await emit(page, "tree-dirs-changed", { dirs: ["/proj/notes"], all: false });
  await expect(row("deep")).toHaveCount(0);
  await make("New File", "top");
  await expect.poll(files).toContain("/proj/top.md");
});
