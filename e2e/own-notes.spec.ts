import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * The writer's own notes: added from the context menu, shown in the margin
 * marked Me, kept outside the Markdown and back on their words on reopen.
 */

const PATH = "/notes/draft.md";
const DOC =
  "The harbour was quiet at dawn.\n\nThe boats came in late, and the harbour filled with voices.\n";
const editor = '[data-active-tab="true"] .ProseMirror';

async function openDraft(page: Page, kept?: string) {
  await page.addInitScript(
    ({ path, doc, kept }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__devFiles = { [path]: doc };
      w.__devInvokeResults = { take_pending_window_paths: [path] };
      if (kept) w.__devOwnNotes = { [`notes:${path}`]: kept };
    },
    { path: PATH, doc: DOC, kept },
  );
  await openApp(page, { settings: { language: "en" } });
  await expect(page.locator(editor)).toContainText("The boats came in late");
}

/** Selects `words` in the paragraph holding them. */
async function select(page: Page, paragraph: string, words: string) {
  await page.locator(editor).evaluate(
    (root, { paragraph, words }) => {
      const p = Array.from(root.querySelectorAll("p")).find((el) =>
        el.textContent?.includes(paragraph),
      )!;
      const text = p.firstChild!;
      const at = text.textContent!.indexOf(words);
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + words.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    },
    { paragraph, words },
  );
}

const kept = (page: Page) =>
  page.evaluate(
    (path) =>
      ((window as unknown as { __devOwnNotes?: Record<string, string> })
        .__devOwnNotes ?? {})[`notes:${path}`] ?? null,
    PATH,
  );

test("Add Note puts the writer's note in the margin, marked Me, and keeps it", async ({
  page,
}) => {
  await openDraft(page);
  await select(page, "The boats came in late", "harbour");
  await page
    .locator(`${editor} p`, { hasText: "The boats came in late" })
    .click({ button: "right", position: { x: 5, y: 5 } });
  await page.getByRole("menuitem", { name: "Add Note" }).click();
  const dialog = page.locator(".app-dialog");
  await dialog.getByRole("textbox").fill("Say which harbour.");
  await dialog.getByRole("button", { name: "Save" }).click();

  const card = page.locator(".review-note", { hasText: "Say which harbour." });
  await expect(card).toBeVisible();
  await expect(card.locator(".review-note-mark-me")).toHaveText("Me");
  await expect(card).toContainText("Your note");
  // On the second paragraph's "harbour", not the first one's.
  await expect(page.locator(".review-anchor")).toHaveText("harbour");
  await expect(
    page
      .locator(`${editor} p`, { hasText: "The boats" })
      .locator(".review-anchor"),
  ).toHaveCount(1);

  // Kept beside the app's data, with what finds it again.
  await expect.poll(() => kept(page)).toContain("Say which harbour.");
  const stored = JSON.parse((await kept(page))!);
  expect(stored).toEqual([
    expect.objectContaining({
      anchor: "harbour",
      before: "The boats came in late, and the ",
      comment: "Say which harbour.",
    }),
  ]);

  // Edited, then deleted - and the kept file goes with it.
  await card.click();
  await card.getByRole("button", { name: "Edit" }).click();
  await dialog.getByRole("textbox").fill("Name the harbour.");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(
    page.locator(".review-note", { hasText: "Name the harbour." }),
  ).toBeVisible();
  await expect.poll(() => kept(page)).toContain("Name the harbour.");
  await page
    .locator(".review-note", { hasText: "Name the harbour." })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.locator(".review-note")).toHaveCount(0);
  await expect.poll(() => kept(page)).toBeNull();
});

test("a kept note is back on its words when the document opens", async ({
  page,
}) => {
  await openDraft(
    page,
    JSON.stringify([
      {
        id: "me-1",
        comment: "Say which harbour.",
        anchor: "harbour",
        before: "The boats came in late, and the ",
      },
    ]),
  );
  const card = page.locator(".review-note", { hasText: "Say which harbour." });
  await expect(card).toBeVisible();
  await expect(
    page
      .locator(`${editor} p`, { hasText: "The boats" })
      .locator(".review-anchor"),
  ).toHaveText("harbour");
  // The Markdown has nothing of it.
  await expect(page.locator(editor)).not.toContainText("Say which harbour.");
});
