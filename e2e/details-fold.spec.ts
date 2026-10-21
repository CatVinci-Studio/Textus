import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * A <details> written around markdown folds that markdown away
 * (editor/html/details-fold.ts). Whatever points into the
 * folded text - find, the outline, the AI's edits and notes, the caret -
 * opens it, so nothing it points at is hidden.
 */

const HIDDEN = "The zebracorn hides in a sentence that could be shorter.";
const NOTED = "A second hidden sentence gets a note.";

const DOC = [
  // Not HTML first: a paste puts its first block into the empty line as
  // plain text.
  "# Notes",
  "",
  "Intro paragraph.",
  "",
  "<details>",
  "<summary>Folded notes</summary>",
  "",
  "## Inside heading",
  "",
  HIDDEN,
  "",
  NOTED,
  "",
  "</details>",
  "",
  "The end.",
].join("\n");

function emit(page: Page, name: string) {
  return page.evaluate(
    (n) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string) => void;
        }
      ).__devEmitTauriEvent(n),
    name,
  );
}

async function openFolded(
  page: Page,
  storage: Record<string, string> = {},
  doc = DOC,
) {
  await openApp(page, { settings: { language: "en" }, storage });
  await pasteMarkdown(page, doc);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor.locator(".raw-html-details-head summary")).toBeVisible();
  const hidden = editor.locator("p", { hasText: "zebracorn" });
  await expect(hidden).toBeHidden();
  return { editor, hidden };
}

test("find opens a fold on the match it shows, and Replace All reaches folded text", async ({
  page,
}) => {
  const { editor, hidden } = await openFolded(page);
  await emit(page, "menu-find-replace");
  await page.locator(".find-replace-input").first().fill("zebracorn");
  const match = editor.locator(".find-match-active");
  await expect(match).toHaveText("zebracorn");
  await expect(match).toBeInViewport();
  await expect(hidden).toBeVisible();

  // Folded again, Replace All still changes the text under the fold.
  await editor.locator(".raw-html-details-head summary").click();
  await expect(hidden).toBeHidden();
  await page.locator(".find-replace-chevron").click();
  await page.locator(".find-replace-input").nth(1).fill("unicorn");
  await page.getByRole("button", { name: "Replace All" }).click();
  await editor.locator(".raw-html-details-head summary").click();
  await expect(editor.locator("p", { hasText: "unicorn" })).toBeVisible();
  await expect(editor).not.toContainText("zebracorn");
  // The fold itself is untouched.
  await expect(editor.locator(".raw-html-details-head summary")).toHaveText(
    "Folded notes",
  );
});

test("the outline lists a heading inside a fold and opens it on a jump", async ({
  page,
}) => {
  const { editor } = await openFolded(page);
  await emit(page, "menu-toggle-sidebar");
  await page.locator(".sidebar-tab").nth(1).click();
  const row = page.locator(".outline-row .tree-label", {
    hasText: "Inside heading",
  });
  await expect(row).toBeVisible();
  await row.click();
  const heading = editor.locator("h2", { hasText: "Inside heading" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeInViewport();
});

test("Ctrl/Cmd+click on a #heading link opens the fold the heading is in", async ({
  page,
}) => {
  const { editor } = await openFolded(
    page,
    {},
    DOC.replace(
      "Intro paragraph.",
      "Intro paragraph, [see inside](#inside-heading).",
    ),
  );
  const heading = editor.locator("h2", { hasText: "Inside heading" });
  await expect(heading).toBeHidden();
  await editor
    .locator("a", { hasText: "see inside" })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(heading).toBeVisible();
  await expect(heading).toBeInViewport();
});

test("an AI edit and a review note on folded text open the fold", async ({
  page,
}) => {
  // Wide enough for the margin, where the note goes.
  await page.setViewportSize({ width: 1440, height: 900 });
  const { editor, hidden } = await openFolded(page, {
    "levis-agent-panel-open": "1",
  });
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Tighten the hidden part" },
      {
        kind: "ToolCall",
        call_id: "e1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: HIDDEN,
          text: "The zebracorn hides in a short sentence.",
          reason: "Shorter.",
        }),
      },
      { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "add_comment",
        arguments: JSON.stringify({ anchor: NOTED, comment: "Say why." }),
      },
      { kind: "ToolResult", call_id: "c1", output: "Comment added" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tighten the hidden part");
  await composer.press("Enter");
  await expect(page.locator(".agent-proposal-reason")).toHaveText("Shorter.");
  await expect(hidden).toBeVisible();
  await expect(editor.locator("p", { hasText: NOTED })).toBeVisible();
  await expect(page.locator(".review-note:not(.revision-note)")).toBeVisible();
  await page.locator(".review-bar-accept").click();
  await expect(editor).toContainText(
    "The zebracorn hides in a short sentence.",
  );
});

test("a grammar check asked for in folded text opens it", async ({ page }) => {
  const { editor, hidden } = await openFolded(page);
  // The caret into the folded text (it opens), then the fold closed over it.
  await editor.locator(".raw-html-details-head summary").click();
  await hidden.click();
  await editor.locator(".raw-html-details-head summary").click();
  await expect(hidden).toBeHidden();
  await mockInvoke(page, {
    ai_grammar_check: [
      {
        start: 4,
        end: 13,
        issue: "Spelling.",
        suggestion: "unicorn",
        original: "zebracorn",
      },
    ],
  });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("textus:trigger-grammar-check")),
  );
  await expect(editor.locator(".grammar-issue")).toBeVisible();
  await expect(hidden).toBeVisible();
});

test("a continuation after a fold lands in its own paragraph and leaves the fold alone", async ({
  page,
}) => {
  const { editor, hidden } = await openFolded(page);
  await editor.getByText("The end.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Now");
  const ghost = page.locator(".ghost-text");
  await expect(ghost).toHaveAttribute(
    "data-suggestion",
    " and this ghost text is a canned dev-shim suggestion.",
  );
  await expect(hidden).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(editor.locator("p").last()).toHaveText(
    "The end. Now and this ghost text is a canned dev-shim suggestion.",
  );
  await expect(hidden).toBeHidden();
  // At the end of folded text (opened by the caret), mid-document, one is
  // offered too, and goes into that paragraph, inside the fold.
  await editor.locator(".raw-html-details-head summary").click();
  await editor.getByText(NOTED).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" More");
  await expect(ghost).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(editor.locator("p", { hasText: NOTED })).toHaveText(
    `${NOTED} More and this ghost text is a canned dev-shim suggestion.`,
  );
  await expect(editor.locator(".raw-html-details-head summary")).toHaveCount(1);
});

test("the arrow keys stop on a fold's source lines instead of skipping them", async ({
  page,
}) => {
  const { editor } = await openFolded(page);
  // The paste left the caret at the end of "The end.": up stops on
  // "</details>" (hidden until the caret is on it).
  await page.keyboard.press("ArrowUp");
  await expect(editor).toContainText("</details>", { useInnerText: true });

  // From the paragraph above, down stops on the head's source.
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await expect(editor).not.toContainText("</details>", { useInnerText: true });
  await page.keyboard.press("ArrowDown");
  await expect(editor).toContainText("<summary>Folded notes</summary>", {
    useInnerText: true,
  });
});
