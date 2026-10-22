import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// The history button in the AI panel's header (ai/chat/ChatHistoryMenu.tsx):
// a past conversation reopens with its own document - never filed under
// whichever document is on screen - and one whose document is gone asks
// first. The last test
// boots the page the way Rust does, where the list is the index of
// conversations (settings/chat_history.rs) and each one's turns are read
// from its own file when it reopens.

const editor = '[data-active-tab="true"] .ProseMirror';
const CHAPTER = "/novel/chapter-one.md";
const GONE = "/novel/deleted.md";

const conversation = (
  id: string,
  docPath: string | null,
  question: string,
  updatedAt: number,
) => ({
  id,
  docPath,
  title: question,
  updatedAt,
  turns: [{ kind: "User", text: question }],
});

const SAVED = [
  conversation("c1", CHAPTER, "Tighten the opening paragraph", 3),
  conversation("c2", GONE, "Check the dates in this draft", 2),
  conversation("c3", null, "Brainstorm a title", 1),
];

/** Only CHAPTER is on disk (a stand-in for commands/fs.rs). */
async function installDisk(page: Page) {
  await page.evaluate((path) => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
      };
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args = {}) => {
      if (cmd === "read_text_file")
        return args.path === path
          ? Promise.resolve("Chapter one begins here.")
          : Promise.reject("No such file or directory");
      if (cmd === "file_mtime_ms")
        return Promise.resolve(args.path === path ? 1 : null);
      return original(cmd, args);
    };
  }, CHAPTER);
}

const panel = (page: Page) => page.locator(".agent-panel-view");

/** Opens the AI panel, if it isn't, and its history list. */
async function openHistory(page: Page) {
  const toggle = page.locator(".window-bar-toggle");
  if ((await toggle.getAttribute("aria-pressed")) !== "true")
    await toggle.click();
  await panel(page).getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("dialog", { name: "History" })).toBeVisible();
}

const entry = (page: Page, title: string) =>
  page.locator(".chat-history-entry", { hasText: title });

test("a past conversation reopens with its own document", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-chat-history": JSON.stringify(SAVED) },
  });
  await installDisk(page);
  await openHistory(page);

  await entry(page, "Tighten the opening paragraph").click();
  // Its document opens, and the conversation is restored there...
  await expect(page.locator(editor)).toContainText("Chapter one begins here.");
  await expect(panel(page)).toContainText("Tighten the opening paragraph");
  // ...still filed under that document.
  const stored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("textus-chat-history")!) as {
        id: string;
        docPath: string | null;
      }[],
  );
  expect(stored.find((c) => c.id === "c1")?.docPath).toBe(CHAPTER);
});

test("a conversation whose document is gone asks before continuing here", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-chat-history": JSON.stringify(SAVED) },
  });
  await installDisk(page);
  await openHistory(page);

  await entry(page, "Check the dates in this draft").click();
  const dialog = page.locator(".app-dialog");
  await expect(dialog).toContainText("deleted.md");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel(page)).not.toContainText("Check the dates in this draft");

  await openHistory(page);
  await entry(page, "Check the dates in this draft").click();
  await dialog.getByRole("button", { name: "Continue Here" }).click();
  await expect(panel(page)).toContainText("Check the dates in this draft");
});

test("a never-saved document's conversation continues in the current one", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-chat-history": JSON.stringify(SAVED) },
  });
  await openHistory(page);
  const draft = entry(page, "Brainstorm a title");
  await expect(draft).toHaveAttribute("title", /current document/);
  await draft.click();
  await expect(panel(page)).toContainText("Brainstorm a title");
  await expect(page.locator(".app-dialog")).toHaveCount(0);
});

test("with Rust, the list is the index and older conversations are noted as archived", async ({
  page,
}) => {
  const boot = {
    settings: { language: "en", languageChosen: true, onboardingShown: true },
    rev: 1,
    label: "main",
    uiState: {},
  };
  await page.addInitScript(
    ({ script, boot, saved }) => {
      new Function(script)();
      (
        window as unknown as {
          __textusBoot: (boot: unknown, css: unknown) => void;
        }
      ).__textusBoot(boot, null);
      // The store behind (dev/tauri-shim.ts): the conversations, listed as
      // summaries, and three more in the trash.
      (window as unknown as Record<string, unknown>).__devChatHistory = {
        saved,
        archived: 3,
      };
    },
    {
      script: readFileSync(
        new URL("../src-tauri/src/boot.js", import.meta.url),
        "utf8",
      ),
      boot,
      saved: SAVED,
    },
  );
  await openApp(page, { settings: { language: "en" } });
  await installDisk(page);
  await openHistory(page);

  await expect(page.locator(".chat-history-archived")).toContainText(
    "Older conversations were moved to the archive",
  );
  await expect(page.locator(".chat-history-entry")).toHaveCount(3);
  // The list held no turns; reopening reads them from the conversation.
  const listed = await page.evaluate(
    () =>
      (
        window as unknown as {
          __devStorage: { histories: { chat: Record<string, unknown>[] } };
        }
      ).__devStorage.histories.chat,
  );
  expect(listed.every((c) => !("turns" in c))).toBe(true);
  await entry(page, "Tighten the opening paragraph").click();
  await expect(page.locator(editor)).toContainText("Chapter one begins here.");
  await expect(panel(page)).toContainText("Tighten the opening paragraph");
});

test("a conversation deleted from the list is gone for good", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-chat-history": JSON.stringify(SAVED) },
  });
  await openHistory(page);
  const line = entry(page, "Brainstorm a title");
  await line.hover();
  await line.getByRole("button", { name: "Delete conversation" }).click();
  await expect(line).toHaveCount(0);
  // The list stays open on the rest.
  await expect(page.locator(".chat-history-entry")).toHaveCount(2);
  const stored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("textus-chat-history")!) as {
        id: string;
      }[],
  );
  expect(stored.map((c) => c.id)).toEqual(["c1", "c2"]);
  // Escape closes the list.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "History" })).toHaveCount(0);
});
