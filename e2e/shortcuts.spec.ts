import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// Settings › Shortcuts lists the fixed shortcuts under the configurable
// ones, and the new actions work: Ctrl+Tab between tabs, and the heading
// levels once bound (#214). Chromium on Linux: Mod is Ctrl.

function emit(page: Page, name: string, payload?: unknown) {
  return page.evaluate(
    ([name, payload]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(name as string, payload),
    [name, payload] as const,
  );
}

test("Settings › Shortcuts lists the fixed shortcuts, read-only, by menu", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-settings");
  const panel = page.getByRole("dialog", { name: "Settings" });
  await panel.getByRole("button", { name: "Shortcuts", exact: true }).click();

  const fixed = panel.locator(".settings-group", {
    has: page.locator(".settings-group-title", { hasText: "Fixed Shortcuts" }),
  });
  await expect(fixed).toBeVisible();
  await expect(fixed.locator(".shortcut-fixed-title")).toHaveText([
    "File",
    "Edit",
    "View",
    "Format",
    "Keyboard Navigation",
  ]);
  const row = (label: string) =>
    fixed.locator(".shortcut-fixed-row", {
      has: page.getByText(label, { exact: true }),
    });
  await expect(row("Save").locator("kbd")).toHaveText("Ctrl+S");
  await expect(row("New Window").locator("kbd")).toHaveText("Ctrl+Shift+N");
  await expect(row("Zoom In").locator("kbd")).toHaveText("Ctrl+=");
  await expect(row("Bold").locator("kbd")).toHaveText("Ctrl+B");
  await expect(row("Redo").locator("kbd")).toHaveText([
    "Ctrl+Y",
    "Ctrl+Shift+Z",
  ]);
  // Nothing in it is a button to rebind.
  await expect(fixed.getByRole("button")).toHaveCount(0);

  // The new configurable actions sit above it.
  await expect(
    panel.getByRole("button", { name: "Next tab: Ctrl+Tab" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Heading 1: Not set" }),
  ).toBeVisible();
});

test("Ctrl+Tab and Ctrl+Shift+Tab step through the tabs, wrapping round", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-help", "markdown");
  await emit(page, "menu-open-help", "agent");
  const pills = page.locator(".tab-pill");
  await expect(pills).toHaveCount(3);
  const active = page.locator(".tab-pill-active .tab-pill-title");
  const titles = await page.locator(".tab-pill-title").allTextContents();
  await expect(active).toHaveText(titles[2]);

  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  await page.keyboard.press("Control+Tab");
  await expect(active).toHaveText(titles[0]);
  await page.keyboard.press("Control+Tab");
  await expect(active).toHaveText(titles[1]);
  await page.keyboard.press("Control+Shift+Tab");
  await page.keyboard.press("Control+Shift+Tab");
  await expect(active).toHaveText(titles[2]);
});

test("a heading shortcut does nothing until bound, then sets the level", async ({
  page,
}) => {
  await openApp(page, {
    settings: {
      language: "en",
      shortcuts: { setHeading2: "mod+2", setParagraph: "mod+9" },
    },
  });
  await pasteMarkdown(page, "A line of text");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.locator("p", { hasText: "A line of text" }).click();

  // Unbound by default: Ctrl+1 leaves the paragraph alone.
  await page.keyboard.press("Control+1");
  await expect(editor.locator("h1")).toHaveCount(0);

  await page.keyboard.press("Control+2");
  // With the caret in it, the heading shows its "## " mark.
  await expect(editor.locator("h2")).toContainText("A line of text");
  await page.keyboard.press("Control+9");
  await expect(editor.locator("h2")).toHaveCount(0);
  await expect(
    editor.locator("p", { hasText: "A line of text" }),
  ).toBeVisible();
});
