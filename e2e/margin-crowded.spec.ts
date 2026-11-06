import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * Crowded review notes stay by their passages as chips, opened by a click;
 * with more notes than lines, the run is one chip ("8 notes"). The notes bar
 * steps through them, marks them all done, and asks about some together.
 */

const PARA =
  "The harbour woke slowly. Gulls argued over the nets. A boy ran the length of the quay. The baker opened late. Two boats came in with nothing. The old pilot watched the sky. Rain was due by noon. Nobody believed it.";
const NEXT = "The second paragraph, with no notes.\n\nA third one.";

/** Notes on `anchors` of PARA, made at once. */
async function review(page: Page, anchors: string[]) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "original" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, `${PARA}\n\n${NEXT}`);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Review it" },
      ...anchors.flatMap((anchor, i) => [
        {
          kind: "ToolCall",
          call_id: `n${i}`,
          name: "add_comment",
          arguments: JSON.stringify({
            anchor,
            comment: `Note ${i + 1}: a longer remark on "${anchor}", long enough to wrap onto a few lines of its card.`,
          }),
        },
        { kind: "ToolResult", call_id: `n${i}`, output: "Comment added" },
      ]),
      { kind: "Assistant", text: "Done." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Review it");
  await composer.press("Enter");
  await expect(page.locator(".review-anchor")).toHaveCount(anchors.length);
  // The margin needs the room the panel takes.
  await page.keyboard.press("Control+Shift+L");
}

test("more notes than lines make one chip, which opens to them all", async ({
  page,
}) => {
  const anchors = [
    "The harbour woke",
    "Gulls argued",
    "A boy ran",
    "The baker",
    "Two boats",
    "The old pilot",
    "Rain was due",
    "Nobody believed",
  ];
  await review(page, anchors);
  const group = page.locator(".review-note-group");
  await expect(group).toHaveCount(1);
  await expect(group).toHaveText(/8 notes/);
  // One line for the group, not eight.
  await expect(page.locator(".review-links path")).toHaveCount(1);
  await group.locator(".review-note-group-head").click();
  const listed = group.locator(".review-note-group-list > .review-note");
  await expect(listed).toHaveCount(8);
  // Each lights its own passage, and is done from the list.
  await listed.nth(2).hover();
  await expect(page.locator(".review-anchor-hot")).toHaveText("A boy ran");
  await listed.nth(2).getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".review-anchor")).toHaveCount(7);
});

test("the notes bar steps through the notes, marks them all done, and asks about some together", async ({
  page,
}) => {
  await review(page, ["Gulls argued", "The baker", "Rain was due"]);
  const bar = page.locator(".review-bar-notes");
  await expect(bar).toContainText("Notes");
  await expect(bar.locator(".review-bar-pos")).toHaveText("3 notes");
  // Next: the first note in the text, its card open.
  await bar.getByRole("button", { name: "Next note" }).click();
  await expect(bar.locator(".review-bar-pos")).toHaveText("1 / 3");
  // The note and what it is about, lit together.
  await expect(page.locator(".review-anchor-hot")).toHaveText("Gulls argued");
  await expect(page.locator(".review-links path.hot")).toHaveCount(1);
  await bar.getByRole("button", { name: "Next note" }).click();
  await expect(bar.locator(".review-bar-pos")).toHaveText("2 / 3");
  await bar.getByRole("button", { name: "Previous note" }).click();
  await bar.getByRole("button", { name: "Previous note" }).click();
  await expect(bar.locator(".review-bar-pos")).toHaveText("3 / 3");

  // Pick two and ask about them: both go into the composer.
  await bar.getByRole("button", { name: "Select" }).click();
  await expect(bar).toContainText("0 selected");
  const boxes = page.locator(".review-note-pick");
  await expect(boxes).toHaveCount(3);
  await page.locator(".review-margin > .review-note").nth(0).click();
  await boxes.nth(2).check();
  await expect(bar).toContainText("2 selected");
  await bar.getByRole("button", { name: "Ask about it" }).click();
  const composer = page.locator(".agent-panel-view textarea");
  await expect(composer).toHaveValue(/About these notes of yours:/);
  await expect(composer).toHaveValue(/"Gulls argued"/);
  await expect(composer).toHaveValue(/"Rain was due"/);
  await expect(composer).not.toHaveValue(/"The baker"/);
  await expect(page.locator(".review-note-pick")).toHaveCount(0);

  // All done: every note goes, and the bar with them.
  await page.keyboard.press("Control+Shift+L");
  await bar.getByRole("button", { name: "All done" }).click();
  await expect(page.locator(".review-anchor")).toHaveCount(0);
  await expect(bar).toHaveCount(0);
});
