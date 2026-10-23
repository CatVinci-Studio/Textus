import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * Review notes where they crowd (rc.6 feedback): many notes on one
 * paragraph stacked down past it as whole cards, beside other paragraphs
 * and below the text's end. Cut to the room beside their lines they stay
 * by their passages - chips - and where there are more notes than lines,
 * the run is one chip, "8 notes", which opens to them all.
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

const tops = (page: Page) =>
  page
    .locator(".review-margin > .review-note")
    .evaluateAll((els: HTMLElement[]) => els.map((e) => e.offsetTop));

test("notes that crowd a paragraph stand by their lines as chips, and open in place", async ({
  page,
}) => {
  await review(page, ["Gulls argued", "A boy ran", "The baker", "Two boats"]);
  const notes = page.locator(".review-margin > .review-note");
  await expect(notes).toHaveCount(4);
  await expect(page.locator(".review-note-chip")).not.toHaveCount(0);
  // Each card stands near its own passage, not stacked off down the page.
  const off = await notes.evaluateAll((els: HTMLElement[]) =>
    els.map((card) => {
      const id = CSS.escape(card.dataset.note ?? "");
      const anchor = document.querySelector(
        `.review-anchor[data-note="${id}"]`,
      )!;
      return Math.abs(
        card.getBoundingClientRect().top - anchor.getBoundingClientRect().top,
      );
    }),
  );
  expect(Math.max(...off)).toBeLessThan(100);
  const before = await tops(page);
  // Pointed at, a chip opens whole, with its actions; the others stay put.
  const chip = page.locator(".review-note-chip").first();
  await chip.hover();
  await expect(page.locator(".review-note-cut-open")).toHaveCount(1);
  await expect(
    page.locator(".review-note-cut-open").getByRole("button", { name: "Done" }),
  ).toBeVisible();
  expect(await tops(page)).toEqual(before);
});

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
  await expect(page.locator(".review-links path")).toHaveCount(8);
  await group.hover();
  const listed = group.locator(".review-note-group-list > .review-note");
  await expect(listed).toHaveCount(8);
  // Each lights its own passage, and is done from the list.
  await listed.nth(2).hover();
  await expect(page.locator(".review-anchor-hot")).toHaveText("A boy ran");
  await listed.nth(2).getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".review-anchor")).toHaveCount(7);
});
