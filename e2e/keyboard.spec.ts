import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * The window without a mouse: F6 through the regions and back to the
 * caret, the arrow keys in the sidebar's trees, the tab strip and the
 * context menu, Escape closing what is on top and the focus going back,
 * and Textus AI's changes stepped through and decided from the keyboard.
 */

/** Long enough between its headings that a jump to one scrolls. */
const filler = Array(30).fill("A paragraph of the note.").join("\n\n");

const FILES: Record<string, string> = {
  "/work/notes/a.md": `# Alpha\n\nFirst note.\n\n## Part one\n\n${filler}\n\n## Part two\n\n${filler}`,
  "/work/notes/b.md": "# Beta",
  "/work/notes/novel/ch1.md": "# Chapter one",
};

const editor = '[data-active-tab="true"] .ProseMirror';

function emit(page: Page, event: string, payload?: unknown) {
  return page.evaluate(
    ([name, value]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent(name as string, value),
    [event, payload] as const,
  );
}

async function open(page: Page, storage: Record<string, string> = {}) {
  await page.addInitScript((files) => {
    (window as unknown as { __devFs: unknown }).__devFs = files;
  }, FILES);
  await openApp(page, { settings: { language: "en" }, storage });
}

async function openFolder(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __devPickFolder: string }).__devPickFolder =
      "/work/notes";
  });
  await emit(page, "menu-open-folder");
  await expect(page.getByRole("tree", { name: "Files" })).toBeVisible();
}

/** Where the focus is: the closest named region or control. */
function focusedIn(page: Page, selector: string) {
  return page.evaluate((s) => !!document.activeElement?.closest(s), selector);
}

test("F6 and Shift+F6 go round the regions and back to the caret", async ({
  page,
}) => {
  await open(page, { "textus-agent-panel-open": "1" });
  await openFolder(page);
  await page.locator(editor).click();
  await page.keyboard.type("Hello");
  const order = [".agent-panel", ".window-bar", ".sidebar", editor];
  for (const region of order) {
    await page.keyboard.press("F6");
    expect(await focusedIn(page, region), region).toBe(true);
  }
  // Back in the text where the caret was.
  await page.keyboard.type(" world");
  await expect(page.locator(`${editor} p`).first()).toHaveText("Hello world");
  for (const region of [...order].reverse().slice(1)) {
    await page.keyboard.press("Shift+F6");
    expect(await focusedIn(page, region), region).toBe(true);
  }
});

test("the file tree walks with the arrow keys, opens folders and files", async ({
  page,
}) => {
  await open(page);
  await openFolder(page);
  const tree = page.getByRole("tree", { name: "Files" });
  // One stop in the tab order.
  await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
  const novel = tree.getByRole("treeitem", { name: "novel" });
  await novel.focus();
  await expect(novel).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(novel).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tree.getByRole("treeitem", { name: "ch1.md" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(novel).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(novel).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("End");
  await expect(tree.getByRole("treeitem", { name: "b.md" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.locator(`${editor} h1`)).toContainText("Alpha");
  await expect(tree.getByRole("treeitem", { name: "a.md" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("the outline folds and jumps from the keyboard", async ({ page }) => {
  await open(page);
  await openFolder(page);
  await page.getByRole("treeitem", { name: "a.md" }).click();
  await page.getByRole("button", { name: "Outline" }).click();
  const outline = page.getByRole("tree", { name: "Outline" });
  const alpha = outline.getByRole("treeitem", { name: "Alpha" });
  await alpha.focus();
  await expect(alpha).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(alpha).toHaveAttribute("aria-expanded", "false");
  await expect(outline.getByRole("treeitem")).toHaveCount(1);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(
    outline.getByRole("treeitem", { name: "Part two" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    outline.getByRole("treeitem", { name: "Part two" }),
  ).toHaveAttribute("aria-current", "location");
});

test("the tab strip is a tab list the arrow keys walk", async ({ page }) => {
  await open(page);
  await pasteMarkdown(page, "First tab.");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("textus:open-file-in-tab", {
        detail: "/work/notes/b.md",
      }),
    ),
  );
  const tabs = page.getByRole("tablist", { name: "Documents" });
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  const beta = tabs.getByRole("tab", { name: "b.md" });
  await expect(beta).toHaveAttribute("aria-selected", "true");
  await beta.focus();
  await page.keyboard.press("ArrowLeft");
  const first = tabs.getByRole("tab").first();
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`${editor} p`)).toHaveText("First tab.");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Delete");
  await expect(tabs).toHaveCount(0);
});

test("the context menu opens from the keyboard, walks and gives the focus back", async ({
  page,
}) => {
  await open(page);
  await pasteMarkdown(page, "Some text to work on.");
  await page.locator(`${editor} p`).click();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem").last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(await focusedIn(page, editor)).toBe(true);
});

test("Escape closes the window menu, and the focus goes back", async ({
  page,
}) => {
  test.skip(process.platform === "darwin", "a Mac's menu bar is native");
  await open(page);
  await page.locator(".window-menu-button").focus();
  await page.keyboard.press("Enter");
  // The menu takes the focus, for the arrow keys.
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.locator(".window-menu-button")).toBeFocused();
});

test("Escape closes the topmost thing in Settings, and the focus goes back", async ({
  page,
}) => {
  await open(page);
  await page.locator(editor).click();
  await emit(page, "menu-open-settings");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await page.getByRole("button", { name: "Editor & Appearance" }).click();
  await page.getByRole("combobox", { name: "Editor theme" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  expect(await focusedIn(page, editor)).toBe(true);
});

test("Textus AI's changes are stepped through and decided from the keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { "textus-agent-panel-open": "1" });
  const original = "One cat sat. Two dogs ran. Three birds sang.";
  await pasteMarkdown(page, original);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: original,
          text: "One cat slept. Two dogs ran. Three birds flew.",
        }),
      },
      { kind: "ToolResult", call_id: "c1", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Change the verbs");
  await composer.press("Enter");
  await expect(page.locator(".review-bar-accept")).toBeEnabled();
  const live = page.locator('[role="status"][aria-live]');

  // F7 steps to the first change, from wherever the focus is.
  await page.keyboard.press("F7");
  await expect(page.locator(".review-bar-pos")).toHaveText("1 / 2");
  await expect(live).toContainText("Change 1 of 2.");
  await page.keyboard.press("F7");
  await expect(page.locator(".review-bar-pos")).toHaveText("2 / 2");
  // The review bar - Accept, Reject, the view - is the region after the
  // document.
  await page.keyboard.press("F6");
  expect(await focusedIn(page, ".review-bar")).toBe(true);
  await page.keyboard.press("Shift+F7");
  await expect(page.locator(".review-bar-pos")).toHaveText("1 / 2");
  // The caret is in the text again: Ctrl/⌘ + Enter takes the change
  // pointed at, Ctrl/⌘ + Backspace keeps the original of the next.
  expect(await focusedIn(page, editor)).toBe(true);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(live).toContainText("1 change accepted.");
  await page.keyboard.press("F7");
  await expect(page.locator(".review-bar-pos")).toHaveText("2 / 2");
  await page.keyboard.press("ControlOrMeta+Backspace");
  await expect(live).toContainText("1 change rejected.");
  // Both decided: the rewrite is applied as decided.
  await expect(page.locator(".review-bar")).toHaveCount(0);
  await expect(page.locator(`${editor} p`)).toHaveText(
    "One cat slept. Two dogs ran. Three birds sang.",
  );
});
