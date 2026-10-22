import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// The AI panel popped out into its own window (ChatWindowApp) draws its
// header buttons like the docked panel's. They used to be a 20px class of
// their own that kept the browser's button padding: each icon was squeezed
// to 8px wide and drawn at half opacity.

type Box = { width: number; height: number; opacity: string };

async function headerButtons(page: Page, header: string) {
  return page
    .locator(`${header} button[aria-label="History"]`)
    .evaluate((button) => {
      const box = (el: Element): Box => {
        const rect = el.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          opacity: getComputedStyle(el).opacity,
        };
      };
      return { button: box(button), icon: box(button.querySelector("svg")!) };
    });
}

test("the detached chat window's header buttons are the docked panel's size", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const docked = await headerButtons(page, ".agent-panel-header");

  const chat = await page.context().newPage();
  await chat.addInitScript(() => {
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
  await chat.goto("/?view=chat");
  await expect(chat.locator(".chat-window-body textarea")).toBeVisible();
  const detached = await headerButtons(chat, ".chat-window-header");

  expect(detached).toEqual(docked);
  // The icon keeps its own square, not a sliver of it.
  expect(detached.icon.width).toBe(detached.icon.height);
  for (const name of ["New conversation", "Keep on top"])
    expect(
      await chat
        .locator(`.chat-window-header button[aria-label="${name}"]`)
        .evaluate((el) => el.getBoundingClientRect().width),
    ).toBe(docked.button.width);
});
