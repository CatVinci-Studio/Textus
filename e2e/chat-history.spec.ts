import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// The AI panel's history: a past conversation reopens with its own document,
// and one whose document is gone asks first. The last test boots as Rust
// does, each conversation's turns read from its own file when it reopens.

const editor = '[data-active-tab="true"] .ProseMirror';
const CHAPTER = "/novel/chapter-one.md";
const GONE = "/novel/deleted.md";
const CHAPTER_TWO = "/novel/chapter-two.md";

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

/** Only CHAPTER is on disk. */
async function installDisk(page: Page) {
  await page.evaluate((path) => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
      };
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args = {}) => {
      const text: Record<string, string> = {
        [path]: "Chapter one begins here.",
        "/novel/chapter-two.md": "Chapter two goes on.",
      };
      const at = String(args.path);
      if (cmd === "read_text_file")
        return at in text
          ? Promise.resolve(text[at])
          : Promise.reject("No such file or directory");
      if (cmd === "file_mtime_ms")
        return Promise.resolve(at in text ? 1 : null);
      return original(cmd, args);
    };
  }, CHAPTER);
}

/** The page booted as Rust boots it, with the conversations in the store
 *  and three more in its trash. */
async function bootWithRust(page: Page, saved: unknown[]) {
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
      saved,
    },
  );
}

const panel = (page: Page) => page.locator(".ai-island");

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

test("a past conversation reopens with its own document, and stays the folder's in its other documents", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", agentWorkspaceRoot: "/novel" },
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

  // Another document of the folder, in a tab of its own: the same
  // conversation, not a new one.
  await page.evaluate((path) => {
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      }
    ).__devEmitTauriEvent("tauri://drag-drop", {
      paths: [path],
      position: { x: 0, y: 0 },
    });
  }, CHAPTER_TWO);
  await expect(page.locator(editor)).toContainText("Chapter two goes on.");
  await expect(panel(page)).toContainText("Tighten the opening paragraph");
});

test("with Rust, the list is the index and older conversations are noted as archived", async ({
  page,
}) => {
  await bootWithRust(page, SAVED);
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

test("a search finds the conversations where the words were said", async ({
  page,
}) => {
  const said = (id: string, at: number, user: string, reply: string) => ({
    ...conversation(id, CHAPTER, user, at),
    turns: [
      { kind: "User", text: user },
      { kind: "Assistant", text: reply },
    ],
  });
  await bootWithRust(page, [
    said(
      "n1",
      3,
      "Name the ship",
      "Call it the Albatross - it suits the voyage.",
    ),
    said("n2", 2, "Another name?", "The Petrel, or the Albatross again."),
    said("n3", 1, "Tighten the ending", "Done."),
  ]);
  await openApp(page, { settings: { language: "en" } });
  await installDisk(page);
  await openHistory(page);
  const search = page.getByRole("searchbox", { name: "Search conversations" });
  await search.fill("albatross");
  await expect(page.locator(".chat-history-hit")).toHaveCount(2);
  await expect(page.locator(".chat-history-hit").first()).toContainText(
    "Textus AI: Call it the Albatross",
  );
  await search.fill("albatross petrel");
  await expect(page.locator(".chat-history-entry")).toHaveCount(1);
  await search.fill("kraken");
  await expect(page.locator(".chat-history-empty")).toHaveText(
    "No conversation has these words.",
  );
  // A found conversation reopens like a listed one.
  await search.fill("ending");
  await page.locator(".chat-history-entry", { hasText: "Tighten" }).click();
  await expect(panel(page)).toContainText("Tighten the ending");
});
