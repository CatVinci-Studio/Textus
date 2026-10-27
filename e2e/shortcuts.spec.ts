import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// Settings › Shortcuts lists the fixed shortcuts under the configurable
// ones, and the new actions work: Ctrl+Tab between tabs, and the heading
// levels on Ctrl+1..6. Chromium on Linux: Mod is Ctrl.

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
  await expect(row("New Tab").locator("kbd")).toHaveText("Ctrl+T");
  await expect(row("New Window").locator("kbd")).toHaveText("Ctrl+N");
  await expect(row("Reopen Closed Tab").locator("kbd")).toHaveText(
    "Ctrl+Shift+T",
  );
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
    panel.getByRole("button", { name: "Heading 1: Ctrl+1" }),
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

const editor = (page: Page) =>
  page.locator('[data-active-tab="true"] .ProseMirror');

async function caretInLine(page: Page) {
  await pasteMarkdown(page, "A line of text");
  await editor(page).locator("p", { hasText: "A line of text" }).click();
}

test("Ctrl+2 makes a paragraph a heading 2 out of the box, as the Format menu says", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await caretInLine(page);
  await page.keyboard.press("Control+2");
  // With the caret in it, the heading shows its "## " mark.
  await expect(editor(page).locator("h2")).toContainText("A line of text");

  await page.locator(".window-menu-button").click();
  await page.getByRole("menuitem", { name: "Format" }).hover();
  for (const level of [1, 2, 6])
    await expect(
      page.getByRole("menuitem", { name: `Heading ${level}` }),
    ).toContainText(`Ctrl+${level}`);
});

test("a heading level cleared in Settings stays cleared, and Reset brings it back", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await caretInLine(page);
  await emit(page, "menu-open-settings");
  const panel = page.getByRole("dialog", { name: "Settings" });
  await panel.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await panel.getByRole("button", { name: "Clear: Heading 2" }).click();
  await expect(
    panel.getByRole("button", { name: "Heading 2: Not set" }),
  ).toBeVisible();

  // Saved as "", so the next launch reads it as chosen and doesn't put
  // the default back. (A reload would rerun openApp's stored settings.)
  const saved = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}") as {
        shortcuts: Record<string, string>;
      },
  );
  expect(saved.shortcuts.setHeading2).toBe("");

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await editor(page).locator("p", { hasText: "A line of text" }).click();
  await page.keyboard.press("Control+2");
  await expect(editor(page).locator("h2")).toHaveCount(0);

  await emit(page, "menu-open-settings");
  await panel.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await panel.getByRole("button", { name: "Reset: Heading 2" }).click();
  await expect(
    panel.getByRole("button", { name: "Heading 2: Ctrl+2" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Reset: Heading 2" }),
  ).toHaveCount(0);
});

test("a heading key typed in the AI panel leaves the document alone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await caretInLine(page);
  const composer = page.locator(".agent-panel-view textarea");
  await composer.click();
  await page.keyboard.press("Control+2");
  await expect(composer).toBeFocused();
  await expect(editor(page).locator("h2")).toHaveCount(0);
});
