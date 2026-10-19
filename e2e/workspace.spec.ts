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
  await expect(
    page.getByRole("button", { name: /^(Write|写作) ·/ }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspace-narrow.png") });
  await page.setViewportSize({ width: 1180, height: 780 });
  await expect(editor).not.toContainText("Motivation");
  await page.getByRole("button", { name: /^(Write|写作) ·/ }).click();
  await expect(editor).not.toContainText("Motivation");
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(workspace.locator(".workspace-document h2")).toHaveCount(4);
  await workspace
    .getByRole("button", { name: "Accept all", exact: true })
    .click();
  await page.getByRole("button", { name: /^(Write|写作) ·/ }).click();
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
  await page.getByRole("button", { name: /^(Write|写作) ·/ }).click();
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
  await page.getByRole("button", { name: /^(Write|写作) ·/ }).click();
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
  await page.getByRole("button", { name: /^(Write|写作) ·/ }).click();
  await pills.first().click();
  await expect(
    page.getByRole("button", { name: /^(Write|写作) ·/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(workspace).toBeHidden();
  // Agent on the first, then the second: still Agent.
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await pills.nth(1).click();
  await expect(
    page.getByRole("button", { name: "Agent", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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
  // A new document from Agent stays on Agent; then the earlier task from
  // its history list.
  await page.evaluate(() =>
    window.dispatchEvent(new Event("textus:new-document")),
  );
  await expect(page.locator(".tab-pill")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Agent", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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
  // No separate form: the composer's folder chip picks the material, and
  // a send in Create mode with material picked plans and writes it.
  // The folder is optional: nothing shows until it is added from "+",
  // and adding it opens its picker.
  await expect(workspace.locator(".project-chip")).toHaveCount(0);
  await workspace
    .getByRole("button", { name: "Add content and tools" })
    .click();
  await workspace.getByRole("menuitem", { name: /Add project folder/ }).click();
  const picker = page.getByRole("dialog", { name: "Project material" });
  // Every file of the folder, in its tree: plan-like documents and the
  // pictures ticked to start with, other text not.
  await expect(
    picker.getByRole("checkbox", { name: "outline.md" }),
  ).toBeChecked();
  await expect(
    picker.getByRole("checkbox", { name: "人物设定.docx" }),
  ).toBeChecked();
  await expect(
    picker.getByRole("checkbox", { name: "lake.jpg" }),
  ).toBeChecked();
  await expect(
    picker.getByRole("checkbox", { name: "chapter.md" }),
  ).not.toBeChecked();
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(workspace.locator(".project-chip-count")).toHaveText(
    "2 files · 1 pictures",
  );
  await workspace.locator(".inline-chat-input").fill("For students");
  await workspace.getByRole("button", { name: "Send", exact: true }).click();
  const writer = workspace.getByRole("region", { name: "Auto-writing" });
  await expect(writer.locator(".auto-writer-outline li")).toHaveCount(2);
  await writer.getByRole("button", { name: "Start writing" }).click();
  // Each section is a reviewed draft, shown in the chat by one short line.
  await expect(writer.getByText(/Accept it in the draft/)).toBeVisible();
  // In the chat, the section is one folded row.
  await expect(
    workspace.locator(".agent-section-row", { hasText: "Origins" }),
  ).toBeVisible();
  await writer.getByRole("button", { name: "Accept and continue" }).click();
  await expect(writer.locator(".auto-writer-outline li.is-done")).toHaveCount(
    1,
  );
  // Accepted in the draft itself, the section goes on (here: finishes)
  // without "Accept and continue".
  await workspace
    .getByRole("button", { name: "Accept all", exact: true })
    .click();
  await expect(writer.getByText("Finished")).toBeVisible();
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor.locator("h2")).toHaveText(["Origins", "Journey"]);
});

test("writing in sections needs no folder: the switch and a Create-mode send", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (c: string, a: Record<string, unknown>) => Promise<unknown>;
      };
    };
    const original = w.__TAURI_INTERNALS__.invoke.bind(w.__TAURI_INTERNALS__);
    w.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === "project_folder") return null;
      if (command === "list_project_entries") return [];
      if (command === "ai_agent_message") {
        const message = String(args.message);
        if (message.startsWith("You plan a writing project"))
          return [
            {
              kind: "Assistant",
              text: JSON.stringify({
                title: "Rain",
                guide: "",
                sections: [{ title: "Night", brief: "", length: 200 }],
              }),
            },
          ];
      }
      return original(command, args);
    };
  });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const workspace = page.getByRole("region", { name: "Agent Workspace" });
  await expect(workspace.locator(".project-chip")).toHaveCount(0);
  await workspace
    .getByRole("button", { name: "Add content and tools" })
    .click();
  await workspace
    .getByRole("menuitemcheckbox", { name: /Write in sections/ })
    .click();
  await workspace
    .locator(".inline-chat-input")
    .fill("A short story about rain");
  await workspace.getByRole("button", { name: "Send", exact: true }).click();
  const writer = workspace.getByRole("region", { name: "Auto-writing" });
  await expect(writer.getByText("A short story about rain")).toBeVisible();
  await expect(writer.locator(".auto-writer-outline li")).toHaveCount(1);
});

test("the Agent | Write switch follows the window bar when its slot is redrawn", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const toAgent = page.getByRole("button", { name: "Agent", exact: true });
  await expect(toAgent).toBeVisible();
  // As a hot reload or a re-render does: the bar keeps its place, its slot
  // is a new element.
  await page.evaluate(() => {
    const old = document.querySelector(".window-bar-start")!;
    const fresh = document.createElement("span");
    fresh.className = "window-bar-start";
    old.replaceWith(fresh);
  });
  await expect(toAgent).toBeVisible();
  await toAgent.click();
  await expect(
    page.getByRole("region", { name: "Agent Workspace" }),
  ).toBeVisible();
  // And the shortcut switches back.
  await page.keyboard.press("ControlOrMeta+Shift+A");
  await expect(
    page.getByRole("button", { name: /^(Write|写作) ·/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("a past task has its own menu, and deleting it can be undone", async ({
  page,
}) => {
  await openApp(page, {
    home: true,
    settings: { language: "en" },
  });
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Summarise the journey" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  const workspace = page.getByRole("region", { name: "Agent Workspace" });
  await workspace.locator(".inline-chat-input").fill("Summarise the journey");
  await workspace.getByRole("button", { name: "Send", exact: true }).click();
  await expect(workspace.getByText("Done.")).toBeVisible();
  // A new task puts the first one in the history.
  await workspace.getByRole("button", { name: "New task" }).click();
  const task = workspace.locator(".workspace-history-task", {
    hasText: "Summarise the journey",
  });
  await expect(task).toBeVisible();
  // Right-click: the task's menu, not the editor's.
  await task.click({ button: "right" });
  const menu = page.locator(".context-menu");
  await expect(menu.getByRole("button", { name: "Open" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Paste" })).toHaveCount(0);
  await menu.getByRole("button", { name: "Delete task" }).click();
  await expect(task).toHaveCount(0);
  await workspace.getByRole("button", { name: "Undo" }).click();
  await expect(task).toBeVisible();
  // The × on hover deletes it too.
  await task.hover();
  await workspace
    .locator(".workspace-history-row", { hasText: "Summarise the journey" })
    .getByRole("button", { name: "Delete task" })
    .click();
  await expect(task).toHaveCount(0);
});
