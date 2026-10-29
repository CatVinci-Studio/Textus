import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// Issue #78: files dropped on the window from a file manager. Tauri hands
// the drop over as a `tauri://drag-drop` event with the files' paths, which
// the dev shim fires the way Rust would; reading the files is canned.

const editor = '[data-active-tab="true"] .ProseMirror';

// A 1x1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function drop(page: Page, paths: string[], position = { x: 0, y: 0 }) {
  return page.evaluate(
    (payload) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent("tauri://drag-drop", payload),
    { paths, position },
  );
}

function emit(page: Page, name: string) {
  return page.evaluate(
    (n) =>
      (
        window as unknown as { __devEmitTauriEvent: (name: string) => void }
      ).__devEmitTauriEvent(n),
    name,
  );
}

/** The active document's Markdown, read from source mode (and back). */
async function sourceOf(page: Page): Promise<string> {
  await emit(page, "menu-toggle-source-mode");
  const textarea = page.locator(
    '[data-active-tab="true"] textarea.source-view',
  );
  await expect(textarea).toBeAttached();
  const value = await textarea.inputValue();
  await emit(page, "menu-toggle-source-mode");
  await expect(textarea).toHaveCount(0);
  return value.trim();
}

test.beforeEach(async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
});

test("a dropped Markdown file opens like File > Open", async ({ page }) => {
  await mockInvoke(page, { read_text_file: "# Dropped\n\nFrom Explorer." });
  await drop(page, ["C:\\Users\\me\\notes.md"]);
  await expect(page.locator(`${editor} h1`)).toContainText("Dropped");
  await expect(page.locator(editor)).toContainText("From Explorer.");
});

test("several dropped files each open in a tab", async ({ page }) => {
  await mockInvoke(page, { read_text_file: "Some text." });
  // A fresh window: its one Untitled tab gives way to the first.
  await expect(page.locator(".ProseMirror")).toHaveCount(1);
  await drop(page, ["/home/me/a.md", "/home/me/b.txt"]);
  await expect(page.locator(".tab-pill-title")).toHaveText(["a.md", "b.txt"]);
  await expect(page.locator(editor)).toContainText("Some text.");
});

test("a dropped document opens beside the one being read, never in its place", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as unknown as { __devFiles: Record<string, string> }).__devFiles = {
      "/home/me/first.md": "# First\n\nThe first file.",
      "/home/me/second.md": "# Second\n\nThe second file.",
    };
  });
  await drop(page, ["/home/me/first.md"]);
  await expect(page.locator(editor)).toContainText("The first file.");
  // Window mode (the default) puts File > Open in place of the document;
  // a drop opens beside it.
  await drop(page, ["/home/me/second.md"]);
  await expect(page.locator(editor)).toContainText("The second file.");
  await expect(page.locator(".tab-pill-title")).toHaveText([
    "first.md",
    "second.md",
  ]);
});

test("a dropped image goes into the document", async ({ page }) => {
  await page.locator(editor).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await mockInvoke(page, {
    read_binary_file_base64: PNG,
    save_pasted_image: { src: "assets/dropped.png" },
  });
  const box = (await page.locator(editor).boundingBox())!;
  await drop(page, ["/home/me/shot.png"], {
    x: box.x + 20,
    y: box.y + 10,
  });
  await expect(page.locator(`${editor} .image-view img`)).toHaveCount(1);
  expect(await sourceOf(page)).toBe("![](assets/dropped.png)");
});

test("a dropped image lands where it was dropped, not at the caret", async ({
  page,
}) => {
  await page.locator(editor).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("First");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second");
  await mockInvoke(page, {
    read_binary_file_base64: PNG,
    save_pasted_image: { src: "assets/dropped.png" },
  });
  const first = (await page.locator(`${editor} p`).first().boundingBox())!;
  await drop(page, ["/home/me/shot.png"], {
    x: first.x + 2,
    y: first.y + first.height / 2,
  });
  await expect(page.locator(`${editor} .image-view img`)).toHaveCount(1);
  const source = await sourceOf(page);
  expect(source.indexOf("![](assets/dropped.png)")).toBeLessThan(
    source.indexOf("Second"),
  );
});

test("a dropped folder opens in the sidebar, as Open Folder does", async ({
  page,
}) => {
  await page.evaluate(() =>
    Object.assign(window, {
      __devFs: {
        "/notes/trip/day1.md": "# Day one",
        "/notes/trip/day2.md": "# Day two",
      },
    }),
  );
  await drop(page, ["/notes/trip"]);
  const tree = page.locator(".sidebar .tree-main .tree-row");
  await expect(tree.filter({ hasText: "day1.md" })).toBeVisible();
  await expect(tree.filter({ hasText: "day2.md" })).toBeVisible();
});
