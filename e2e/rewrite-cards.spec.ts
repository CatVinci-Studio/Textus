import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * A rewrite of the whole text, every sentence changed: a card in the
 * margin for each change, beside its own passage - not one card for the
 * lot.
 */

const BEFORE = [
  "The tide went out before dawn. Boats lay on the mud.",
  "Gulls came down to the water. They fought over scraps.",
  "At dusk the boats came back. The harbour filled with voices.",
];
const AFTER = [
  "Before dawn the tide drew back. The boats rested on the mud.",
  "Gulls dropped to the shallows. They squabbled over scraps.",
  "The boats returned at dusk. Voices filled the harbour.",
];

async function proposeRewrite(page: Page, before: string, after: string) {
  await page.setViewportSize({ width: 1800, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "original" },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, before);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Rewrite it all" },
      {
        kind: "ToolCall",
        call_id: "e1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: before,
          text: after,
        }),
      },
      { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
      { kind: "Assistant", text: "Rewritten." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Rewrite it all");
  await composer.press("Enter");
  await expect(page.locator(".review-bar")).toBeVisible();
}

/** The cards' tops, top to bottom as the margin shows them. */
const cardTops = (page: Page) =>
  page
    .locator(".revision-note")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));

test("a rewrite of the whole text has a card for each change, beside its passage", async ({
  page,
}) => {
  await proposeRewrite(page, BEFORE.join("\n\n"), AFTER.join("\n\n"));
  await expect(page.locator(".revision-note")).toHaveCount(6);
  const tops = await cardTops(page);
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  expect(tops[5] - tops[0]).toBeGreaterThan(60);
});

test("a rewrite that merges paragraphs has a card beside each one it changed", async ({
  page,
}) => {
  await proposeRewrite(
    page,
    BEFORE.join("\n\n"),
    "Before dawn the tide drew back, and the boats rested on the mud while gulls squabbled over scraps; at dusk they returned and voices filled the harbour.",
  );
  await expect
    .poll(() => page.locator(".revision-note").count())
    .toBeGreaterThanOrEqual(3);
  const tops = await cardTops(page);
  // Spread down the page beside the three paragraphs, not one at the top.
  expect(tops[tops.length - 1] - tops[0]).toBeGreaterThan(60);
});
