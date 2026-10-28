import { expect, test, type Page } from "@playwright/test";
import { END, openApp } from "./helpers";

// The sidebar's file tree as a small file manager: up to the parent, sort and
// filter, New Document and New Folder, and dragging a row into a folder. The
// dev shim's in-memory folder (window.__devFs) stands in for the disk.

const FILES: Record<string, string> = {
  "/work/notes/b.md": "# Bravo",
  "/work/notes/a.md": "# Alpha",
  "/work/notes/chart.png": "not really a picture",
  "/work/notes/drafts/old.md": "# Old",
  "/work/other.md": "# Other",
};
// b.md is the newest, a.md the oldest.
const MTIMES: Record<string, number> = {
  "/work/notes/a.md": 1000,
  "/work/notes/chart.png": 2000,
  "/work/notes/b.md": 3000,
};

const editor = '[data-active-tab="true"] .ProseMirror';

async function open(page: Page, more: Record<string, string> = {}) {
  await page.addInitScript(
    ([files, mtimes]) => {
      const w = window as unknown as Record<string, unknown>;
      w.__devFs = files;
      w.__devMtimes = mtimes;
      w.__devPickFolder = "/work/notes";
    },
    [{ ...FILES, ...more }, MTIMES] as const,
  );
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-recent", "/work/notes/a.md");
  await expect(page.locator(`${editor} h1`)).toContainText("Alpha");
  await emit(page, "menu-toggle-sidebar");
}

function emit(page: Page, event: string, payload?: unknown) {
  return page.evaluate(
    ([name, value]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent(name as string, value),
    [event, payload] as const,
  );
}

const rows = (page: Page) => page.locator(".sidebar .tree-main .tree-row");
const row = (page: Page, name: string) =>
  page.locator(".sidebar .tree-main .tree-row", { hasText: name });
const files = (page: Page) =>
  page.evaluate(() =>
    Object.keys(
      (window as unknown as { __devFs: Record<string, string> }).__devFs,
    ).sort(),
  );

test("the parent folder's name takes the tree up a level in one click", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator(".sidebar .tree-root-label")).toHaveText("notes");
  const up = page.locator(".sidebar .tree-crumb");
  await expect(up).toHaveText("work");
  await up.click();
  await expect(page.locator(".sidebar .tree-root-label")).toHaveText("work");
  await expect(row(page, "other.md")).toBeVisible();
});

