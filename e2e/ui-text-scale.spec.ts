import { expect, test, type Page } from "@playwright/test";
import {
  emit,
  openApp,
  pasteMarkdown,
  SAMPLE_DOC,
  chromeScale,
} from "./helpers";

// Interface Text Size scales the app's own text and leaves the document's
// alone, which has its own zoom.

async function fontSize(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} isn't shown`);
  return b;
}

async function sizes(page: Page) {
  return {
    bar: (await box(page, ".window-bar")).height,
    barButton: (await box(page, ".window-bar-sidebar-toggle")).width,
    tabIcon: (await box(page, ".activity-rail-item svg")).width,
    outline: await fontSize(page, ".sidebar .outline-row .tree-label"),
    composer: await fontSize(page, ".agent-panel-view textarea"),
    tab: await fontSize(page, ".tab-pill-title"),
    document: await fontSize(page, '[data-active-tab="true"] .milkdown p'),
  };
}

test("Interface Text Size scales the sidebar, the tabs, the AI panel and the icons, not the document", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-sidebar-open": "1", "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, SAMPLE_DOC);
  // A second tab, for the tab bar.
  await emit(page, "menu-open-help", "markdown");
  await page.locator(".tab-pill").first().click();
  await page.getByRole("button", { name: "Outline" }).click();
  await expect(page.locator(".sidebar .outline-row").first()).toBeVisible();
  const before = await sizes(page);

  await emit(page, "menu-open-settings");
  const panel = page.getByRole("dialog", { name: "Settings" });
  await panel.getByRole("button", { name: "Editor & Appearance" }).click();
  await panel.getByRole("combobox", { name: "Interface text size" }).click();
  await page.getByRole("option", { name: "125%" }).click();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  const after = await sizes(page);
  expect(after.outline).toBeCloseTo(before.outline * 1.25, 1);
  expect(after.composer).toBeCloseTo(before.composer * 1.25, 1);
  expect(after.tab).toBeCloseTo(before.tab * 1.25, 1);
  expect(after.bar).toBeCloseTo(before.bar * 1.25, 0);
  expect(after.barButton).toBeCloseTo(before.barButton * 1.25, 0);
  expect(after.tabIcon).toBeCloseTo(before.tabIcon * 1.25, 0);
  expect(after.document).toBe(before.document);
});

test("a wider window takes the icons and the bar up in a straight line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-sidebar-open": "1" },
  });
  const chrome = async () => ({
    bar: (await box(page, ".window-bar")).height,
    button: (await box(page, ".window-bar-sidebar-toggle")).width,
    tabIcon: (await box(page, ".activity-rail-item svg")).width,
  });
  const small = await chrome();
  await page.setViewportSize({ width: 2100, height: 1000 });
  await expect
    .poll(async () => (await box(page, ".window-bar")).height)
    .toBeCloseTo(small.bar * 1.1, 0);
  const wide = await chrome();
  expect(wide.button).toBeCloseTo(small.button * 1.1, 0);
  expect(wide.tabIcon).toBeCloseTo(small.tabIcon * 1.1, 0);
});

test("the detached chat window follows Interface Text Size too", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "catvinci-settings",
      JSON.stringify({
        language: "en",
        languageChosen: true,
        onboardingShown: true,
        uiTextScale: 1.25,
      }),
    );
    (window as unknown as { __devInvokeResults: unknown }).__devInvokeResults =
      {
        take_chat_handoff: {
          editorLabel: "main",
          state: {
            context: {
              document: "",
              selectedText: "",
              selectionMarkdown: "",
              docPath: null,
              docTitle: "Untitled",
              editorLabel: "main",
            },
            conversationId: "c1",
            turns: [],
            statuses: {},
          },
        },
      };
  });
  await page.goto("/?view=chat");
  const textarea = page.locator(".chat-window-body textarea");
  await expect(textarea).toBeVisible();
  // --text-body, 13px, at the interface's size: 125% of its base.
  expect(
    await textarea.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeCloseTo(13 * (await chromeScale(page)), 1);
});
