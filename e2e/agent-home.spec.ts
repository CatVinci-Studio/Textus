import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";
test("starts on Agent and keeps composer, editor and Undo across surface switches", async ({
  page,
}, testInfo) => {
  await openApp(page, { home: true, settings: { language: "en" } });
  const home = page.getByRole("region", { name: "Agent Workspace" });
  await expect(home).toBeVisible();
  await expect(
    home.getByRole("heading", { name: "Create with Textus" }),
  ).toBeVisible();
  const composer = home.locator(".inline-chat-input");
  await composer.fill("Keep this unsent idea");
  await home.getByLabel("Agent engine", { exact: true }).selectOption("codex");
  await expect(home.getByLabel("Engine model", { exact: true })).toBeVisible();
  await home
    .getByLabel("Agent engine", { exact: true })
    .selectOption("claude-code");
  await home
    .getByLabel("Agent engine", { exact: true })
    .selectOption("harness");
  await page.screenshot({ path: testInfo.outputPath("agent-home-light.png") });
  // Agent → Write at the Agent header's end; Write → Agent at the window
  // bar's start.
  const toWrite = page.getByRole("button", { name: /^Write ·/ });
  const toAgent = page.getByRole("button", { name: "Agent", exact: true });
  await toWrite.click();
  await pasteMarkdown(page, "# Persistent document\n\nKeep my Undo history.");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).toContainText("Persistent document");
  const identity = await editor.evaluate((el) => {
    el.setAttribute("data-continuity", "same-editor");
    return el.getAttribute("data-continuity");
  });
  await toAgent.click();
  await expect(composer).toHaveValue("Keep this unsent idea");
  await toWrite.click();
  await expect(editor).toHaveAttribute("data-continuity", identity!);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("Persistent document");
});
test("dark Agent home fits a narrow desktop viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 740, height: 700 });
  await openApp(page, {
    home: true,
    colorScheme: "dark",
    settings: { language: "zh", theme: "dark" },
  });
  await expect(page.locator(".agent-home-heading")).toBeVisible();
  const composerBox = await page
    .locator(".agent-home .inline-chat-field")
    .boundingBox();
  expect(composerBox?.width).toBeGreaterThan(480);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("agent-home-dark-narrow.png"),
  });
});
