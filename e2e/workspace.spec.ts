import { expect, test } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

const sections = ["Motivation", "Method", "Experiments", "Conclusion"];
const turns = sections.flatMap((title, index) => [
  {
    kind: "ToolCall",
    call_id: `section-${index}`,
    name: "propose_edit",
    arguments: JSON.stringify({
      action: "append",
      text: `## ${title}\n\nContent for ${title}.`,
    }),
  },
  { kind: "ToolResult", call_id: `section-${index}`, output: "Edit proposed" },
]);

test("recovers an unaccepted draft across reload without sending another model request", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, { ai_agent_message: turns });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  let workspace = page.getByRole("region", { name: "Agent Workspace" });
  await workspace.locator(".inline-chat-input").fill("Write four sections");
  await workspace.getByRole("button", { name: "Send", exact: true }).click();
  await expect(workspace.locator(".workspace-document h2")).toHaveCount(4);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(
            JSON.parse(localStorage.getItem("dev-workspace-drafts") ?? "{}"),
          ).length,
      ),
    )
    .toBe(1);
  await page.reload();
  // The startup document opens on Agent; on Write, go there.
  const toAgent = page.getByRole("button", { name: "Agent", exact: true });
  await page.waitForSelector('[data-active-tab="true"] .ProseMirror', {
    state: "attached",
  });
  if (await toAgent.isVisible()) await toAgent.click();
  workspace = page.getByRole("region", { name: "Agent Workspace" });
  await expect(workspace.locator(".workspace-document h2")).toHaveCount(4);
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).not.toContainText("Motivation");
  await expect(
    workspace.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
});

test("creates a reviewed four-section draft in the same editor and undoes one batch", async ({
  page,
}, testInfo) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Create an article" },
      ...turns,
      { kind: "Assistant", text: "The four sections are ready to review." },
    ],
  });
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const workspace = page.getByRole("region", { name: "Agent Workspace" });
  await workspace.locator(".inline-chat-input").fill("Create an article");
  await workspace.getByRole("button", { name: "Send", exact: true }).click();
  await expect(workspace.locator(".workspace-document h2")).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath("workspace-desktop.png") });
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(page.getByRole("button", { name: /^Write ·/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspace-narrow.png") });
  await page.setViewportSize({ width: 1180, height: 780 });
  await expect(editor).not.toContainText("Motivation");
  await page.getByRole("button", { name: /^Write ·/ }).click();
  await expect(editor).not.toContainText("Motivation");
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(workspace.locator(".workspace-document h2")).toHaveCount(4);
  await workspace
    .getByRole("button", { name: "Accept all", exact: true })
    .click();
  await page.getByRole("button", { name: /^Write ·/ }).click();
  for (const title of sections) await expect(editor).toContainText(title);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+z");
  for (const title of sections) await expect(editor).not.toContainText(title);
});

test("preserves a draft and refuses to overwrite an intervening manual edit", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Original text.");
  await mockInvoke(page, { ai_agent_message: turns });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const workspace = page.getByRole("region", { name: "Agent Workspace" });
  await workspace.locator(".inline-chat-input").fill("Write four chapters");
  await workspace.getByRole("button", { name: "Send", exact: true }).click();
  await expect(workspace.locator(".workspace-document h2")).toHaveCount(4);
  await page.getByRole("button", { name: /^Write ·/ }).click();
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Manual edit.");
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await workspace
    .getByRole("button", { name: "Accept all", exact: true })
    .click();
  await expect(workspace.getByRole("alert")).toContainText("document changed");
  await expect(workspace.locator(".workspace-document h2")).toHaveCount(4);
  await page.getByRole("button", { name: /^Write ·/ }).click();
  await expect(editor).toContainText("Manual edit.");
  await expect(editor).not.toContainText("Motivation");
});

test("Agent and Write are one mode for the window, across existing tabs", async ({
  page,
}) => {
  await openApp(page, { home: true, settings: { language: "en" } });
  const emit = (name: string) =>
    page.evaluate(
      (event) =>
        (
          window as unknown as { __devEmitTauriEvent: (e: string) => void }
        ).__devEmitTauriEvent(event),
      name,
    );
  await emit("menu-new-file");
  const pills = page.locator(".tab-bar [data-flip-id]");
  await expect(pills).toHaveCount(3); // two tabs and "+"
  const workspace = page.getByRole("region", { name: "Agent Workspace" });
  await expect(workspace).toBeVisible();
  // Write on the second tab, then back to the first: still Write.
  await page.getByRole("button", { name: /^Write ·/ }).click();
  await pills.first().click();
  await expect(
    page.getByRole("button", { name: "Agent", exact: true }),
  ).toBeVisible();
  await expect(workspace).toBeHidden();
  // Agent on the first, then the second: still Agent.
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await pills.nth(1).click();
  await expect(page.getByRole("button", { name: /^Write ·/ })).toBeVisible();
  // Source mode does nothing in Agent (it would unmount the conversation).
  await emit("menu-toggle-source-mode");
  await expect(page.locator("textarea.source-view")).toHaveCount(0);
});

