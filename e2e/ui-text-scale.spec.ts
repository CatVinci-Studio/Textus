import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown, SAMPLE_DOC } from "./helpers";

// Settings › Editor & Appearance › Interface Text Size scales the app's own
// text - sidebar, tabs, AI panel, Settings - and leaves the document's
// alone, which has its own zoom (#150).

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

async function fontSize(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

async function sizes(page: Page) {
  return {
    outline: await fontSize(page, ".sidebar .outline-row .tree-label"),
    composer: await fontSize(page, ".agent-panel-view textarea"),
    tab: await fontSize(page, ".tab-pill-title"),
    document: await fontSize(page, '[data-active-tab="true"] .milkdown p'),
  };
}

test("Interface Text Size scales the sidebar, the tabs and the AI panel, not the document", async ({
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
  expect(after.document).toBe(before.document);
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
  // --text-md, 13px, at 125%.
  expect(
    await textarea.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeCloseTo(16.25, 1);
});
