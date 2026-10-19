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
