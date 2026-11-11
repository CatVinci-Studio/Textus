import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { emit, openApp, pasteMarkdown, SAMPLE_DOC } from "./helpers";

/**
 * axe-core over the window's surfaces in light and dark - the document,
 * Settings' list and a page, the plugin list, an AI conversation's tab -
 * failing on a serious or critical violation. A11Y_REPORT=1 prints every
 * violation instead of failing.
 */

async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    // Inside the editor the caret scrolls a wide table; a tab stop there
    // would take clicks from the editor.
    .exclude(".ProseMirror .table-scroll")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  if (process.env.A11Y_REPORT) {
    for (const v of results.violations)
      console.log(
        ["A11Y", name, v.impact, v.id, v.nodes.length]
          .concat(v.nodes.slice(0, 4).map((n) => n.target.join(" ")))
          .join("\t"),
      );
    return;
  }
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
    }));
  expect(blocking, name).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the window's surfaces in ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page, { colorScheme, settings: { menuBarShown: false } });
    await pasteMarkdown(page, SAMPLE_DOC);
    await scan(page, "document");

    await emit(page, "menu-settings");
    await expect(page.locator(".settings-tab-page")).toBeVisible();
    await scan(page, "settings");

    await emit(page, "menu-manage-plugins");
    await expect(page.locator(".plugins-panel-row").first()).toBeVisible();
    await scan(page, "plugins");

    await page.getByRole("button", { name: "Textus AI" }).first().click();
    await expect(page.locator(".ai-tab")).toBeVisible();
    await scan(page, "ai");
  });
}
