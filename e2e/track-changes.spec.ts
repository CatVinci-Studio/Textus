import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * View › Track My Changes: the writer's edits show as marked changes with
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
      w.__devInvokeResults = { take_pending_window_paths: [path] };
      if (kept) w.__devOwnNotes = { [`revisions:${path}`]: kept };
    },
    { path: PATH, doc: DOC, kept },
  );
  await openApp(page, { settings: { language: "en" } });
  await expect(page.locator(editor)).toContainText("at dawn");
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
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode()!;
    while (!text.textContent!.includes(word)) text = walker.nextNode()!;
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

/** What the document's file holds. */
const file = (page: Page) =>
  page.evaluate(
    (path) =>
      (window as unknown as { __devFiles: Record<string, string> }).__devFiles[
        path
      ],
    PATH,
  );

const save = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-save-file"),
  );

test("tracked edits show struck and marked, each to accept or reject", async ({
  page,
}) => {
  await openDraft(page);
  await toggleTracking(page);
  await retype(page, "quiet", "still");
  await expect(page.locator(".own-delete")).toHaveText("quiet");
  await expect(page.locator(".own-insert")).toHaveText("still");
  const card = page.locator(".revision-note", { hasText: "quiet" });
  await expect(card.locator(".review-note-mark-me")).toHaveText("Me");

  // Rejected: back to the original.
  await card.getByRole("button", { name: /Keep the original/i }).click();
  await expect(page.locator(".own-delete")).toHaveCount(0);
  await expect(page.locator(editor)).toContainText("was quiet at dawn");
});

test("the review bar counts the writer's changes, steps through them and decides them all", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await openDraft(page);
  await toggleTracking(page);
  await retype(page, "quiet", "still");
  await retype(page, "dawn", "dusk");
  const bar = page.getByRole("toolbar", { name: "Revision" });
  await expect(bar).toContainText("2 changes");
  await bar.getByRole("button", { name: "Next edit" }).click();
  await expect(bar).toContainText("1 / 2");
  await bar.getByRole("button", { name: "Next edit" }).click();
  await expect(bar).toContainText("2 / 2");

  await bar.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator(".own-insert, .own-delete")).toHaveCount(0);
  await expect(bar).toHaveCount(0);
  await expect(page.locator(editor)).toContainText("was still at dusk");
});

test("the writer's changes take the review bar's views, as Textus AI's do", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await openDraft(page);
  await toggleTracking(page);
  await retype(page, "quiet", "still");
  const shown = (part: string) =>
    page
      .locator(part)
      .evaluate(
        (el) =>
          getComputedStyle(el).display !== "none" &&
          getComputedStyle(el).fontSize !== "0px",
      );
  const card = page.locator(".revision-note");
  const view = async (name: string) => {
    await page.locator(".review-bar-view-button").click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
  };

  // Result only (the default): the new word, the original in its card.
  expect(await shown(".own-delete")).toBe(false);
  expect(await shown(".own-insert")).toBe(true);
  await expect(card).toContainText("quiet");

  await view("Original in the text, changes in the margin");
  expect(await shown(".own-delete")).toBe(true);
  expect(await shown(".own-insert")).toBe(false);
  await expect(card).toContainText("still");

  await view("All in the text");
  expect(await shown(".own-delete")).toBe(true);
  expect(await shown(".own-insert")).toBe(true);
  // Everything in the text, the ✓ / ✕ too: no card repeats it.
  await expect(card).toHaveCount(0);
  await page.locator(".own-pick .pending-pick-take").click();
  await expect(page.locator(".own-insert, .own-delete")).toHaveCount(0);
  await expect(page.locator(editor)).toContainText("was still at dawn");
});

test("in the original's view, text only added waits in its card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await openDraft(page);
  await toggleTracking(page);
  await page.locator(editor).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Gulls cried.");
  await page.locator(".review-bar-view-button").click();
  await page
    .getByRole("menuitemradio", {
      name: "Original in the text, changes in the margin",
    })
    .click();
  await expect(page.locator(".own-insert")).toHaveCSS("font-size", "0px");
  await expect(page.locator(".revision-note")).toContainText("Gulls cried.");
});

test("saved, the file keeps the original and the changes are kept beside it, as Textus AI's are", async ({
  page,
}) => {
  await openDraft(page);
  await toggleTracking(page);
  await retype(page, "quiet", "still");
  await save(page);
  // The file: the original. Beside it: the original and the changed text.
  await expect.poll(() => file(page)).toContain("was quiet at dawn");
  await expect.poll(() => kept(page)).toContain("still at dawn");
  const sidecar = JSON.parse((await kept(page))!);
  expect(sidecar.base).toContain("quiet at dawn");
  expect(sidecar.revised).toContain("still at dawn");
  // Still shown as a change, to decide.
  await expect(page.locator(".own-insert")).toHaveText("still");

  // Accepted: into the file at once, nothing left beside it to decide.
  await page
    .locator(".revision-note", { hasText: "quiet" })
    .getByRole("button", { name: /Take this change/i })
    .click();
  await expect(page.locator(".own-insert, .own-delete")).toHaveCount(0);
  await expect.poll(() => file(page)).toContain("was still at dawn");

  // Stopped: the sidecar goes, the file holds the text.
  await toggleTracking(page);
  await expect.poll(() => kept(page)).toBeNull();
  await expect.poll(() => file(page)).toContain("was still at dawn");
});

test("tracking carries on when the document opens again", async ({ page }) => {
  // The file holds the original; the changed text is kept beside it.
  await openDraft(
    page,
    JSON.stringify({
      base: DOC,
      revised: "The harbour was still at dawn.\n",
    }),
  );
  await expect(page.locator(editor)).toContainText("still at dawn");
  await expect(page.locator(".own-delete")).toHaveText("quiet");
  await expect(page.locator(".own-insert")).toHaveText("still");
});

test("kept from before 1.3, the original alone carries on too", async ({
  page,
}) => {
  await openDraft(
    page,
    JSON.stringify({ base: "The harbour was silent at dawn.\n" }),
  );
  await expect(page.locator(".own-delete")).toHaveText("silent");
  await expect(page.locator(".own-insert")).toHaveText("quiet");
});

test("changes kept for an original the file no longer holds give way", async ({
  page,
}) => {
  await openDraft(
    page,
    JSON.stringify({
      base: "The harbour was empty at dawn.\n",
      revised: "The harbour was still at dawn.\n",
    }),
  );
  await expect(page.locator(editor)).toHaveText(
    "The harbour was quiet at dawn.",
  );
  await expect(page.locator(".own-insert, .own-delete")).toHaveCount(0);
});

test("closed with changes still to decide, it says they are kept", async ({
  page,
}) => {
  await openDraft(page);
  // A second tab, so closing the draft leaves the window open.
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-new-file"),
  );
  await page.locator(".tab-bar .tab-pill-title", { hasText: "draft" }).click();
  await toggleTracking(page);
  await retype(page, "quiet", "still");
  await save(page);
  await expect.poll(() => kept(page)).toContain("still at dawn");
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-close-tab"),
  );
  await expect(page.locator(".notice")).toContainText(
    "Changes to decide in draft.md: 1",
  );
});
