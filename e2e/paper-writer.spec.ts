import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// Research mode: the message is the topic, which goes to ai_paper_run; its
// outline waits on a card, Approve drafts it into the document as it is
// written, and the finished paper takes its place there, with nothing to
// accept.

const outline = {
  thesis: "Green roofs cool cities measurably.",
  sections: [
    {
      title: "How roofs cool",
      keyPoints: ["Albedo"],
      evidence: ["n1"],
      targetWords: 600,
      figures: [{ kind: "mermaid", spec: "Heat flows" }],
    },
    {
      title: "What the measurements show",
      keyPoints: ["Noon temperatures"],
      evidence: ["n2"],
      targetWords: 700,
      figures: [],
    },
  ],
};

const paper = [
  "# Cooler Roofs",
  "**Abstract:** Green roofs lower roof temperatures.",
  "## How plants cool roofs",
  "Plants shade the roof \\[1\\].",
  "## References",
  "\\[1\\] A study. <https://example.org/study>",
].join("\n\n");

test("a paper is researched, its outline approved, and written into the document", async ({
  page,
}) => {
  await page.addInitScript(
    ({ outline, paper }) => {
      (
        window as unknown as { __devInvokeResults: unknown }
      ).__devInvokeResults = {
        ai_paper_run: {
          __events: [
            { type: "phase", phase: "planning" },
            { type: "phase", phase: "researching" },
            {
              type: "budget",
              used: { searches: 12, fetches: 20, paperLookups: 5, images: 0 },
              remaining: {
                searches: 28,
                fetches: 40,
                paperLookups: 25,
                images: 2,
              },
            },
            { type: "phase", phase: "outlining" },
            { type: "outlineReady", outline },
            { type: "phase", phase: "awaitingOutline" },
          ],
          value: {
            id: "abc123",
            topic: "Green roofs",
            language: "en",
            targetChars: 8000,
          },
        },
        ai_paper_save_outline: {
          ...outline,
          sections: [
            { ...outline.sections[0], title: "How plants cool roofs" },
            outline.sections[1],
          ],
        },
        ai_paper_draft: {
          __events: [
            { type: "phase", phase: "drafting" },
            { type: "section", index: 0, status: "drafting" },
            { type: "sectionText", index: 0, text: "Plants shade" },
            { type: "phase", phase: "finishing" },
            { type: "ready", markdown: paper },
            { type: "phase", phase: "done" },
          ],
          value: null,
        },
      };
    },
    { outline, paper },
  );
  await openApp(page, {
    settings: { language: "en", agentDefaultMode: "write" },
    storage: { "textus-agent-panel-open": "1" },
  });

  const panel = page.locator(".agent-panel-view");
  await panel.getByRole("combobox", { name: /^Mode/ }).click();
  await page.getByRole("option", { name: "Research" }).click();
  await panel.locator("textarea").fill("Green roofs");
  await panel.locator("textarea").press("Enter");

  const card = page.locator(".paper-card");
  await expect(card).toContainText("Green roofs");
  // One section opened to edit at a time.
  await card.getByRole("button", { name: "Edit: How roofs cool" }).click();
  await expect(page.getByLabel("Section 1 title")).toHaveValue(
    "How roofs cool",
  );
  await page.getByLabel("Section 1 title").fill("How plants cool roofs");
  await page.getByRole("button", { name: "Approve and write" }).click();

  await expect(card).toContainText("Written in the document.");
  const calls = await page.evaluate(() =>
    (
      (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
        .__devInvokeCalls ?? []
    ).map(
      (c) =>
        c as {
          cmd: string;
          id?: string;
          outline?: typeof outline;
          request?: { topic?: string; id?: string };
        },
    ),
  );
  const run = calls.find((c) => c.cmd === "ai_paper_run");
  expect(run?.request?.topic).toBe("Green roofs");
  const saved = calls.find((c) => c.cmd === "ai_paper_save_outline");
  expect(saved?.id).toBe("abc123");
  expect(saved?.outline?.sections[0].title).toBe("How plants cool roofs");
  expect(calls.find((c) => c.cmd === "ai_paper_draft")?.request?.id).toBe(
    "abc123",
  );

  // The paper is in the empty document as it was, with nothing to accept
  // and no blank line above it.
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor.locator("> :first-child")).toHaveText("Cooler Roofs");
  await expect(editor.locator("h1")).toHaveText("Cooler Roofs");
  await expect(editor).toContainText("Plants shade the roof [1].");
  await expect(editor.locator("h2").last()).toHaveText("References");
  await expect(
    page.getByRole("button", { name: "Accept", exact: true }),
  ).toHaveCount(0);
  // One Undo takes it out.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("Cooler Roofs");
});
