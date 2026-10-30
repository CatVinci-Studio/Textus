import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// Save Automatically: a file-backed document is written back once typing
// rests; with it off nothing is written, and a file changed on disk is never
// overwritten. Files live in the page, each mtime moving on every write.

const editor = '[data-active-tab="true"] .ProseMirror';
const PATH = "/home/me/notes.md";

interface Disk {
  files: Record<string, { text: string; mtime: number }>;
  writes: string[];
}

async function installDisk(page: Page, text: string) {
  await page.evaluate(
    ({ path, text }) => {
      const w = window as unknown as Record<string, unknown> & {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
        };
      };
      const disk: Disk = { files: { [path]: { text, mtime: 1 } }, writes: [] };
      w.__disk = disk;
      const original = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = (cmd, args = {}) => {
        const file = disk.files[String(args.path)];
        switch (cmd) {
          case "read_text_file":
            if (file) return Promise.resolve(file.text);
            break;
          case "file_mtime_ms":
            return Promise.resolve(file?.mtime ?? null);
          case "write_text_file":
            disk.files[String(args.path)] = {
              text: String(args.contents),
              mtime: (file?.mtime ?? 0) + 1,
            };
            disk.writes.push(String(args.contents));
            return Promise.resolve(null);
        }
        return original(cmd, args);
      };
    },
    { path: PATH, text },
  );
}

const disk = (page: Page) =>
  page.evaluate(() => (window as unknown as { __disk: Disk }).__disk);

async function openDoc(page: Page) {
  await page.evaluate(
    (paths) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent("tauri://drag-drop", {
        paths,
        position: { x: 0, y: 0 },
      }),
    [PATH],
  );
  await expect(page.locator(editor)).toContainText("Saved text.");
}

async function typeAtEnd(page: Page, text: string) {
  await page.locator(`${editor} p`).last().click();
  // The document's end, wherever a click under load landed.
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

test("an edited document is written back once typing rests", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", autosave: true } });
  await installDisk(page, "# Notes\r\n\r\nSaved text.\r\n");
  await openDoc(page);
  await typeAtEnd(page, " More.");
  await expect
    .poll(async () => (await disk(page)).writes, { timeout: 6000 })
    .toHaveLength(1);
  // File > Save's writer: the file keeps its CRLF line endings.
  expect((await disk(page)).files[PATH].text).toBe(
    "# Notes\r\n\r\nSaved text. More.\r\n",
  );
  await expect(page.locator(".unsaved-dot, .tab-pill-dirty-dot")).toHaveCount(
    0,
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(editor)).not.toContainText("More.");
});

test("an edit leaves the rest of the file as it was written", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", autosave: true } });
  const text =
    "Notes\n=====\n\n_em_ and a snake_case [link][r].\n\n[r]: https://x.org\n\nSaved text.\n";
  await installDisk(page, text);
  await openDoc(page);
  await typeAtEnd(page, " More.");
  await expect
    .poll(async () => (await disk(page)).writes, { timeout: 6000 })
    .toEqual([text.replace("Saved text.", "Saved text. More.")]);
});

test("with the setting off nothing is written", async ({ page }) => {
  // The autosave delay passes on the page's clock, not in real time.
  await page.clock.install();
  await openApp(page, { settings: { language: "en" } });
  await installDisk(page, "# Notes\n\nSaved text.\n");
  await openDoc(page);
  await typeAtEnd(page, " More.");
  await page.clock.runFor(3500);
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("tauri://blur"),
  );
  await page.clock.runFor(500);
  expect((await disk(page)).writes).toEqual([]);
  await expect(page.locator(".unsaved-dot")).toBeVisible();
});

test("leaving the window writes at once", async ({ page }) => {
  await openApp(page, { settings: { language: "en", autosave: true } });
  await installDisk(page, "# Notes\n\nSaved text.\n");
  await openDoc(page);
  await typeAtEnd(page, " More.");
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("tauri://blur"),
  );
  await expect
    .poll(async () => (await disk(page)).writes, { timeout: 1000 })
    .toEqual(["# Notes\n\nSaved text. More.\n"]);
});

test("a file changed on disk is not overwritten", async ({ page }) => {
  await page.clock.install();
  await openApp(page, { settings: { language: "en", autosave: true } });
  await installDisk(page, "# Notes\n\nSaved text.\n");
  await openDoc(page);
  // Another program writes the file while the document is open.
  await page.evaluate((path) => {
    const files = (window as unknown as { __disk: Disk }).__disk.files;
    files[path] = { text: "Changed elsewhere.\n", mtime: 50 };
  }, PATH);
  await typeAtEnd(page, " More.");
  await page.clock.runFor(3500);
  const prompt = page.getByRole("dialog", { name: "File Changed on Disk" });
  await expect(prompt).toBeVisible();
  // The user didn't ask for this save: Enter on the way back keeps the
  // disk's version rather than overwriting it.
  await expect(prompt.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(prompt).toBeHidden();
  // Typing on doesn't bring the prompt back every few seconds.
  await typeAtEnd(page, " Again.");
  await page.clock.runFor(3500);
  await expect(prompt).toBeHidden();
  const { files, writes } = await disk(page);
  expect(writes).toEqual([]);
  expect(files[PATH].text).toBe("Changed elsewhere.\n");
});

test("a file another app changes reloads while the window shows, without a click back", async ({
  page,
}) => {
  await page.clock.install();
  await openApp(page, { settings: { language: "en" } });
  await installDisk(page, "# Notes\n\nSaved text.\n");
  await openDoc(page);
  await page.evaluate((path) => {
    const files = (window as unknown as { __disk: Disk }).__disk.files;
    files[path] = { text: "# Notes\n\nWritten elsewhere.\n", mtime: 50 };
  }, PATH);
  await page.clock.runFor(2000);
  await expect(page.locator(editor)).toContainText("Written elsewhere.");
});

test("an edited document is left as it is when its file changes elsewhere", async ({
  page,
}) => {
  await page.clock.install();
  await openApp(page, { settings: { language: "en" } });
  await installDisk(page, "# Notes\n\nSaved text.\n");
  await openDoc(page);
  await typeAtEnd(page, " Mine.");
  await page.evaluate((path) => {
    const files = (window as unknown as { __disk: Disk }).__disk.files;
    files[path] = { text: "# Notes\n\nWritten elsewhere.\n", mtime: 50 };
  }, PATH);
  await page.clock.runFor(2000);
  await expect(page.locator(editor)).toContainText("Saved text. Mine.");
});
