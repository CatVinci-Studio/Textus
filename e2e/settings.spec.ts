import { expect, test, type Page } from "@playwright/test";
import { openApp, PHONE, openPhone } from "./helpers";

// The Settings panel: the AI page's layout and the focus/state bugs fixed
// with it.

// The English labels these tests look for, as in src/i18n/locales/en.ts
// (the e2e project can't import it). AI_NAME is src/i18n/names.ts's.
const AI_NAME = "Textus AI";
const t = {
  settingsTitle: "Settings",
  settingsDone: "Done",
  windowClose: "Close",
  navGeneral: "General",
  navEditor: "Editor & Appearance",
  navAi: AI_NAME,
  navShortcuts: "Shortcuts",
  navPrivacy: "Privacy",
  // SettingsPanel's own label, not a locale key.
  mediaProvidersLabel: "Media providers",
  aiAccountLabel: "Connection",
  writingFeaturesLabel: "Writing Assistance",
  writingModelLabel: "Assist Model",
  aiAskLabel: `${AI_NAME} Chat`,
  aiAskToggleLabel: `Enable ${AI_NAME} chat`,
  agentModelLabel: "Chat Model",
  webSearchHint: "Needs support from the current provider",
  aiSuggestionsLabel: "AI suggestions on the Agent home",
  autoTitleHint:
    "Gives an untitled document a title from its first accepted Agent draft, so saving is one step",
  agentPersonalizationGroupLabel: "Writing Instructions & Skills",
  agentAdvancedGroupLabel: "Advanced",
  menuViewSource: "Source Mode",
  customCssLabel: "Custom CSS",
  privacyClearButton: "Clear",
  privacyClearClipboard: "Clear Clipboard History",
};

async function openSettings(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  return page.getByRole("dialog", { name: t.settingsTitle });
}

test.describe("desktop", () => {
  test("the AI page connects first, then lists each feature with its model", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    // Five categories: AI service and Agent are one page now.
    await expect(panel.locator(".settings-nav-item")).toHaveText([
      t.navGeneral,
      t.navEditor,
      t.navAi,
      t.navShortcuts,
      t.navPrivacy,
    ]);
    await panel.getByRole("button", { name: t.navAi, exact: true }).click();

    // Media providers (dictation, reading aloud, illustrations) lead the page.
    await expect(panel.locator(".settings-group-title")).toHaveText([
      t.mediaProvidersLabel,
      t.aiAccountLabel,
      t.writingFeaturesLabel,
      t.aiAskLabel,
      t.agentPersonalizationGroupLabel,
    ]);
    await expect(
      panel.locator(
        ".settings-advanced:not(.settings-builtin-skills) > summary",
      ),
    ).toHaveText(t.agentAdvancedGroupLabel);

    // Each model sits in the group of the feature it drives.
    const group = (title: string) =>
      panel.locator(".settings-group", {
        has: page.locator(".settings-group-title", { hasText: title }),
      });
    await expect(
      group(t.writingFeaturesLabel).getByText(t.writingModelLabel),
    ).toBeVisible();
    // The assist model comes first in its group, with no hint under it.
    await expect(
      group(t.writingFeaturesLabel).locator(".settings-row").first(),
    ).toContainText(t.writingModelLabel);
    await expect(
      group(t.aiAskLabel).getByText(t.agentModelLabel),
    ).toBeVisible();
    await expect(group(t.aiAskLabel).getByText(t.webSearchHint)).toBeVisible();
    // "Agent" names only the Agent workspace (its home and its drafts);
    // the chat and its settings never say it.
    const text = (await panel.innerText())
      .replace(t.aiSuggestionsLabel, "")
      .replace(t.autoTitleHint, "");
    expect(text).not.toMatch(/\bAgent\b/);
  });

  test("turning the chat off hides the two groups below it", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.navAi, exact: true }).click();
    const chat = panel.getByRole("checkbox", { name: t.aiAskToggleLabel });
    await expect(chat).toBeChecked();
    await chat.click();

    await expect(chat).not.toBeChecked();
    await expect(panel.locator(".settings-group-title")).toHaveText([
      t.mediaProvidersLabel,
      t.aiAccountLabel,
      t.writingFeaturesLabel,
      t.aiAskLabel,
    ]);
    await expect(panel.locator(".settings-advanced")).toHaveCount(0);
    // The chat's own rows go with it; writing assistance stays.
    await expect(panel.getByText(t.agentModelLabel)).toHaveCount(0);
    await expect(panel.getByText(t.writingModelLabel)).toBeVisible();

    await chat.click();
    await expect(panel.locator(".settings-group-title")).toHaveCount(5);
  });

  test("Tab reaches the folded Advanced group before wrapping", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.navAi, exact: true }).click();
    const summary = panel.locator(
      ".settings-advanced:not(.settings-builtin-skills) > summary",
    );
    // From the control just before it, Tab lands on the summary - not back
    // on the close button.
    await panel.getByRole("checkbox", { name: t.aiAskToggleLabel }).focus();
    for (let i = 0; i < 20; i++) {
      if (await summary.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(summary).toBeFocused();
    // Folded, it is the last stop: one more Tab wraps to the top.
    await page.keyboard.press("Tab");
    await expect(
      panel.getByRole("button", { name: t.windowClose }),
    ).toBeFocused();
  });

  test("the Source switch, from split view, ends in plain source mode", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    await page.evaluate(() =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent("menu-toggle-split-view"),
    );
    await expect(page.locator(".split-view")).toBeVisible();
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.navEditor }).click();
    const source = panel.getByRole("checkbox", { name: t.menuViewSource });
    await expect(source).not.toBeChecked();
    await source.click();

    await expect(source).toBeChecked();
    await expect(page.locator(".split-view")).toHaveCount(0);
    await expect(
      page.locator('[data-active-tab="true"] textarea.source-view'),
    ).toBeAttached();
  });

  test("Custom CSS stays open while it is emptied", async ({ page }) => {
    await openApp(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.navEditor }).click();
    await panel.getByText(t.customCssLabel, { exact: true }).click();
    const css = panel.getByRole("textbox", { name: t.customCssLabel });
    await css.fill("p { color: red; }");
    await css.press("ControlOrMeta+a");
    await css.press("Backspace");
    await expect(css).toBeVisible();
    await expect(css).toBeFocused();
  });

  test("a custom endpoint's model names can be typed in full", async ({
    page,
  }) => {
    await openApp(page, {
      settings: { language: "en", aiProvider: "custom" },
    });
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.navAi, exact: true }).click();
    // Nothing to list for a custom endpoint: a field to type the name in,
    // which used to become a one-option select after the first character.
    for (const label of [t.writingModelLabel, t.agentModelLabel]) {
      const field = panel.getByRole("textbox", { name: label });
      await field.pressSequentially("mock-model-1");
      await expect(field).toHaveValue("mock-model-1");
      await expect(field).toBeFocused();
      // Machine-read text: iOS must not capitalise or autocorrect it.
      await expect(field).toHaveAttribute("autocapitalize", "off");
      await expect(field).toHaveAttribute("autocorrect", "off");
    }
  });

  test("after a clear the focus stays in Settings and Escape closes it", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.navPrivacy }).click();
    const clear = panel.getByRole("button", {
      name: `${t.privacyClearButton}: ${t.privacyClearClipboard}`,
    });
    await clear.click();
    // The confirm dialog's own Clear, over Settings.
    await page.locator(".close-prompt-primary").click();
    await expect(clear).toBeEnabled();
    await expect(clear).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });
});

