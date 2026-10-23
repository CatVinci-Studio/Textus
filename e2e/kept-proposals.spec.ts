import { expect, test, type Page } from "@playwright/test";
import { blockIds, mockInvoke, openApp } from "./helpers";

// AI proposals not decided yet are kept with their document
// (ai/revision/kept-proposals.ts): closed and opened again, it offers them
// again - the dev shim keeps them by path, as ai/kept_proposals.rs does in
// the project's .textus/pending/.

const editor = '[data-active-tab="true"] .ProseMirror';
const PATH = "/home/me/story.md";
const STORY =
  "The keeper climbed the stairs slowly.\n\nThe lamp was still warm when he reached it.\n\nOutside, the sea was calm.";

function emit(page: Page, name: string, payload?: unknown) {
  return page.evaluate(
    ([n, p]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(n as string, p),
    [name, payload] as const,
  );
}

/** Opens the story by its path, as a file dropped on the window does. */
async function openStory(page: Page) {
  await emit(page, "tauri://drag-drop", {
    paths: [PATH],
    position: { x: 0, y: 0 },
  });
  await expect(page.locator(editor)).toContainText("Outside, the sea");
}

/** Closes the story's tab, with another document open beside it (one
 *  tab alone has no tab bar). */
async function closeStory(page: Page) {
  await emit(page, "tauri://drag-drop", {
    paths: ["/home/me/other.md"],
    position: { x: 0, y: 0 },
  });
  const pill = page.locator(".tab-pill", { hasText: "story.md" });
  // Its ✕ shows on hover.
  await pill.hover();
  await pill.locator(".tab-pill-close").click();
  await expect(page.locator(".tab-pill-title")).toHaveCount(0);
  await expect(page.locator(editor)).toContainText("Another document.");
}

/** The kept proposals of the story, as the shim holds them. */
function kept(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__.invoke("kept_proposals_read", {
      docPath: "/home/me/story.md",
      workspaceRoot: null,
    }),
  );
}

async function rewrite(page: Page) {
  const ids = await blockIds(page, STORY);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "go" },
      {
        kind: "ToolCall",
        call_id: "k1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          block: ids[0],
          text: "The keeper climbed the stairs.",
        }),
      },
      { kind: "ToolResult", call_id: "k1", output: "Edit proposed" },
      {
        kind: "ToolCall",
        call_id: "k2",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          block: ids[2],
          text: "Outside, the sea lay calm.",
        }),
      },
      { kind: "ToolResult", call_id: "k2", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tighten it");
  await composer.press("Enter");
  await expect(page.locator(".review-bar")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openApp(page, {
    settings: { language: "en", agentDefaultMode: "write" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await page.evaluate((story) => {
    (window as unknown as { __devFiles: Record<string, string> }).__devFiles = {
      "/home/me/story.md": story,
      "/home/me/other.md": "Another document.",
    };
  }, STORY);
});

test("undecided proposals come back when their document opens again", async ({
  page,
}) => {
  await openStory(page);
  await rewrite(page);
  await expect(page.locator(".revision-note")).toHaveCount(2);
  // Written down once they settle.
  await expect.poll(() => kept(page)).not.toBeNull();

  await closeStory(page);
  await openStory(page);
  await expect(page.locator(".review-bar")).toBeVisible();
  await expect(page.locator(".revision-note")).toHaveCount(2);

  // Decided, they are gone from what is kept.
  await page.locator(".review-bar-accept").click();
  await expect(page.locator(`${editor} p`)).toHaveText([
    "The keeper climbed the stairs.",
    "The lamp was still warm when he reached it.",
    "Outside, the sea lay calm.",
  ]);
  await expect.poll(() => kept(page)).toBeNull();
});

test("a proposal whose original changed while it was closed gives way", async ({
  page,
}) => {
  await openStory(page);
  await rewrite(page);
  await expect.poll(() => kept(page)).not.toBeNull();
  await closeStory(page);
  // Edited elsewhere: the first paragraph is not what was rewritten.
  await page.evaluate(() => {
    (window as unknown as { __devFiles: Record<string, string> }).__devFiles[
      "/home/me/story.md"
    ] =
      "The keeper ran up the stairs.\n\nThe lamp was still warm when he reached it.\n\nOutside, the sea was calm.";
  });
  await openStory(page);
  // The other one still stands.
  await expect(page.locator(".revision-note")).toHaveCount(1);
  await expect(page.locator(".revision-note")).toContainText("sea");
});
