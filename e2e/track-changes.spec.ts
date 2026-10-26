import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Edit › Track My Changes: the writer's edits show as marked changes with
 * margin cards, and the kept original survives a reopen.
 */

const PATH = "/notes/draft.md";
const DOC = "The harbour was quiet at dawn.\n";
const editor = '[data-active-tab="true"] .ProseMirror';

async function openDraft(page: Page, kept?: string) {
  await page.addInitScript(
    ({ path, doc, kept }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__devFiles = { [path]: doc };
      w.__devInvokeResults = { take_pending_open_path: path };
      if (kept) w.__devOwnNotes = { [`revisions:${path}`]: kept };
    },
    { path: PATH, doc: DOC, kept },
  );
  await openApp(page, { settings: { language: "en" } });
  await expect(page.locator(editor)).toContainText("quiet at dawn");
}

const toggleTracking = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-track-changes"),
  );

/** Replaces `word` in the first paragraph by typing over it. */
async function retype(page: Page, word: string, by: string) {
  await page.locator(editor).evaluate((root, word) => {
    const text = root.querySelector("p")!.firstChild!;
    const at = text.textContent!.indexOf(word);
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + word.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, word);
  await page.keyboard.type(by);
}

const kept = (page: Page) =>
  page.evaluate(
    (path) =>
      ((window as unknown as { __devOwnNotes?: Record<string, string> })
        .__devOwnNotes ?? {})[`revisions:${path}`] ?? null,
    PATH,
  );

test("tracked edits show struck and marked, each to accept or reject", async ({
  page,
}) => {
  await openDraft(page);
  await toggleTracking(page);
  await retype(page, "quiet", "still");
  await expect(page.locator(".own-delete")).toHaveText("quiet");
  await expect(page.locator(".own-insert")).toHaveText("still");
  // The text holds the new words; the old ones are only drawn.
  await expect(page.locator(editor)).toContainText("The harbour was");
  const card = page.locator(".revision-note", { hasText: "quiet" });
  await expect(card.locator(".review-note-mark-me")).toHaveText("Me");

  // The original is kept beside the app's data.
  await expect.poll(() => kept(page)).toContain("quiet at dawn");

  // Rejected: back to the original.
  await card.getByRole("button", { name: /Keep the original/i }).click();
  await expect(page.locator(".own-delete")).toHaveCount(0);
  await expect(page.locator(editor)).toContainText("was quiet at dawn");

  // Accepted: the new words become the original, no marks.
  await retype(page, "dawn", "noon");
  await page
    .locator(".revision-note", { hasText: "dawn" })
    .getByRole("button", { name: /Take this change/i })
    .click();
  await expect(page.locator(".own-insert, .own-delete")).toHaveCount(0);
  await expect(page.locator(editor)).toContainText("quiet at noon");
  await expect.poll(() => kept(page)).toContain("quiet at noon");

  // Stopping with nothing to review drops the kept original.
  await toggleTracking(page);
  await expect.poll(() => kept(page)).toBeNull();
});

test("tracking carries on when the document opens again", async ({ page }) => {
  await openDraft(
    page,
    JSON.stringify({ base: "The harbour was silent at dawn.\n" }),
  );
  await expect(page.locator(".own-delete")).toHaveText("silent");
  await expect(page.locator(".own-insert")).toHaveText("quiet");
});