test.describe("iPad", () => {
  test.use({ viewport: { width: 1032, height: 1376 }, hasTouch: true });

  test("Done is a word at the right of the title, not a bar across it", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "iPad" });
    });
    await openApp(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    const done = panel.getByRole("button", { name: t.settingsDone });
    const header = await panel.locator(".settings-header").boundingBox();
    const box = await done.boundingBox();
    expect(box!.width).toBeLessThan(120);
    // Its right edge near the header's right edge.
    expect(header!.x + header!.width - (box!.x + box!.width)).toBeLessThan(40);
    await expect(done).toHaveCSS("border-top-style", "none");
  });
});

test.describe("phone", () => {
  test.use(PHONE);

  test("four categories fit across the screen", async ({ page }) => {
    // The narrowest current iPhone width, in English, the longest labels.
    await page.setViewportSize({ width: 375, height: 812 });
    await openPhone(page);
    const panel = await openSettings(page);
    const items = panel.locator(".settings-nav-item");
    await expect(items).toHaveText([
      t.navGeneral,
      t.navEditor,
      t.navAi,
      t.navPrivacy,
    ]);
    // Nothing to scroll sideways to.
    const nav = panel.locator(".settings-nav");
    const { scroll, client } = await nav.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
  });

  test("closing Settings doesn't put the keyboard back up", async ({
    page,
  }) => {
    await openPhone(page);
    await page.locator('[data-active-tab="true"] .ProseMirror').focus();
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.settingsDone }).tap();
    await expect(panel).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.isContentEditable,
      ),
    ).toBeFalsy();
  });

  test("other dialogs still hand the focus back to the editor", async ({
    page,
  }) => {
    // Inserting a table is a step in typing, not a detour like Settings:
    // the keyboard should be there for the table's first cell.
    await openPhone(page);
    const editor = page.locator('[data-active-tab="true"] .ProseMirror');
    await editor.focus();
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("textus:insert-block", { detail: "table" }),
      ),
    );
    const dialog = page.getByRole("dialog", { name: "Insert Table" });
    await dialog.getByRole("button", { name: "Insert", exact: true }).tap();
    await expect(dialog).toHaveCount(0);
    await expect(editor).toBeFocused();
  });
});
