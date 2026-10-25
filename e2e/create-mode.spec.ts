import { expect, test } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// Create mode: the panel's third mode, for making a theme, a plugin or a
// skill. A skill the reply writes is saved with Save this skill, in the
// modes ticked under it.

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

test("Create mode makes a skill, saved in the modes picked", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", agentDefaultMode: "create" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const panel = page.locator(".agent-panel");
  await expect(panel.locator(".agent-panel-empty")).toContainText(
    "Make a theme, plugin or skill",
  );
  // Its / menu holds Create's three.
  const input = panel.locator(".inline-chat-input");
  await input.fill("/");
  const menu = page.locator(".composer-picker");
  await expect(menu.getByRole("option")).toHaveCount(3);
  await input.fill("");

  const message = "a skill for my weekly report";
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: message },
      {
        kind: "Assistant",
        text: `A skill for the weekly report - call it with /weekly-report.\n\n\`\`\`markdown weekly-report.md\n${skill}\n\`\`\``,
      },
    ],
  });
  await input.fill(message);
  await input.press("Enter");

  const chip = panel.locator('.skill-offer-chip[data-skill="weekly-report"]');
  await expect(chip).toContainText("Weekly report");
  const modes = chip.getByRole("group", { name: "Modes it works in" });
  await expect(modes.getByRole("checkbox", { name: "Write" })).toBeChecked();
  await modes.getByRole("checkbox", { name: "Review" }).click();
  await chip.getByRole("button", { name: "Save this skill" }).click();
  await expect(chip).toContainText("Kept as /weekly-report");
  const log = await page.evaluate(
    () =>
      (window as unknown as { __devSkills: { log: string[] } }).__devSkills.log,
  );
  expect(log).toContain("save_written_skill:write,review");
});
