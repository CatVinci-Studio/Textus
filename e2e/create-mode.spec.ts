import { expect, test } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// Create: Settings › Extensions' tab for making a theme, a plugin or a
// skill, in a conversation of its own. A skill the reply writes is saved
// with Save this skill, in the modes ticked under it.

const skill = [
  "---",
  "name: weekly-report",
  "description: >-",
  "  Turns the week's notes into the team's weekly report. Use when asked",
  "  for a weekly report.",
  "metadata:",
  '  textus-version: "1.0.0"',
  '  textus-modes: "write"',
  '  textus-label-en: "Weekly report"',
  "---",
  "",
  "Turn the notes into a report: done, next, blocked, one line each.",
].join("\n");

test("Create makes a skill, saved in the modes picked", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings
    .locator(".settings-nav-item", { hasText: "Extensions" })
    .click();
  await settings.getByRole("tab", { name: "Create" }).click();
  await settings.getByRole("radio", { name: "Skills" }).click();

  const message = "a skill for my weekly report";
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: `/skill ${message}` },
      {
        kind: "Assistant",
        text: `A skill for the weekly report - call it with /weekly-report.\n\n\`\`\`markdown weekly-report.md\n${skill}\n\`\`\``,
      },
    ],
  });
  await settings.locator(".create-studio-input").fill(message);
  await settings.getByRole("button", { name: "Start" }).click();
  const panel = settings.locator(".create-studio-chat");

  // Its / menu holds Create's three.
  const input = panel.locator(".inline-chat-input");
  await input.fill("/");
  const menu = page.locator(".composer-picker");
  await expect(menu.getByRole("option")).toHaveCount(3);
  for (const name of ["/theme", "/plugin", "/skill"])
    await expect(menu).toContainText(name);
  await input.fill("");

  const chip = panel.locator('.skill-offer-chip[data-skill="weekly-report"]');
  await expect(chip).toContainText("Weekly report");
  const modes = chip.getByRole("button", { name: /Modes it works in/ });
  await expect(modes).toHaveText("Write");
  await modes.click();
  await chip.getByRole("menuitemcheckbox", { name: "Review" }).click();
  await modes.click();
  await expect(chip.getByRole("menuitemcheckbox")).toHaveCount(0);
  await chip.getByRole("button", { name: "Save this skill" }).click();
  await expect(chip).toContainText("Kept as /weekly-report");
  const log = await page.evaluate(
    () =>
      (window as unknown as { __devSkills: { log: string[] } }).__devSkills.log,
  );
  expect(log).toContain("save_written_skill:write,review");
});
