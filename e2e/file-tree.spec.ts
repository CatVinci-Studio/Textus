import { expect, test, type Page } from "@playwright/test";
import { dragWithMouse, emit, END, openApp } from "./helpers";

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

test("the Sort menu shows hidden files and sorts by name or by date modified; the filter keeps documents", async ({
  page,
}) => {
  await open(page, {
    "/work/notes/.obsidian/app.json": "{}",
    "/work/notes/.env": "x",
  });
  // Hidden files stay out of the tree until it shows them (#357).
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
  await page.getByRole("button", { name: "Sort" }).click();
  await page.getByRole("menuitemradio", { name: "Show Hidden Files" }).click();
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

test("New Document and New Folder are named in place: right-click, the toolbar, a double-click on the blank", async ({
  page,
}) => {
  await open(page);
  const draft = page.locator(".sidebar .tree-draft-input");
  // On a folder: inside it, under a name nothing there has.
  await row(page, "drafts").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New Document" }).click();
  await expect(draft).toHaveValue("Untitled");
  await expect(draft).toBeFocused();
  await draft.fill("Chapter 1");
  await draft.press("Enter");
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
  await draft.fill("Research");
  await draft.press("Enter");
  await expect(row(page, "Research")).toBeVisible();
  expect(await files(page)).toContain("/work/notes/Research/.keep");
  expect(await files(page)).toContain("/work/notes/drafts/Chapter 1.md");

  // Double-clicking the blank: a new document in the root, numbered past
  // one already there; clicking away keeps the name.
  await page.evaluate(() => {
    (window as unknown as { __devFs: Record<string, string> }).__devFs[
      "/work/notes/Untitled.md"
    ] = "";
  });
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.mouse.dblclick(body.x + 40, body.y + body.height - 20);
  await expect(draft).toHaveValue("Untitled 2");
  await page.locator(".sidebar .tree-root-label").click();
  await expect(row(page, "Untitled 2.md")).toBeVisible();

  // The toolbar's button; Escape gives it up.
  await page.getByRole("button", { name: "New Folder" }).click();
  await expect(draft).toHaveValue("New Folder");
  await draft.press("Escape");
  await expect(draft).toHaveCount(0);
  expect(await files(page)).not.toContain("/work/notes/New Folder/.keep");

  // A name already taken says so, and nothing is replaced.
  await page.getByRole("button", { name: "New Document" }).click();
  await expect(draft).toHaveValue("Untitled 3");
  await draft.fill("b");
  await draft.press("Enter");
  await expect(
    page.getByText("There is already something named “b” here."),
  ).toBeVisible();
});

test("an empty folder offers a button for its first document", async ({
  page,
}) => {
  await open(page, { "/work/notes/empty/.keep": "" });
  await row(page, "empty").dblclick();
  const make = page.locator(".sidebar .tree-empty").getByRole("button", {
    name: "New Document",
  });
  await make.click();
  await page.locator(".sidebar .tree-draft-input").press("Enter");
  await expect(row(page, "Untitled.md")).toBeVisible();
  await expect(make).toHaveCount(0);
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

const disk = (page: Page, path: string) =>
  page.evaluate(
    (p) =>
      (window as unknown as { __devFs: Record<string, string> }).__devFs[p],
    path,
  );

test("a rename asks before updating the links to it, outside a vault", async ({
  page,
}) => {
  await open(page, {
    "/work/notes/b.md": "# Bravo\r\n[o](drafts/old.md) [[old]]\r\n",
  });
  await row(page, "drafts").click();
  await row(page, "old.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Archive");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Rename" })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Update the links to and from “Archive.md” so they keep working?",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Update Links" })
    .click();
  await expect
    .poll(() => disk(page, "/work/notes/b.md"))
    .toBe("# Bravo\r\n[o](drafts/Archive.md) [[Archive]]\r\n");
});

test("in an Obsidian vault a moved note's links follow at once", async ({
  page,
}) => {
  await open(page, {
    "/work/notes/.obsidian/app.json": "{}",
    "/work/notes/b.md": "# Bravo\n![c](chart.png) [a](a.md)\n",
  });
  const from = (await row(page, "b.md").boundingBox())!;
  const to = (await row(page, "drafts").boundingBox())!;
  await page.mouse.move(from.x + 30, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 34, from.y + from.height / 2 - 6, {
    steps: 2,
  });
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(() => disk(page, "/work/notes/drafts/b.md"))
    .toBe("# Bravo\n![c](../chart.png) [a](../a.md)\n");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("in a vault whose settings the project took, the split preview breaks the line at a single newline", async ({
  page,
}) => {
  await open(page, {
    "/work/notes/.obsidian/app.json": "{}",
    "/work/notes/.textus/settings.json": JSON.stringify({
      conventions: { softBreaks: true, detected: "followed" },
    }),
    "/work/notes/a.md": "# Alpha\n\none\ntwo",
  });
  await emit(page, "menu-toggle-split-view");
  const tops = () =>
    page.evaluate(() => {
      const p = document.querySelector(
        '[data-active-tab="true"] .split-preview-breaks p',
      );
      if (!p) return null;
      const text = (node: ChildNode) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect().top;
      };
      return [text(p.firstChild!), text(p.lastChild!)];
    });
  await expect.poll(tops).not.toBeNull();
  const [one, two] = (await tops())!;
  expect(two).toBeGreaterThan(one);
});

test("a tree that follows the document offers its folder, and Close Folder closes the folder's documents", async ({
  page,
}) => {
  await open(page);
  // Following the document, the toolbar has one button to open its
  // folder as the folder, its tip naming whose folder it is.
  const openAs = page
    .locator(".sidebar")
    .getByRole("button", { name: "Open This Folder" });
  await expect(openAs).toHaveAccessibleDescription("Current document's folder");
  await expect(page.getByRole("button", { name: "Close Folder" })).toHaveCount(
    0,
  );
  await openAs.click();
  await expect(openAs).toHaveCount(0);
  await page.getByRole("button", { name: "Close Folder" }).click();
  // a.md was saved and inside the project: it closes, the window stays on
  // the start page.
  await expect(page.locator(".window-bar-title-text")).not.toHaveText("a.md");
  await expect(page.getByRole("region", { name: "Start" })).toBeVisible();
});

test("the tree shows files another app made once the window is back in front", async ({
  page,
}) => {
  await open(page);
  await expect(row(page, "a.md")).toBeVisible();
  await page.evaluate(() => {
    const files = (window as unknown as { __devFs: Record<string, string> })
      .__devFs;
    files["/work/notes/from-git.md"] = "# New";
    delete files["/work/notes/b.md"];
    window.dispatchEvent(new Event("focus"));
  });
  await expect(row(page, "from-git.md")).toBeVisible();
  await expect(row(page, "b.md")).toHaveCount(0);
});

test("files a .gitignore leaves out show dimmed, as the search leaves them out", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __devIgnored: string[] }).__devIgnored = [
      "/work/notes/chart.png",
      "/work/notes/drafts",
    ];
  });
  await open(page);
  await expect(row(page, "chart.png")).toHaveClass(/tree-row-ignored/);
  await expect(row(page, "drafts")).toHaveClass(/tree-row-ignored/);
  await expect(row(page, "b.md")).not.toHaveClass(/tree-row-ignored/);
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

test("a file dragged onto the lower half of the document opens below it, over a plugin's frame too", async ({
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

test("a file dragged across the document selects none of its text", async ({
  page,
}) => {
  await open(page);
  const from = (await row(page, "b.md").boundingBox())!;
  const text = (await page.locator(".ProseMirror h1").boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(text.x + text.width, text.y + 200, { steps: 12 });
  await expect(page.locator(".split-drop-hint")).toBeVisible();
  expect(await page.evaluate(() => String(window.getSelection()))).toBe("");
  await page.keyboard.press("Escape");
  await page.mouse.up();
});

test("Copy Path in the tree's and a tab's right-click menus and in File copies the full path, Copy Relative Path the one from the folder", async ({
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
  // And from the open folder.
  await row(page, "b.md").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy Relative Path" }).click();
  await expect.poll(clipboard).toBe("b.md");

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

test("a click looks in the preview tab; a double click or an edit keeps it", async ({
  page,
}) => {
  await open(page);
  // a.md, opened from Recent, is a tab of its own.
  const tabs = page.locator(".tab-bar .tab-pill");
  const count = 1;
  await rows(page).filter({ hasText: "b.md" }).click();
  await expect(page.locator(`${editor} h1`)).toContainText("Bravo");
  const look = page.locator(".tab-pill-looking");
  await expect(look).toHaveCount(1);
  await expect(tabs).toHaveCount(count + 1);
  // The next look takes the same tab.
  await rows(page).filter({ hasText: "drafts" }).click();
  await rows(page).filter({ hasText: "old.md" }).click();
  await expect(page.locator(`${editor} h1`)).toContainText("Old");
  await expect(tabs).toHaveCount(count + 1);
  // Written in, it stays; the next look gets a tab of its own.
  await page.locator(editor).click();
  await page.keyboard.press(END);
  await page.keyboard.type("er");
  await expect(look).toHaveCount(0);
  await rows(page).filter({ hasText: "b.md" }).click();
  await expect(tabs).toHaveCount(count + 2);
  await expect(look).toHaveCount(1);
  // A double click on the file keeps it too.
  await rows(page).filter({ hasText: "b.md" }).dblclick();
  await expect(look).toHaveCount(0);
});

test("a preview tab is clicked back to and closed like any other", async ({
  page,
}) => {
  await open(page);
  const tabs = page.locator(".tab-bar .tab-pill");
  await rows(page).filter({ hasText: "b.md" }).click();
  const look = page.locator(".tab-pill-looking");
  await expect(look).toHaveCount(1);
  // In front of it, a.md; a click on the preview tab brings it back.
  // A click in the middle of a short name's tab opens it, never closes it.
  await tabs.filter({ hasText: "a.md" }).click();
  await expect(page.locator(`${editor} h1`)).not.toContainText("Bravo");
  await look.click();
  await expect(page.locator(`${editor} h1`)).toContainText("Bravo");
  // Dragged along the bar, it moves as any tab does, and stays a preview.
  await dragWithMouse(page, look, tabs.filter({ hasText: "a.md" }), -30);
  await expect(tabs).toHaveText(["b.md", "a.md"]);
  await expect(look).toHaveCount(1);
  await look.hover();
  await look.locator(".tab-pill-close").click();
  await expect(look).toHaveCount(0);
  await expect(page.locator(".window-bar-title-text")).toHaveText("a.md");
});

test("two quick clicks on a folder's arrow fold and unfold it; a double click past it goes in", async ({
  page,
}) => {
  await open(page);
  const arrow = row(page, "drafts").locator(".chevron");
  await arrow.dblclick();
  await expect(page.locator(".sidebar .tree-root-label")).toHaveText("notes");
  await row(page, "drafts").locator(".tree-label").dblclick();
  await expect(page.locator(".sidebar .tree-root-label")).toHaveText("drafts");
});
