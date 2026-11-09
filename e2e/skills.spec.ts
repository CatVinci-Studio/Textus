import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  emit,
  invokeCalls,
  mockInvoke,
  openApp,
  PHONE,
  settled,
} from "./helpers";

// The composer's `/` and `@` pickers and Settings' skills, against the dev
// shim's 9 built-ins and one user skill in Write.

const AI_NAME = "Textus AI";

/** Opens the app with the AI panel open, in `language` and `mode`. */
async function openWithPanel(
  page: Page,
  language: string,
  mode: "write" | "review" = "review",
) {
  await openApp(page, {
    settings: { language, agentDefaultMode: mode },
    storage: { "textus-agent-panel-open": "1" },
  });
  const input = page.locator(".ai-island .inline-chat-input");
  await expect(input).toBeVisible();
  return input;
}

async function openSettings(page: Page) {
  await emit(page, "menu-open-settings");
  const panel = page.locator(".settings-panel");
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("the / picker", () => {});

test.describe("the @ picker", () => {
  test("a picked file stays in the text as a chip, goes with the message, and Backspace takes it whole", async ({
    page,
  }) => {
    const input = await openWithPanel(page, "en", "write");
    await mockInvoke(page, {
      list_project_files: ["notes/plan.md", "a.md"],
      read_project_file: "The plan.",
      ai_agent_message: [{ kind: "Assistant", text: "Done." }],
    });
    const chips = page.locator(".ai-island .inline-chat-mention");
    const above = page.locator(".ai-island .inline-chat-attachment");
    await input.fill("Compare @pl");
    await expect(page.locator(".composer-picker")).toContainText("plan.md");
    await input.press("Enter");
    await expect(input).toHaveValue("Compare @plan.md ");
    await expect(chips).toHaveText(["@plan.md"]);
    await expect(above).toHaveCount(0);
    // Backspace after it takes the chip, and its file.
    await input.press("Backspace");
    await expect(input).toHaveValue("Compare ");
    await expect(chips).toHaveCount(0);
    // Picked again, it goes with the message.
    await input.pressSequentially("@pl");
    await input.press("Enter");
    await expect(chips).toHaveText(["@plan.md"]);
    await input.pressSequentially("with the draft");
    await input.press("Enter");
    await expect(page.locator(".agent-panel-view")).toContainText("Done.");
    const [call] = await invokeCalls(page, "ai_agent_message");
    expect(call.message).toContain("Compare @plan.md with the draft");
    expect(call.message).toContain('<attached-file name="notes/plan.md">');
  });
});

/** Settings › Extensions › Skills, where the user's own skills are. */
async function openSkillsTab(panel: Locator) {
  await panel.locator(".settings-nav-item", { hasText: "Extensions" }).click();
  await panel.getByRole("tab", { name: "Skills" }).click();
}

/** Settings › Textus AI › Built-in skills, unfolded. */
async function openBuiltins(panel: Locator) {
  await panel.locator(".settings-nav-item", { hasText: AI_NAME }).click();
  const builtins = panel.locator(".settings-builtin-skills");
  await builtins.locator("summary").click();
  return builtins;
}

test.describe("Settings › Extensions › Skills", () => {
  test("built-ins are always on, by mode; the user's own skill picks its modes", async ({
    page,
  }) => {
    const input = await openWithPanel(page, "en");
    // Review: the user's skill, in Write, isn't offered.
    await input.fill("/house");
    await expect(page.locator(".composer-picker [role=status]")).toContainText(
      "No skill matches",
    );
    await input.fill("");
    const panel = await openSettings(page);
    // No switch on a built-in: it says it is built in, under its mode, with
    // Textus AI's settings rather than among the skills added.
    const builtins = await openBuiltins(panel);
    const proofread = builtins.locator('[data-skill="proofread"]');
    await expect(proofread).toContainText("Built-in");
    await expect(proofread.getByRole("checkbox")).toHaveCount(0);
    await expect(
      builtins.getByRole("group", { name: "Review" }).locator("[data-skill]"),
    ).toHaveCount(1);
    await openSkillsTab(panel);
    const tab = panel.getByRole("tabpanel");
    await expect(tab.locator('[data-skill="proofread"]')).toHaveCount(0);
    // The user's skill: in Write; its modes are ticked in a menu, several at
    // once, and the last can't be unticked.
    const own = tab.locator('.settings-skill-item[data-skill="house-style"]');
    const modes = own.getByRole("button", { name: /Modes it works in/ });
    await expect(modes).toHaveText("General");
    await modes.click();
    const menu = own.getByRole("menu");
    await expect(
      menu.getByRole("menuitemcheckbox", { name: "General" }),
    ).toBeDisabled();
    await menu.getByRole("menuitemcheckbox", { name: "Review" }).click();
    await expect(modes).toHaveText("General · Review");
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __devSkills: { ownModes: string[] } })
            .__devSkills.ownModes,
      ),
    ).toEqual(["write", "review"]);
    await page.getByRole("button", { name: "Close" }).first().click();
    await input.fill("/house");
    await expect(page.locator(".composer-picker")).toContainText(
      "/house-style",
    );
  });

  test("Customize… opens the copy in a tab, and Reset deletes it", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    let panel = await openSettings(page);
    await openBuiltins(panel);
    await panel.getByRole("button", { name: "Customize…: Proofread" }).click();
    // Settings gives way to the copy, opened as a document.
    await expect(page.locator(".settings-panel")).toHaveCount(0);
    await expect(
      page.locator('[data-active-tab="true"] .ProseMirror'),
    ).toContainText("proofread");

    panel = await openSettings(page);
    const builtins = await openBuiltins(panel);
    const row = builtins.locator('[data-skill="proofread"]');
    await expect(row).toContainText("Customized");
    await row.getByRole("button", { name: "Reset: Proofread" }).click();
    const confirm = page.getByRole("dialog", { name: /Delete your copy/ });
    await expect(confirm).toContainText("“Proofread”");
    await confirm.getByRole("button", { name: "Reset" }).click();
    await expect(row).not.toContainText("Customized");
    await expect(
      row.getByRole("button", { name: "Customize…: Proofread" }),
    ).toBeVisible();
    // The tab that showed the deleted copy is gone with it: saving it
    // would have written the copy back.
    await page.keyboard.press("Escape");
    await expect(page.locator(".settings-panel")).toHaveCount(0);
    await expect(
      page.locator('[data-active-tab="true"] .ProseMirror'),
    ).not.toContainText("proofread");
  });

  test("a copy older than its built-in says so", async ({ page }) => {
    await openApp(page, { settings: { language: "en" } });
    await page.evaluate(() => {
      const skills = (
        window as unknown as {
          __devSkills: { customized: Set<string>; outdated: Set<string> };
        }
      ).__devSkills;
      skills.customized.add("theme");
      skills.outdated.add("theme");
    });
    const panel = await openSettings(page);
    const row = (await openBuiltins(panel)).locator('[data-skill="theme"]');
    await expect(row.locator(".settings-skill-tag-notice")).toHaveText(
      "Built-in updated",
    );
    await expect(row).toContainText("Reset to use the new version");
  });

  test("Writing conventions picks a profile by its localized name", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "zh" } });
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: AI_NAME, exact: true }).click();
    // Under Advanced, folded until opened.
    const advanced = panel.locator(".settings-advanced > summary").last();
    await advanced.scrollIntoViewIfNeeded();
    await advanced.click();
    const select = panel.getByRole("combobox", { name: "写作规范" });
    await expect(select).toHaveText("自动");
    // Scrolled to first: the list closes when the page scrolls under it.
    await select.scrollIntoViewIfNeeded();
    await settled(page);
    await select.click();
    const list = page.getByRole("listbox", { name: "写作规范" });
    await expect(list).toContainText("简体中文");
    // The first 小说 is Simplified Chinese's (Japanese has one too).
    await list
      .getByRole("option", { name: "小说", exact: true })
      .first()
      .click();
    await expect(select).toHaveText("简体中文 · 小说");
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("catvinci-settings")!)
            .writingConventions,
      ),
    ).toBe("zh-Hans-CN/fiction");
  });
});