test("sorts by name or by date modified, and filters to documents", async ({
  page,
}) => {
  await open(page);
  await expect(rows(page)).toHaveText(["drafts", "a.md", "b.md", "chart.png"]);

  await page.getByRole("button", { name: "Sort" }).click();
  await page.getByRole("menuitemradio", { name: "By date modified" }).click();
  // Folders first still, then newest first.
  await expect(rows(page)).toHaveText(["drafts", "b.md", "chart.png", "a.md"]);
  await page.getByRole("button", { name: "Sort" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "By date modified" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  // The filter beside the search box is the tree's too.
  await page.getByRole("combobox", { name: "Show" }).click();
  await page
    .getByRole("option", { name: "Documents only", exact: true })
    .click();
  await expect(rows(page)).toHaveText(["drafts", "b.md", "a.md"]);
  expect(
    await page.evaluate(() => [
      localStorage.getItem("textus-file-tree-sort"),
      localStorage.getItem("textus-file-search-scope"),
    ]),
  ).toEqual(["modified", "documents"]);
});

test("New Document and New Folder from the right-click menu", async ({
  page,
}) => {
  await open(page);
  // On a folder: inside it.
  await row(page, "drafts").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New Document" }).click();
  const name = page.getByRole("dialog").getByRole("textbox");
  await name.fill("Chapter 1");
  await page.getByRole("dialog").getByRole("button", { name: "OK" }).click();
  await expect(row(page, "Chapter 1.md")).toBeVisible();
  // The new document opens.
  await expect(page.locator(".window-bar-title-text")).toHaveText(
    "Chapter 1.md",
  );

  // On the tree's empty space: in its root.
  const body = (await page.locator(".sidebar .tree-body").boundingBox())!;
  await page.mouse.click(body.x + 40, body.y + body.height - 20, {
    button: "right",
  });
  await page.getByRole("menuitem", { name: "New Folder" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Research");
  await page.getByRole("dialog").getByRole("button", { name: "OK" }).click();
  await expect(row(page, "Research")).toBeVisible();
  expect(await files(page)).toContain("/work/notes/Research/.keep");
  expect(await files(page)).toContain("/work/notes/drafts/Chapter 1.md");

  // A name already taken says so, and nothing is replaced.
  await row(page, "a.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New Document" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("b");
  await page.getByRole("dialog").getByRole("button", { name: "OK" }).click();
  await expect(
    page.getByText("There is already something named “b” here."),
  ).toBeVisible();
});

test("Rename and Move to Trash from the right-click menu (#351)", async ({
  page,
}) => {
  await open(page);
  // The open document renamed: still a document, and its tab follows.
  await row(page, "a.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Opening");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Rename" })
    .click();
  await expect(row(page, "Opening.md")).toBeVisible();
  await expect(page.locator(".window-bar-title-text")).toHaveText("Opening.md");
  expect(await files(page)).toContain("/work/notes/Opening.md");
  expect(await files(page)).not.toContain("/work/notes/a.md");

  // A name already taken is refused.
  await row(page, "Opening.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("b");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Rename" })
    .click();
  await expect(
    page.getByText("There is already something named “b” here."),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // A folder goes to the Trash once confirmed, everything in it along.
  await row(page, "drafts").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Move the folder “drafts” and everything in it to the Trash?",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Move to Trash" })
    .click();
  await expect(row(page, "drafts")).toHaveCount(0);
  expect(await files(page)).not.toContain("/work/notes/drafts/old.md");
  expect(
    await page.evaluate(
      () => (window as unknown as { __devTrashed: string[] }).__devTrashed,
    ),
  ).toEqual(["/work/notes/drafts"]);

  // The tree's own folder offers neither.
  const body = (await page.locator(".sidebar .tree-body").boundingBox())!;
  await page.mouse.click(body.x + 40, body.y + body.height - 20, {
    button: "right",
  });
  await expect(
    page.getByRole("menuitem", { name: "New Folder" }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Rename…" })).toHaveCount(0);
});

test("⌘/Ctrl-click on a file opens it in a new window, this one unchanged (#348)", async ({
  page,
}) => {
  await open(page);
  await row(page, "b.md").click({ modifiers: ["ControlOrMeta"] });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __devNewWindows?: string[] }).__devNewWindows,
      ),
    )
    .toEqual(["/work/notes/b.md"]);
  await expect(page.locator(".window-bar-title-text")).toHaveText("a.md");
});

test("a row dragged onto a folder moves into it, and its open tab follows", async ({
  page,
}) => {
  await open(page);
  const from = (await row(page, "a.md").boundingBox())!;
  const to = (await row(page, "drafts").boundingBox())!;
  await page.mouse.move(from.x + 30, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 34, from.y + from.height / 2 - 6, {
    steps: 3,
  });
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 6 });
  await expect(row(page, "drafts")).toHaveClass(/tree-row-drop/);
  await expect(page.locator(".tree-drag-ghost")).toHaveText("a.md");
  await page.mouse.up();

  await expect(page.locator(".tree-drag-ghost")).toHaveCount(0);
  expect(await files(page)).toContain("/work/notes/drafts/a.md");
  expect(await files(page)).not.toContain("/work/notes/a.md");
  // The drop isn't also a click: the open document is still a.md, now in
  // drafts, and saving writes it there.
  await expect(page.locator(".window-bar-title-text")).toHaveText("a.md");
  await page.locator(editor).click();
  await page.keyboard.press(END);
  await page.keyboard.type(" moved");
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __devFs: Record<string, string> }).__devFs[
            "/work/notes/drafts/a.md"
          ],
      ),
    )
    .toContain("moved");
});

