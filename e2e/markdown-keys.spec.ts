import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// Typing Markdown by hand and the keys around blocks: what each keystroke
// leaves in the document, read back from source mode.

const editor = '[data-active-tab="true"] .ProseMirror';

function emit(page: Page, name: string, payload?: unknown) {
  return page.evaluate(
    ([n, p]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(n as string, p),
    [name, payload] as const,
  );
}

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

/** The app with `markdown` opened from a file (a paste could leave an
 *  empty line around it), or an empty document to type in. */
async function open(page: Page, markdown = "") {
  await openApp(page, { settings: { language: "en" } });
  if (!markdown) {
    await page.locator(editor).click();
    return;
  }
  const path = "/notes/keys.md";
  await page.evaluate(
    (files) =>
      ((window as unknown as Record<string, unknown>).__devFiles = files),
    { [path]: markdown },
  );
  await emit(page, "tauri://drag-drop", {
    paths: [path],
    position: { x: 0, y: 0 },
  });
  await expect(page.locator(`${editor} > *`).first()).toBeVisible();
  await expect(page.locator(editor)).not.toHaveText("");
}

test("* and *** start a list and a rule, as - and --- do; seven #s are no heading", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("* item", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("***", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("####### seven", { delay: 20 });
  await expect(page.locator(`${editor} li`)).toHaveText(["item"]);
  await expect(page.locator(`${editor} hr`)).toHaveCount(1);
  expect(await sourceOf(page)).toBe("* item\n\n---\n\n####### seven");
});

test("Shift+Enter in a heading starts a new line below it, in a code block a new line in it", async ({
  page,
}) => {
  await open(page, "# Title\n\n```\ncode\n```");
  await page.locator(`${editor} h1`).click();
  await page.keyboard.press("End");
  await page.keyboard.down("Shift");
  // Held, not pressed with Enter (block-keys-plugin.ts's SHIFT_OVERLAP_MS).
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await page.keyboard.type("body", { delay: 20 });
  await page.locator(`${editor} pre code`).click();
  await page.keyboard.press("End");
  await page.keyboard.down("Shift");
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await page.keyboard.type("more", { delay: 20 });
  expect(await sourceOf(page)).toBe("# Title\n\nbody\n\n```\ncode\nmore\n```");
});

test("text typed after a wikilink or inside inline code at Enter stays out of the node", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("See [[Note]] here", { delay: 20 });
  await expect(page.locator(`${editor} .wikilink`)).toHaveText("[[Note]]");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A `split` b", { delay: 20 });
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  expect(await sourceOf(page)).toBe("See [[Note]] here\n\nA `sp`\n\n`lit` b");
});

/** Once ProseMirror has read a selection made by the keyboard - it does
 *  from the selectionchange event that follows. */
const selectionRead = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );

/** The caret at the start of the code block's first line, from the
 *  paragraph above it. */
async function toCodeStart(page: Page) {
  await page.locator(`${editor} p`).getByText("Before").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
}

test("Tab and Shift+Tab indent and outdent the selected lines of a code block, keeping the focus", async ({
  page,
}) => {
  await open(page, "Before\n\n```\none\ntwo\nthree\n```");
  await toCodeStart(page);
  // Down to the start of "three", which stays as it is.
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await selectionRead(page);
  await page.keyboard.press("Tab");
  expect(await sourceOf(page)).toBe("Before\n\n```\n  one\n  two\nthree\n```");
  await toCodeStart(page);
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(editor)).toBeFocused();
  expect(await sourceOf(page)).toBe("Before\n\n```\none\n  two\nthree\n```");
});

test("the arrows leave a table that starts or ends the document from any cell", async ({
  page,
}) => {
  await open(page, "| a | b |\n| - | - |\n| c | d |");
  await page.locator(`${editor} td p`).first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("below", { delay: 20 });
  await page.locator(`${editor} th p`).last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("above", { delay: 20 });
  expect(await sourceOf(page)).toBe(
    "above\n\n| a | b |\n| - | - |\n| c | d |\n\nbelow",
  );
});