test.describe("on a phone", () => {
  test.use(PHONE);

  async function openPhoneIn(page: Page, language: string) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "iPhone" });
    });
    await openApp(page, { settings: { language } });
    await expect(page.locator("html")).toHaveAttribute(
      "data-window-chrome",
      "mobile",
    );
    await page.locator(".page-switch button").nth(1).tap();
    const input = page.locator(".agent-panel .inline-chat-input");
    await expect(input).toBeVisible();
    return input;
  }

  test("the / menu has finger-sized rows and no keyboard hint", async ({
    page,
  }) => {
    const input = await openPhoneIn(page, "zh");
    await input.tap();
    await input.fill("、");
    const menu = page.locator(".composer-picker");
    await expect(menu).toBeVisible();
    const row = menu.getByRole("option").first();
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(menu.locator(".composer-picker-keys")).toHaveCount(0);
    // Inside the screen, never wider than it.
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(430);
    await row.tap();
    await expect(input).toHaveValue(/^\/\S+ $/);
  });

  test("Settings lists the built-ins by mode", async ({ page }) => {
    await openPhoneIn(page, "en");
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: AI_NAME, exact: true }).tap();
    const builtins = panel.locator(".settings-builtin-skills");
    await builtins.locator("summary").tap();
    for (const mode of ["Review", "Create"])
      await expect(builtins.getByRole("group", { name: mode })).toBeVisible();
    await expect(builtins.locator('[data-skill="proofread"]')).toContainText(
      "Built-in",
    );
    // Nothing spills past the screen's edge.
    const overflow = await panel.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test("a skill of the user's turns off for now and back on, its modes kept", async ({
  page,
}) => {
  const input = await openWithPanel(page, "en", "write");
  const panel = await openSettings(page);
  await openSkillsTab(panel);
  const own = panel.locator('.settings-skill-item[data-skill="house-style"]');
  const on = own.getByRole("checkbox");
  await expect(on).toBeChecked();
  await on.click({ force: true });
  await expect(on).not.toBeChecked();
  await expect(own).toHaveAttribute("data-off", "");
  // Its modes stay as they were, but can't be changed while it is off.
  const modes = own.getByRole("button", { name: /Modes it works in/ });
  await expect(modes).toHaveText("General");
  await expect(modes).toBeDisabled();
  await page.getByRole("button", { name: "Close" }).first().click();
  // Off: the / menu doesn't offer it.
  await input.fill("/house");
  await expect(page.locator(".composer-picker")).toBeVisible();
  await expect(page.locator(".composer-picker")).not.toContainText(
    "/house-style",
  );
  await input.fill("");
  const again = await openSettings(page);
  await openSkillsTab(again);
  await again
    .locator('.settings-skill-item[data-skill="house-style"]')
    .getByRole("checkbox")
    .click({ force: true });
  await again.getByRole("button", { name: "Close" }).first().click();
  await input.fill("/house");
  await expect(page.locator(".composer-picker")).toContainText("/house-style");
});
