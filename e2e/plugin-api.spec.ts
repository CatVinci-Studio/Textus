import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * The plugin API on window.__textusPlugins in a development build: a
 * command, menu item, sidebar tab and Settings page, each added and removed.
 */

const editor = '[data-active-tab="true"] .ProseMirror';

type Api = {
  commands: {
    register: (c: {
      id: string;
      title: () => string;
      run: () => void;
      shortcut?: string;
    }) => () => void;
  };
  editorMenu: {
    register: (
      p: (ctx: { selectedText: string }) => {
        label: string;
        onSelect: () => void;
      }[],
    ) => () => void;
  };
  sidebarTabs: {
    register: (t: {
      id: string;
      label: () => string;
      Icon: () => null;
      Panel: () => null;
    }) => () => void;
  };
  settingsPages: {
    register: (p: {
      id: string;
      label: () => string;
      Page: () => null;
    }) => () => void;
  };
};

const api = (page: Page) =>
  page.waitForFunction(
    () => !!(window as unknown as { __textusPlugins?: Api }).__textusPlugins,
  );

test("a command added from outside runs on its shortcut", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await api(page);
  await page.evaluate(() => {
    const w = window as unknown as { __textusPlugins: Api; ran?: number };
    w.ran = 0;
    w.__textusPlugins.commands.register({
      id: "example.count",
      title: () => "Count",
      run: () => (w.ran = (w.ran ?? 0) + 1),
      shortcut: "mod+alt+9",
    });
  });
  await page.locator(editor).click();
  await page.keyboard.press("ControlOrMeta+Alt+9");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { ran: number }).ran))
    .toBe(1);
});

test("an item added to the editor's menu is offered with the selection", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await api(page);
  await pasteMarkdown(page, "A harbour at dusk.");
  await page.evaluate(() => {
    const w = window as unknown as { __textusPlugins: Api; picked?: string };
    w.__textusPlugins.editorMenu.register(({ selectedText }) => [
      { label: "Shout it", onSelect: () => (w.picked = selectedText) },
    ]);
  });
  // The line selected from the keyboard, the menu opened from it.
  await page.locator(`${editor} p`).first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  // The editor reads a keyboard selection a moment after the browser has
  // it (selectionchange).
  await page.waitForFunction(() => {
    const view = (
      window as unknown as {
        __pmView?: { state: { selection: { empty: boolean } } };
      }
    ).__pmView;
    return view && !view.state.selection.empty;
  });
  await page.keyboard.press("Shift+F10");
  await page.locator(".context-menu-item", { hasText: "Shout it" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { picked?: string }).picked),
    )
    .toBe("A harbour at dusk.");
});

test("a sidebar tab and a Settings page added from outside take their places", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await api(page);
  await page.evaluate(() => {
    const plugins = (window as unknown as { __textusPlugins: Api })
      .__textusPlugins;
    plugins.sidebarTabs.register({
      id: "example",
      label: () => "Example tab",
      Icon: () => null,
      Panel: () => null,
    });
    plugins.settingsPages.register({
      id: "example",
      label: () => "Example page",
      Page: () => null,
    });
  });
  // The sidebar draws its tabs when it next renders: open it.
  await page.keyboard.press("ControlOrMeta+\\");
  const tab = page.locator('.sidebar-tab[aria-label="Example tab"]');
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveClass(/sidebar-tab-active/);

  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(
    settings.getByRole("button", { name: "Example page", exact: true }),
  ).toBeVisible();
});
