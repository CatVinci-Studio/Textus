import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";
import { openPath } from "./plugin-helpers";

// A file changed on disk while its tab is open and has nothing unsaved -
// another app, or an outside agent writing it mid-conversation: the editor
// takes the new text where it is, not rebuilt, so what it holds (an AI
// conversation, the undo history) goes on.

test("an open document changed on disk takes the new text in place", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = { "/work/rain.md": "# Rain\n\nThree days of rain.\n" };
  });
  await openApp(page);
  await openPath(page, "/work/rain.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor.locator("h1")).toContainText("Rain");
  await editor.evaluate((e) => ((e as HTMLElement).dataset.mark = "kept"));

  // Written elsewhere: new text, a new time.
  await page.evaluate(() => {
    const w = window as unknown as {
      __devFs: Record<string, string>;
      __devFsTimes?: Record<string, number>;
    };
    w.__devFs["/work/rain.md"] = "# Flood\n\nThree days of rain.\n";
    w.__devFsTimes = { ...w.__devFsTimes, "/work/rain.md": 99 };
    window.dispatchEvent(new Event("textus:file-written"));
  });
  await expect(editor.locator("h1")).toContainText("Flood");
  await expect(editor).toHaveAttribute("data-mark", "kept");
  // Taken as what is on disk: nothing unsaved.
  await expect(page.locator(".tab-pill-dirty-dot")).toHaveCount(0);
});

test("with unsaved changes, saving over a file changed elsewhere offers to take its text instead", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = { "/work/rain.md": "# Rain\n\nThree days of rain.\n" };
  });
  await openApp(page, { settings: { language: "en" } });
  await openPath(page, "/work/rain.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Mine.");
  await page.evaluate(() => {
    const w = window as unknown as {
      __devFs: Record<string, string>;
      __devFsTimes?: Record<string, number>;
    };
    w.__devFs["/work/rain.md"] = "# Flood\n\nThree days of rain.\n";
    w.__devFsTimes = { ...w.__devFsTimes, "/work/rain.md": 99 };
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string) => void;
      }
    ).__devEmitTauriEvent("menu-save-file");
  });
  const dialog = page.locator(".app-dialog");
  await expect(dialog.getByRole("button")).toHaveText([
    "Cancel",
    "Reload",
    "Overwrite",
  ]);
  await dialog.getByRole("button", { name: "Reload" }).click();
  await expect(editor.locator("h1")).toContainText("Flood");
  await expect(editor).not.toContainText("Mine.");
  await expect(page.locator(".tab-pill-dirty-dot")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __devFs: Record<string, string> }).__devFs[
          "/work/rain.md"
        ],
    ),
  ).toContain("Flood");
});

test("coming back from another app leaves the document where it was read", async ({
  page,
}) => {
  const long = Array.from({ length: 200 }, (_, i) => `Line ${i}.`).join("\n\n");
  await page.addInitScript((text) => {
    (window as unknown as Record<string, unknown>).__devFs = {
      "/work/long.md": `# Long\n\n${text}\n`,
    };
  }, long);
  await openApp(page);
  await openPath(page, "/work/long.md");
  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("Line 199");
  await scroller.evaluate((el) => (el.scrollTop = 600));
  // Away, then back: the webview scrolls to the caret as it gives the
  // editor its focus back.
  type Dev = { __devEmitTauriEvent(name: string, payload?: unknown): void };
  await page.evaluate(() =>
    (window as unknown as Dev).__devEmitTauriEvent("tauri://blur"),
  );
  await page.evaluate(() => {
    (window as unknown as Dev).__devEmitTauriEvent("tauri://focus");
    const el = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .editor-scroll',
    )!;
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(600);
});
