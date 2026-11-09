import { expect, test } from "@playwright/test";
import { emit, mockInvoke, openApp } from "./helpers";

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
  await emit(page, "menu-open-settings");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings
    .locator(".settings-nav-item", { hasText: "Extensions" })
    .click();
  await settings.getByRole("tab", { name: "Create" }).click();

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
  // Empty, its box is in the middle over the starting points, and the page
  // doesn't scroll; no mode to pick, no search or Deep to switch.
  const panel = settings.locator(".create-studio");
  const input = panel.locator(".inline-chat-input");
  await expect(panel).toHaveClass(/create-studio-empty/);
  await expect(settings.locator(".settings-content")).toHaveCSS(
    "overflow-y",
    "hidden",
  );
  await expect(panel.locator(".mode-picker-value")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Web search" })).toHaveCount(
    0,
  );
  // / picks what to make, shown until sent.
  await input.fill("/sk");
  await input.press("Enter");
  await expect(panel.locator(".inline-chat-selection-chip")).toHaveText(
    "Skills",
  );
  await input.fill(message);
  await input.press("Enter");
  await expect(panel).not.toHaveClass(/create-studio-empty/);
  await expect(panel.locator(".create-studio-examples")).toHaveCount(0);
  await expect(panel.locator(".inline-chat-selection-chip")).toHaveCount(0);

  // Its / menu holds Create's three.
  await input.fill("/");
  const menu = page.locator(".composer-picker");
  await expect(menu.getByRole("option")).toHaveCount(3);
  for (const name of ["/theme", "/plugin", "/skill"])
    await expect(menu).toContainText(name);
  await input.fill("");

  const chip = panel.locator('.skill-offer-chip[data-skill="weekly-report"]');
  await expect(chip).toContainText("Weekly report");
  const modes = chip.getByRole("button", { name: /Modes it works in/ });
  await expect(modes).toHaveText("General");
  // The chip's actions are links, not the browser's bare buttons.
  const save = chip.getByRole("button", { name: "Save this skill" });
  await expect(save).toHaveCSS("border-top-style", "none");
  await modes.click();
  // Its menu opens whole beside the button, each mode under its name alone.
  await expect(
    chip.getByRole("menuitemcheckbox", { name: "Review", exact: true }),
  ).toBeVisible();
  await chip.getByRole("menuitemcheckbox", { name: "Review" }).click();
  // Straight to Save, the menu still open: the press that closes it is
  // Save's.
  await save.click();
  await expect(chip).toContainText("Kept as /weekly-report");
  const log = await page.evaluate(
    () =>
      (window as unknown as { __devSkills: { log: string[] } }).__devSkills.log,
  );
  expect(log).toContain("save_written_skill:write,review");
});

test("a written skill that asks for Create starts without it, and saves there only on a second click", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-settings");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings
    .locator(".settings-nav-item", { hasText: "Extensions" })
    .click();
  await settings.getByRole("tab", { name: "Create" }).click();
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "a skill for my weekly report" },
      {
        kind: "Assistant",
        text: `Here it is.\n\n\`\`\`markdown weekly-report.md\n${skill.replace('"write"', '"write create"')}\n\`\`\``,
      },
    ],
  });
  const panel = settings.locator(".create-studio");
  const input = panel.locator(".inline-chat-input");
  await input.fill("a skill for my weekly report");
  await input.press("Enter");

  const chip = panel.locator('.skill-offer-chip[data-skill="weekly-report"]');
  const modes = chip.getByRole("button", { name: /Modes it works in/ });
  // What it asked for is said, and Create left unticked.
  await expect(modes).toHaveText("General");
  await expect(chip).toContainText("It asked for Create mode");
  await modes.click();
  await chip.getByRole("menuitemcheckbox", { name: "Create" }).click();
  await expect(chip).toContainText("In Create mode it could write");
  await chip.getByRole("button", { name: "Save this skill" }).click();
  // Not saved: the first click says why, the second saves.
  await chip.getByRole("button", { name: "Save anyway" }).click();
  await expect(chip).toContainText("Kept as /weekly-report");
  const log = await page.evaluate(
    () =>
      (window as unknown as { __devSkills: { log: string[] } }).__devSkills.log,
  );
  expect(log).toEqual(["save_written_skill:write,create"]);
});
