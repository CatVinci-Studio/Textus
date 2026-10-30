import { expect, test, type Page } from "@playwright/test";
import { END, HOME, openApp, selectionRead } from "./helpers";

// The keys around blocks that need a browser: the arrows, clicks and
// focus. What a typed key does to the document is tested in vitest
// (src/editor/keys/markdown-keys.test.ts).

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
  // No ghost text: a suggestion arriving mid-flow, under load, moves the
  // caret and the selection these flows read.
  await openApp(page, {
    settings: { language: "en", enableCompletion: false },
  });
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

test("the arrows leave a table that starts or ends the document from any cell", async ({
  page,
}) => {
  await open(page, "| a | b |\n| - | - |\n| c | d |");
  await page.locator(`${editor} td p`).first().click();
  await page.keyboard.press(END);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("below", { delay: 20 });
  await page.locator(`${editor} th p`).last().click();
  await page.keyboard.press(END);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("above", { delay: 20 });
  expect(await sourceOf(page)).toBe(
    "above\n\n| a | b |\n| - | - |\n| c | d |\n\nbelow",
  );
});

test("~~~ opens a code block, --- on the first line front matter, 1) a list; === stays text", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("---", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("title: x", { delay: 20 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("1) one", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("~~~py", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("x = 1", { delay: 20 });
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.type("=== and ~~gone~~", { delay: 20 });
  await expect(page.locator(`${editor} mark`)).toHaveCount(0);
  expect(await sourceOf(page)).toBe(
    "---\ntitle: x\n---\n\n1. one\n\n```py\nx = 1\n```\n\n\\=== and ~~gone~~",
  );
});

test("Tab and Shift+Tab in a paragraph leave the focus in the text", async ({
  page,
}) => {
  await open(page, "Some text\n");
  await page.locator(`${editor} p`).first().click();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(editor)).toBeFocused();
  await page.keyboard.type("!", { delay: 20 });
  expect(await sourceOf(page)).toMatch(/!/);
});

test("Format › Ordered List turns a bullet list into one, every item", async ({
  page,
}) => {
  await open(page, "- one\n- two\n");
  await page.locator(`${editor} li`).first().click();
  await emit(page, "menu-insert-block", "ordered-list");
  expect(await sourceOf(page)).toBe("1. one\n2. two");
});

test("Left steps one character onto inline HTML, as Right does", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("ab <b>XY</b> cd", { delay: 20 });
  // Back over "cd" and the space, onto "</b>": its source shows, the
  // caret after its ">".
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("!", { delay: 20 });
  // And one more: into the tag, not past "XY" and "<b>".
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("?", { delay: 20 });
  expect(await sourceOf(page)).toBe("ab <b>XY</?b>! cd");
});

test("one Right from before bold-italic is inside it, all its marks showing", async ({
  page,
}) => {
  await open(page, "ab ***XY*** cd\n");
  await page.locator(`${editor} p`).first().click();
  await selectionRead(page);
  await page.keyboard.press(HOME);
  await selectionRead(page);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowRight");
    await selectionRead(page);
  }
  await expect(page.locator(`${editor} .enclosure-delimiter`)).toHaveText([
    "*",
    "**",
    "**",
    "*",
  ]);
  await page.keyboard.press("ArrowRight");
  await selectionRead(page);
  await page.keyboard.type("!", { delay: 20 });
  expect(await sourceOf(page)).toBe("ab ***!XY*** cd");
});

test("a double click on a bold or italic word selects that word", async ({
  page,
}) => {
  // The first press reveals the span's ** and moves the text along; WebKit
  // took the second press for a delimiter or the next word.
  await open(page, "plain **bold** and *it* here, **粗体文字**");
  const selected = () => page.evaluate(() => getSelection()?.toString());
  await page.locator(`${editor} strong`).first().dblclick();
  await expect.poll(selected).toBe("bold");
  await page.locator(`${editor} em`).dblclick();
  await expect.poll(selected).toBe("it");
  // Bold-italic is italic around bold: a double click at the word's edge,
  // between the two spans, still finds it in the inner one.
  await open(page, "edge ***world*** here");
  await page.locator(`${editor} em`).dblclick({ position: { x: 1, y: 8 } });
  await expect.poll(selected).toBe("world");
  await open(page, "plain **bold** and *it* here, **粗体文字**");
  // Chinese is cut into words, as a double click on plain text cuts it:
  // the first word, never a delimiter.
  await page
    .locator(`${editor} strong`)
    .nth(1)
    .dblclick({ position: { x: 4, y: 8 } });
  const word = await selected();
  expect(word).toMatch(/^粗/);
  expect("粗体文字".startsWith(word!)).toBe(true);
});

test("Backspace right after a link takes one character of its source, not the link", async ({
  page,
}) => {
  await open(page, "see [Textus](https://a.com) end");
  await expect(page.locator(`${editor} a`)).toHaveCount(1);
  // The caret where ProseMirror puts it just after the link.
  await page.evaluate((sel) => {
    const pm = document.querySelector(sel) as HTMLElement & {
      pmViewDesc: {
        node: { firstChild: { child: (i: number) => { nodeSize: number } } };
        domFromPos: (
          pos: number,
          side: number,
        ) => { node: Node; offset: number };
      };
    };
    const paragraph = pm.pmViewDesc.node.firstChild;
    const after = 1 + paragraph.child(0).nodeSize + paragraph.child(1).nodeSize;
    const { node, offset } = pm.pmViewDesc.domFromPos(after, 0);
    pm.focus();
    getSelection()!.collapse(node, offset);
  }, editor);
  await selectionRead(page);
  await page.keyboard.press("Backspace");
  await expect(page.locator(editor)).toContainText(
    "[Textus](https://a.com end",
  );
});

test("``` typed on a line of its own reads as a fence, not as code", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.type("```", { delay: 20 });
  const span = page.locator(`${editor} .md-code-span`);
  await expect(span).toHaveClass(/is-fence/);
  const look = await span.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(look).toBe("rgba(0, 0, 0, 0)");
  await open(page);
  await page.keyboard.type("a `x`", { delay: 20 });
  await expect(page.locator(`${editor} .md-code-span`)).toHaveCount(1);
  await expect(page.locator(`${editor} .md-code-span`)).not.toHaveClass(
    /is-fence/,
  );
});
