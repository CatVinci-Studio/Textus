import { expect, test, type Page } from "@playwright/test";
import { emit, selectionRead, END } from "./helpers";
import {
  hasPlugin,
  openPath,
  openSidebarList,
  openWithPlugins,
} from "./plugin-helpers";

/**
 * The writing-tool plugins, each loaded from the checkout the dev server serves.
 */

const editor = '[data-active-tab="true"] .ProseMirror';

const run = (page: Page, command: string) =>
  emit(page, "menu-plugin-command", command);

async function open(
  page: Page,
  id: string,
  grants: string[],
  text: string,
): Promise<void> {
  await openWithPlugins(page, {
    plugins: { [id]: grants },
    folder: { "/work/doc.md": text },
  });
  await openPath(page, "/work/doc.md");
  await expect(page.locator(editor)).toBeVisible();
}

test("Markdown Lint underlines a heading's trailing colon, and Fix takes it off", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.markdown-lint"), "not in this checkout");
  await open(
    page,
    "catvinci.markdown-lint",
    ["editor.read", "editor.write"],
    "# Doc\n\n## Notes:\n\nText.\n",
  );
  const mark = page.locator(`${editor} .plugin-mark-underline`);
  await expect(mark.first()).toBeVisible({ timeout: 15_000 });
  await expect(mark.first()).toHaveAttribute("title", /MD026/);
  await run(page, "catvinci.markdown-lint.fix");
  await expect(page.locator(`${editor} h2`)).toHaveText("Notes");
});

test("Heading Numbers numbers the headings, and an export carries them", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.heading-numbers"), "not in this checkout");
  await open(
    page,
    "catvinci.heading-numbers",
    ["editor.read"],
    "# Title\n\n## One\n\n## Two\n\n### Two A\n",
  );
  const numbers = page.locator(`${editor} .plugin-mark-badge-before`);
  await expect(numbers).toHaveText(["1", "2", "2.1"], { timeout: 15_000 });

  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
      };
      __written?: string;
      __devEmitTauriEvent: (n: string) => void;
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "export_save_dialog") return Promise.resolve("/tmp/n.html");
      if (cmd === "write_text_file") {
        w.__written = String(args?.contents ?? "");
        return Promise.resolve();
      }
      return invoke(cmd, args);
    };
    w.__devEmitTauriEvent("menu-export-html");
  });
  const written = () =>
    page.evaluate(
      () => (window as unknown as { __written?: string }).__written ?? "",
    );
  await expect.poll(written).toContain("counter(tx-h2)");
  // The editor's own numbers aren't copied in: the export's CSS draws them.
  const marks = await page.evaluate(
    (html) =>
      new DOMParser()
        .parseFromString(html, "text/html")
        .querySelectorAll("[data-plugin]").length,
    await written(),
  );
  expect(marks).toBe(0);
});

test("Templates inserts one at the caret, its title filled in", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.templates"), "not in this checkout");
  await open(
    page,
    "catvinci.templates",
    ["files.read", "files.write", "editor.read", "editor.write"],
    "# Doc\n\nEnd.\n",
  );
  await page.locator(`${editor} p`).click();
  await page.keyboard.press(END);
  await page.keyboard.press("Enter");
  await run(page, "catvinci.templates.insert");
  const pick = page.getByRole("dialog", { name: "Choose a template" });
  await expect(pick.getByRole("option")).toContainText(["Meeting Notes"]);
  await page.keyboard.press("Enter");
  await expect(page.locator(`${editor} h2`).first()).toHaveText("Attendees");
  await expect(page.locator(editor)).toContainText("doc");
});

test("Templates adds its item to a file's right-click menu", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.templates"), "not in this checkout");
  await open(
    page,
    "catvinci.templates",
    ["files.read", "files.write", "editor.read", "editor.write"],
    "# Doc\n",
  );
  if (await page.locator(".sidebar.sidebar-collapsed").count())
    await emit(page, "menu-toggle-sidebar");
  await page
    .locator(".sidebar .tree-main .tree-row", { hasText: "doc.md" })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "New from Template…" }),
  ).toBeVisible();
});

test("Bookmarks keeps the words selected, listed in the sidebar", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.bookmarks"), "not in this checkout");
  await open(
    page,
    "catvinci.bookmarks",
    ["editor.read", "files.read"],
    "# Doc\n\nA remarkable sentence here.\n",
  );
  await page.locator(`${editor} p`).click();
  await page.keyboard.press(END);
  await page.keyboard.press("Shift+Home");
  // The command reads the editor's selection: once the editor has it.
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe("A remarkable sentence here.");
  await selectionRead(page);
  await run(page, "catvinci.bookmarks.add");
  const list = await openSidebarList(page, "Bookmarks");
  await expect(list).toContainText("A remarkable sentence here.");
  await expect(list).toContainText("doc.md");
});

test("Clipboard History lists what is copied or cut in a document, and a click puts it in again", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.clipboard-history"), "not in this checkout");
  await open(
    page,
    "catvinci.clipboard-history",
    ["clipboard", "editor.write"],
    "# Doc\n\nFirst words.\n\nSecond words.\n",
  );
  const list = await openSidebarList(page, "Clipboard History");
  await expect(list).toContainText("Nothing yet");
  await page.locator(`${editor} p`).first().click({ clickCount: 3 });
  await page.keyboard.press("ControlOrMeta+c");
  await page.locator(`${editor} p`).nth(1).click({ clickCount: 3 });
  await page.keyboard.press("ControlOrMeta+x");
  await expect(page.locator(editor)).not.toContainText("Second words.");
  // The newest first.
  await expect(list.getByRole("treeitem")).toHaveText([
    "Second words.",
    "First words.",
  ]);
  await list.getByRole("treeitem", { name: "First words." }).click();
  await expect(page.locator(`${editor} p`).nth(1)).toHaveText("First words.");
});