test("a folder can't be dragged into itself", async ({ page }) => {
  await open(page);
  await row(page, "drafts").click();
  await expect(row(page, "old.md")).toBeVisible();
  const from = (await row(page, "drafts").boundingBox())!;
  const into = (await row(page, "old.md").boundingBox())!;
  await page.mouse.move(from.x + 30, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(into.x + 40, into.y + into.height / 2, { steps: 6 });
  await expect(page.locator(".tree-row-drop")).toHaveCount(0);
  await page.mouse.up();
  expect(await files(page)).toContain("/work/notes/drafts/old.md");
});

test("hidden files stay out of the tree until it shows them (#357)", async ({
  page,
}) => {
  await open(page, {
    "/work/notes/.obsidian/app.json": "{}",
    "/work/notes/.env": "x",
  });
  await expect(rows(page)).toHaveText(["drafts", "a.md", "b.md", "chart.png"]);
  await page.getByRole("button", { name: "Sort" }).click();
  await page.getByRole("menuitemradio", { name: "Show Hidden Files" }).click();
  await expect(rows(page)).toHaveText([
    ".obsidian",
    "drafts",
    ".env",
    "a.md",
    "b.md",
    "chart.png",
  ]);
  expect(
    await page.evaluate(() => localStorage.getItem("textus-file-tree-hidden")),
  ).toBe("1");
});

test("a file dragged over a plugin's frame still splits where it is let go", async ({
  page,
}) => {
  await open(page);
  // A plugin's view (a PDF) is an iframe over the document.
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    document.querySelector(".main-pane")!.append(frame);
  });
  const from = (await row(page, "b.md").boundingBox())!;
  const main = (await page.locator(".main-pane").boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(main.x + main.width - 30, main.y + main.height / 2, {
    steps: 8,
  });
  await expect(page.locator(".split-drop-hint")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".main-pane-split > .split-pane")).toHaveCount(2);
});

test("a file clicked opens in a tab of its own, and an open one comes to the front", async ({
  page,
}) => {
  await open(page);
  await row(page, "b.md").click();
  await expect(page.locator(`${editor} h1`)).toContainText("Bravo");
  await expect(page.locator(".tab-pill-title")).toHaveText(["a.md", "b.md"]);
  await row(page, "a.md").click();
  await expect(page.locator(`${editor} h1`)).toContainText("Alpha");
  await expect(page.locator(".tab-pill-title")).toHaveCount(2);
});

test("Open to the Side shows a document beside the one in front", async ({
  page,
}) => {
  await open(page);
  await row(page, "b.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open to the Side" }).click();
  const panes = page.locator(".main-pane-split > .split-pane");
  await expect(panes).toHaveCount(2);
  await expect(page.locator('.split-pane[data-pane="first"] h1')).toContainText(
    "Alpha",
  );
  await expect(
    page.locator('.split-pane[data-pane="second"] h1'),
  ).toContainText("Bravo");
});

test("a file dragged onto the lower half of the document opens below it", async ({
  page,
}) => {
  await open(page);
  const from = (await row(page, "b.md").boundingBox())!;
  const main = (await page.locator(".main-pane").boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(main.x + main.width / 2, main.y + main.height - 30, {
    steps: 8,
  });
  await expect(page.locator(".split-drop-hint")).toBeVisible();
  await page.mouse.up();
  const panes = page.locator(".main-pane-split > .split-pane");
  await expect(panes).toHaveCount(2);
  await expect(page.locator('.split-pane[data-pane="first"] h1')).toContainText(
    "Alpha",
  );
  await expect(
    page.locator('.split-pane[data-pane="second"] h1'),
  ).toContainText("Bravo");
  await expect(page.locator(".main-pane-split")).toHaveAttribute(
    "data-split",
    "column",
  );
  // The file stays where it was.
  expect(await files(page)).toContain("/work/notes/b.md");
});

test("Copy Path in the tree's and a tab's right-click menus and in File copies the full path", async ({
  page,
}) => {
  // What is written, read back the same in WebKit, which has no clipboard
  // permissions to grant.
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string };
    w.__copied = "";
    navigator.clipboard.writeText = async (text: string) => {
      w.__copied = text;
    };
  });
  await open(page);
  const clipboard = () =>
    page.evaluate(() => (window as unknown as { __copied: string }).__copied);

  await row(page, "b.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy Path" }).click();
  await expect.poll(clipboard).toBe("/work/notes/b.md");

  // A second tab, so the tab bar shows.
  await row(page, "b.md").click();
  await page
    .locator(".tab-pill", { hasText: "a.md" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy Path" }).click();
  await expect.poll(clipboard).toBe("/work/notes/a.md");

  // File > Copy Path: the document in front, b.md.
  await page.evaluate(() => Object.assign(window, { __copied: "" }));
  await expect(page.locator(".window-bar-title-text")).toHaveText("b.md");
  // As the native menu sends it (Rust's menu.rs does for the drawn one).
  await emit(page, "menu-copy-path");
  await expect.poll(clipboard).toBe("/work/notes/b.md");
});