test("a past task opened from the history brings back its document", async ({
  page,
}) => {
  await openApp(page, { home: true, settings: { language: "en" } });
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Summarise the journey" },
      {
        kind: "ToolCall",
        call_id: "c1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "append",
          text: "# Journey notes\n\nFour pilgrims travel west.",
        }),
      },
      { kind: "ToolResult", call_id: "c1", output: "Edit proposed" },
    ],
  });
  const workspace = page.getByRole("region", { name: "Agent Workspace" });
  await workspace.locator(".inline-chat-input").fill("Summarise the journey");
  await workspace.getByRole("button", { name: "Send", exact: true }).click();
  await workspace
    .getByRole("button", { name: "Accept all", exact: true })
    .click();
  // A new document, then the earlier task from its history list.
  await page.evaluate(() =>
    window.dispatchEvent(new Event("textus:new-document")),
  );
  const active = page.getByRole("region", { name: "Agent Workspace" }).last();
  await active
    .locator(".workspace-history-task", { hasText: "Summarise the journey" })
    .click();
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).toContainText("Four pilgrims travel west.");
  await expect(
    page.locator(".agent-workspace-layer:not([hidden]) .inline-chat-messages"),
  ).toContainText("Summarise the journey");
});

test("auto-writing plans from project files and writes section by section with review", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() => {
    const runtime = (window as any).__TAURI_INTERNALS__;
    const original = runtime.invoke;
    let call = 0;
    runtime.invoke = async (command: string, args: any) => {
      if (command === "project_folder") return "/p/novel";
      if (command === "list_project_entries")
        return [
          { path: "chapter.md", kind: "text", bytes: 1200 },
          { path: "notes/outline.md", kind: "text", bytes: 300 },
          { path: "notes/人物设定.docx", kind: "document", bytes: 20480 },
          { path: "pics/lake.jpg", kind: "image", bytes: 90000 },
        ];
      if (command === "read_project_file")
        return "1. Origins\n2. Journey\nAudience: students.";
      if (command === "ai_agent_message") {
        if (args.engine !== undefined)
          throw new Error("Not the built-in agent");
        if (args.message.startsWith("You plan a writing project"))
          return [
            {
              kind: "Assistant",
              text: JSON.stringify({
                title: "Journey West",
                guide: "Plain words for students",
                sections: [
                  { title: "Origins", brief: "The stone monkey", length: 200 },
                  { title: "Journey", brief: "Eighty-one trials", length: 200 },
                ],
              }),
            },
          ];
        const title = /Write section \d+, "([^"]+)"/.exec(args.message)?.[1];
        const id = `auto-${++call}`;
        return [
          { kind: "User", text: args.message },
          {
            kind: "ToolCall",
            call_id: id,
            name: "propose_edit",
            arguments: JSON.stringify({
              action: "append",
              text: `## ${title}\n\nText of ${title}.`,
            }),
          },
          { kind: "ToolResult", call_id: id, output: "Edit proposed" },
          { kind: "Assistant", text: `${title} is ready.` },
        ];
      }
      return original(command, args);
    };
  });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const workspace = page.getByRole("region", { name: "Agent Workspace" });
  await workspace
    .getByRole("button", { name: "Add content and tools" })
    .click();
  await workspace.getByRole("menuitem", { name: /Auto-writing/ }).click();
  const writer = workspace.getByRole("region", { name: "Auto-writing" });
  // Every file of the folder, in its tree: plan-like documents and the
  // pictures ticked to start with, other text not.
  await expect(
    writer.getByRole("checkbox", { name: "outline.md" }),
  ).toBeChecked();
  await expect(
    writer.getByRole("checkbox", { name: "人物设定.docx" }),
  ).toBeChecked();
  await expect(
    writer.getByRole("checkbox", { name: "lake.jpg" }),
  ).toBeChecked();
  await expect(
    writer.getByRole("checkbox", { name: "chapter.md" }),
  ).not.toBeChecked();
  await expect(
    writer.getByText("2 material files · 1 pictures selected"),
  ).toBeVisible();
  await writer.getByRole("button", { name: "Plan sections" }).click();
  await expect(writer.locator(".auto-writer-outline li")).toHaveCount(2);
  await writer.getByRole("button", { name: "Start writing" }).click();
  // Each section is a reviewed draft, shown in the chat by one short line.
  await expect(writer.getByText(/review it in the draft/)).toBeVisible();
  await expect(
    workspace.getByText("[Auto-writing 1/2] Origins", { exact: true }).first(),
  ).toBeVisible();
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  await expect(writer.locator(".auto-writer-outline li.is-done")).toHaveCount(
    1,
  );
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  await expect(writer.getByText("Finished")).toBeVisible();
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor.locator("h2")).toHaveText(["Origins", "Journey"]);
});
