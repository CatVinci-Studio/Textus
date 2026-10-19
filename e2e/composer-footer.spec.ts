import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, pasteMarkdown, PHONE } from "./helpers";

// The composer's footer - the mode, + and search, the selection chip, Send -
// is one row at the AI panel's narrowest. In 1.1.0-rc.6 a selection's chip
// ("已选择 N 字", longer in German or Russian) pushed Send onto a line of
// its own; now the chip gives way first, ellipsized, and Send keeps its
// place at the end of the row.

const LANGUAGES = [
  "en",
  "zh",
  "zh-Hant",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "ru",
  "pt",
] as const;

/** A long passage: the chip counts its characters, five digits of them. */
const PASSAGE = "Alpha beta gamma delta epsilon. ".repeat(400).trim();

/** Every control in the footer sits on one line, Send last at its right
 *  edge, and nothing spills out of the footer. `ownRow`: a control that
 *  has a row of its own above the others (the phone's mode segments). */
async function expectOneRow(toolbar: Locator, ownRow?: string) {
  const layout = await toolbar.evaluate((bar) => {
    const box = bar.getBoundingClientRect();
    const items = Array.from(bar.children).map((el) => {
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

for (const language of LANGUAGES)
  test(`${language}: the footer stays one row with a long selection chip at the panel's narrowest`, async ({
    page,
  }) => {
    await openApp(page, {
      settings: { language },
      storage: {
        "levis-agent-panel-open": "1",
        "levis-agent-panel-width": "300",
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

// Fonts differ from machine to machine: the CI runner's set Russian 4.5px
// wider than a desktop's and pushed Send out. With every word in the
// footer much wider than any real font makes it, the row still holds:
// the chip goes to its x, then the mode's name to an ellipsis.
for (const language of ["de", "ru"] as const)
  test(`${language}: the footer holds its row in a wider font too`, async ({
    page,
  }) => {
    await openApp(page, {
      settings: { language },
      storage: {
        "levis-agent-panel-open": "1",
        "levis-agent-panel-width": "300",
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

for (const language of ["de", "ru"] as const)
  test(`${language}: the detached chat window's footer stays one row at its narrowest`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 560 });
    await page.addInitScript(
      ({ language, passage }) => {
        localStorage.setItem(
          "catvinci-settings",
          JSON.stringify({
            language,
            languageChosen: true,
            onboardingShown: true,
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
      { language, passage: PASSAGE },
    );
    await page.goto("/?view=chat");
    const body = page.locator(".chat-window-body");
    await expect(body.locator(".inline-chat-selection-chip")).toBeVisible();
    await expectOneRow(body.locator(".inline-chat-toolbar"));
  });

test.describe("on a phone", () => {
  test.use(PHONE);
  for (const language of ["de", "ru"] as const)
    test(`${language}: the sheet keeps its tools and Send on one row under the modes`, async ({
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
      await page.locator(".window-bar-toggle").tap();
      const view = page.locator(".agent-panel-view");
      await expect(view.locator(".inline-chat-selection-chip")).toBeVisible();
      await expectOneRow(
        view.locator(".inline-chat-toolbar"),
        "chat-mode-segments",
      );
    });
});
