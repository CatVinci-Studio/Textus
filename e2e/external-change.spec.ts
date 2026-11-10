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
