import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

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

const editorOf = (page: Page) =>
  page.locator('[data-active-tab="true"] .ProseMirror');

/** The text of the caret's paragraph with "|" at the caret. */
function caretLine(page: Page): Promise<string> {
  return page.evaluate(() => {
    const sel = document.getSelection()!;
    const block = sel.anchorNode!.parentElement!.closest("p, td, th")!;
    const range = document.createRange();
    range.setStart(block, 0);
    range.setEnd(sel.anchorNode!, sel.anchorOffset);
    const before = range.toString();
    return before + "|" + block.textContent!.slice(before.length);
  });
}

test("brackets committed by an input method close themselves too", async ({
  page,
  browserName,
}) => {
  // Compositions are sent over the Chrome DevTools Protocol; the unit
  // tests play WebKitGTK's deleteCompositionText + insertFromComposition.
  test.skip(browserName !== "chromium");
  await openApp(page, { settings: { language: "en" } });
  const editor = editorOf(page);
  await editor.click();
  const cdp = await page.context().newCDPSession(page);
  const compose = async (preedit: string, committed: string) => {
    await cdp.send("Input.imeSetComposition", {
      text: preedit,
      selectionStart: preedit.length,
      selectionEnd: preedit.length,
    });
    await cdp.send("Input.insertText", { text: committed });
    // Past the post-commit pairing (40ms) before the next composition.
    await page.waitForTimeout(100);
  };
  await compose("（", "（");
  expect(await caretLine(page)).toBe("（|）");
  await compose("nihao", "你好");
  expect(await caretLine(page)).toBe("（你好|）");
  await compose("）", "）");
  expect(await caretLine(page)).toBe("（你好）|");
  await compose("shu<", "书《");
  await compose("ming", "名");
  await compose("》", "》");
  expect(await sourceOf(page)).toBe("（你好）书《名》");
});

test("the setting is in Editor & Appearance, on by default", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-settings");
  const panel = page.getByRole("dialog", { name: "Settings" });
  await panel.getByRole("button", { name: "Editor & Appearance" }).click();
  const toggle = panel.getByRole("checkbox", {
    name: "Close (), [] and “”",
  });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}")
            .autoCloseBrackets,
      ),
    )
    .toBe(false);
});
