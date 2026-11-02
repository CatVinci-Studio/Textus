import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, pasteMarkdown, PHONE } from "./helpers";

// The composer's footer is one row at the AI panel's narrowest: a long
// selection chip ellipsizes first, and Send keeps its place at the end.

// The mode's name and Send don't give way. zh-Hant and pt are left out:
// their widths match zh's and es's.
const LANGUAGES = ["en", "zh", "ja", "ko", "es", "fr", "de", "ru"] as const;

/** A long passage: the chip counts its characters, five digits of them. */
const PASSAGE = "Alpha beta gamma delta epsilon. ".repeat(400).trim();

/** Every control in the footer sits on one line, Send last at its right
 *  edge, and nothing spills out of the footer. `ownRow`: a control that
 *  has a row of its own above the others (the phone's mode segments). */
async function expectOneRow(toolbar: Locator, ownRow?: string) {
  const layout = await toolbar.evaluate((bar) => {
    const box = bar.getBoundingClientRect();
    // What isn't drawn has no place on the row (the phone's model button).
    const shown = Array.from(bar.children).filter(
      (el) => getComputedStyle(el).display !== "none",
    );
    const items = shown.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        name: el.className,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
      };
    });
    return { right: box.right, left: box.left, items };
  });
  const send = layout.items.at(-1)!;
  expect(send.name).toContain("inline-chat-send");
  for (const item of layout.items) {
    expect(item.left, item.name).toBeGreaterThanOrEqual(layout.left - 0.5);
    expect(item.right, item.name).toBeLessThanOrEqual(layout.right + 0.5);
    if (ownRow && item.name.includes(ownRow)) {
      expect(item.bottom, item.name).toBeLessThanOrEqual(send.top);
      continue;
    }
    // Each one overlaps Send's line: nothing wrapped above or below it.
    expect(item.top, item.name).toBeLessThan(send.bottom);
    expect(item.bottom, item.name).toBeGreaterThan(send.top);
  }
  expect(Math.abs(send.right - layout.right)).toBeLessThan(1);
}

async function selectPassage(page: Page) {
  await pasteMarkdown(page, PASSAGE);
  await page.locator(".milkdown p").first().click({ clickCount: 3 });
}

// And with Interface Text Size at its largest, 125%.
for (const uiTextScale of [1, 1.25])
  for (const language of LANGUAGES)
    test(`${language}: the footer stays one row with a long selection chip at the panel's narrowest${uiTextScale === 1 ? "" : `, at ${uiTextScale * 100}% text`}`, async ({
      page,
    }) => {
      await openApp(page, {
        settings: { language, uiTextScale },
        storage: {
          "textus-agent-panel-open": "1",
          "textus-agent-panel-width": "300",
        },
      });
      await selectPassage(page);
      const view = page.locator(".agent-panel-view");
      await view.locator("textarea").click();
      const chip = view.locator(".inline-chat-selection-chip");
      await expect(chip).toBeVisible();
      await expectOneRow(view.locator(".inline-chat-toolbar"));
      // The chip's ✕ stays whole: the label gives way, not the button.
      const remove = chip.locator(".inline-chat-chip-remove");
      await expect(remove).toBeVisible();
      const removeBox = (await remove.boundingBox())!;
      const chipBox = (await chip.boundingBox())!;
      expect(removeBox.x + removeBox.width).toBeLessThanOrEqual(
        chipBox.x + chipBox.width + 0.5,
      );
    });

// Fonts differ between machines: with every footer word far wider than any
// real font makes it, the row still holds, the chip giving way first, then
// the mode's name.
for (const language of ["de", "ru"] as const)
  test(`${language}: the footer holds its row in a wider font too`, async ({
    page,
  }) => {
    await openApp(page, {
      settings: { language },
      storage: {
        "textus-agent-panel-open": "1",
        "textus-agent-panel-width": "300",
      },
    });
    await page.addStyleTag({
      content:
        ".agent-panel-view .inline-chat-toolbar * { letter-spacing: 0.12em; }",
    });
    await selectPassage(page);
    const view = page.locator(".agent-panel-view");
    await view.locator("textarea").click();
    await expect(view.locator(".inline-chat-selection-chip")).toBeVisible();
    await expectOneRow(view.locator(".inline-chat-toolbar"));
    // The mode is still there to pick, if shortened.
    await expect(
      view.getByRole("combobox", {
        name: language === "de" ? "Modus" : "Режим",
      }),
    ).toBeVisible();
  });

for (const uiTextScale of [1, 1.25])
  for (const language of ["de", "ru"] as const)
    test(`${language}: the detached chat window's footer stays one row at its narrowest${uiTextScale === 1 ? "" : `, at ${uiTextScale * 100}% text`}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 560 });
      await page.addInitScript(
        ({ language, passage, uiTextScale }) => {
          localStorage.setItem(
            "catvinci-settings",
            JSON.stringify({
              language,
              languageChosen: true,
              onboardingShown: true,
              uiTextScale,
            }),
          );
          (
            window as unknown as { __devInvokeResults: unknown }
          ).__devInvokeResults = {
            take_chat_handoff: {
              editorLabel: "main",
              state: {
                context: {
                  document: passage,
                  selectedText: passage,
                  selectionMarkdown: passage,
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
        },
        { language, passage: PASSAGE, uiTextScale },
      );
      await page.goto("/?view=chat");
      const body = page.locator(".chat-window-body");
      await expect(body.locator(".inline-chat-selection-chip")).toBeVisible();
      await expectOneRow(body.locator(".inline-chat-toolbar"));
    });

test.describe("on a phone", () => {
  test.use(PHONE);
  for (const language of ["de", "ru"] as const)
    test(`${language}: the AI page keeps the mode, its tools and Send on one row`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "platform", { get: () => "iPhone" });
      });
      await openApp(page, { settings: { language } });
      await expect(page.locator("html")).toHaveAttribute(
        "data-window-chrome",
        "mobile",
      );
      await selectPassage(page);
      await page.locator(".page-switch button").nth(1).tap();
      const view = page.locator(".agent-panel-view");
      await expect(view.locator(".inline-chat-selection-chip")).toBeVisible();
      await expectOneRow(view.locator(".inline-chat-toolbar"));
    });
});
