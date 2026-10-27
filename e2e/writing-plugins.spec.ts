import { expect, test, type Page } from "@playwright/test";
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
  page.evaluate(
    (id) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (n: string, p: unknown) => void;
        }
      ).__devEmitTauriEvent("menu-plugin-command", id),
    command,
  );

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

test("CJK Spacing spaces Chinese from English, as one change", async ({
  page,
}) => {
  test.skip(!hasPlugin("catvinci.cjk-spacing"), "not in this checkout");
  await open(
    page,
    "catvinci.cjk-spacing",
    ["editor.read", "editor.write", "files.write"],
    "# 文档\n\n用Textus写作。\n",
  );
  await run(page, "catvinci.cjk-spacing.space");
  await expect(page.locator(`${editor} p`)).toHaveText("用 Textus 写作。");
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
  await page.keyboard.press("End");
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
    await page.evaluate(() =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent("menu-toggle-sidebar"),
    );
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
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await run(page, "catvinci.bookmarks.add");
  const list = await openSidebarList(page, "Bookmarks");
  await expect(list).toContainText("A remarkable sentence here.");
  await expect(list).toContainText("doc.md");
});
