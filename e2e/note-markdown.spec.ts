import { expect, test } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

/**
 * A review note's words keep their inline Markdown, in the margin and in
 * the chat's card: a term in **bold** is bold, not wrapped in asterisks
 * (rc.6, in a real window: "**relief crew**: 换防人员").
 */
test("a review note's bold term shows bold, without its asterisks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "When the relief crew came up, I wrote it down.");
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Note the hard words" },
      {
        kind: "ToolCall",
        call_id: "n1",
        name: "add_comment",
        arguments: JSON.stringify({
          anchor: "relief crew",
          comment: "**relief crew**: the shift that takes over.",
        }),
      },
      { kind: "ToolResult", call_id: "n1", output: "Comment added" },
      { kind: "Assistant", text: "One note." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Note the hard words");
  await composer.press("Enter");
  for (const text of [
    page.locator(".review-note-text").first(),
    page.locator(".agent-comment-text").first(),
  ]) {
    await expect(text).toContainText("relief crew: the shift that takes over.");
    await expect(text.locator("strong")).toHaveText("relief crew");
  }
});
