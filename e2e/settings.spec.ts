import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, PHONE, openPhone } from "./helpers";

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
  aiAccountLabel: "Connection",
  writingFeaturesLabel: "Writing Assistance",
  writingModelLabel: "Assist Model",
  aiAskLabel: `${AI_NAME} Chat`,
  aiAskToggleLabel: `Enable ${AI_NAME} chat`,
  agentModelLabel: "Chat Model",
  webSearchHint: "Needs support from the current provider",
  agentPersonalizationGroupLabel: "Writing Instructions & Skills",
  agentAdvancedGroupLabel: "Advanced",
  menuViewSource: "Source Mode",
  customCssLabel: "Custom CSS",
  privacyClearButton: "Clear",
  privacyClearClipboard: "Clear Clipboard History",
  pdfPageNumbersLabel: "Page numbers in PDF",
  aboutTextus: "About Textus",
  aboutMadeBy: "Made by CatVinci Studio",
  updateCheckButton: "Check for Updates",
  updateChannel: "Update channel",
  updateChannelStable: "Stable",
  updateChannelBeta: "Beta",
  updateChannelHint: "Beta gets release candidates before everyone else.",
  defaultEditorLabel: "Default Markdown Editor",
  defaultEditorIsDefault: "Textus is the default",
  defaultEditorNotDefault: "Textus is not the default",
  defaultEditorButton: "Set as Default",
  defaultEditorChooseHint: "In Default apps, choose Textus for .md files.",
  defaultEditorUnsupported:
    "Only an installed package (.deb, .rpm or AUR) can be the default, not the AppImage.",
};

/** What default_editor_status reports: macOS and Linux set the default
 *  themselves, Windows has the user choose it, an AppImage can't. */
const defaultEditorStatus = {
  mac: { supported: true, isDefault: false, chooseInSettings: false },
  windows: { supported: true, isDefault: false, chooseInSettings: true },
  appImage: { supported: false, isDefault: false, chooseInSettings: false },
};

/** The canned commands Settings sent, in order (dev-tauri-shim). */
function invokeCalls(page: Page) {
  return page.evaluate(() =>
    (
      (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
        .__devInvokeCalls ?? []
    ).map((c) => c.cmd),
  );
}

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
  test("the AI page connects first, then lists each feature with its model; the chat off hides the two groups below it", async ({
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

    await expect(panel.locator(".settings-group-title")).toHaveText([
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
    // The UI never says "Agent" any more.
    await expect(panel).not.toContainText(/\bAgent\b/);

    // Turning the chat off hides the two groups below it.
    const chat = panel.getByRole("checkbox", { name: t.aiAskToggleLabel });
    await expect(chat).toBeChecked();
    await chat.click();

    await expect(chat).not.toBeChecked();
    await expect(panel.locator(".settings-group-title")).toHaveText([
      t.aiAccountLabel,
      t.writingFeaturesLabel,
      t.aiAskLabel,
    ]);
    await expect(panel.locator(".settings-advanced")).toHaveCount(0);
    // The chat's own rows go with it; writing assistance stays.
    await expect(panel.getByText(t.agentModelLabel)).toHaveCount(0);
    await expect(panel.getByText(t.writingModelLabel)).toBeVisible();

    await chat.click();
    await expect(panel.locator(".settings-group-title")).toHaveCount(4);
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

  test("PDF page numbers start off and the switch is remembered", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.navEditor }).click();
    const numbers = panel.getByRole("checkbox", {
      name: t.pdfPageNumbersLabel,
    });
    await expect(numbers).not.toBeChecked();
    await numbers.click();

    await expect(numbers).toBeChecked();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}")
              .pdfPageNumbers,
        ),
      )
      .toBe(true);
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
  test("the update channel sits under the update button and is remembered", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    let panel = await openSettings(page);
    await panel.getByRole("button", { name: t.aboutTextus }).click();
    await expect(
      panel.getByRole("button", { name: t.updateCheckButton }),
    ).toBeVisible();
    const channel = panel.getByRole("combobox", { name: t.updateChannel });
    await expect(channel).toHaveText(t.updateChannelStable);
    await expect(panel.getByText(t.updateChannelHint)).toBeVisible();

    await channel.click();
    await page.getByRole("option", { name: t.updateChannelBeta }).click();
    await expect(channel).toHaveText(t.updateChannelBeta);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}")
              .updateChannel,
        ),
      )
      .toBe("beta");

    // Still Beta after a restart. (openApp's init script would put the
    // settings back, so this reads what was stored.)
    await page.evaluate(() => {
      const stored = localStorage.getItem("catvinci-settings");
      sessionStorage.setItem("kept-settings", stored ?? "{}");
    });
    await page.addInitScript(() => {
      const kept = sessionStorage.getItem("kept-settings");
      if (kept && window.top === window)
        localStorage.setItem("catvinci-settings", kept);
    });
    await page.reload();
    await page.waitForSelector('[data-active-tab="true"] .ProseMirror');
    panel = await openSettings(page);
    await panel.getByRole("button", { name: t.aboutTextus }).click();
    await expect(
      panel.getByRole("combobox", { name: t.updateChannel }),
    ).toHaveText(t.updateChannelBeta);
  });

  test("no update channel in a package-manager build", async ({ page }) => {
    // The Arch package: it reports new versions but doesn't install them.
    await page.addInitScript(() => {
      (
        window as unknown as { __devInvokeResults: unknown }
      ).__devInvokeResults = { app_distribution: "aur" };
    });
    await openApp(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.aboutTextus }).click();
    await expect(
      panel.getByRole("button", { name: t.updateCheckButton }),
    ).toBeVisible();
    await expect(panel.getByText(t.updateChannel)).toHaveCount(0);
  });

  test("the default editor button makes Textus the default where the system allows it", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    await mockInvoke(page, {
      default_editor_status: defaultEditorStatus.mac,
      set_default_editor: null,
    });
    const panel = await openSettings(page);
    const row = panel
      .locator(".settings-row")
      .filter({ hasText: t.defaultEditorLabel });
    await expect(row).toContainText(t.defaultEditorNotDefault);
    // What the system reports once the command has run.
    await page.evaluate(() => {
      (
        window as unknown as { __devInvokeResults: Record<string, unknown> }
      ).__devInvokeResults.default_editor_status = {
        supported: true,
        isDefault: true,
        chooseInSettings: false,
      };
    });
    await row.getByRole("button", { name: t.defaultEditorButton }).click();
    await expect(row).toContainText(t.defaultEditorIsDefault);
    await expect(row.getByRole("button")).toHaveCount(0);
    expect(await invokeCalls(page)).toContain("set_default_editor");
  });

  test("on Windows the button opens Default apps and says what to choose", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    await mockInvoke(page, {
      default_editor_status: defaultEditorStatus.windows,
      set_default_editor: null,
    });
    const panel = await openSettings(page);
    const row = panel
      .locator(".settings-row")
      .filter({ hasText: t.defaultEditorLabel });
    await expect(row.getByText(t.defaultEditorChooseHint)).toHaveCount(0);
    await row.getByRole("button", { name: t.defaultEditorButton }).click();
    await expect(row.getByText(t.defaultEditorChooseHint)).toBeVisible();
    await expect(row).toContainText(t.defaultEditorNotDefault);
    expect(await invokeCalls(page)).toContain("set_default_editor");
  });

  test("an AppImage explains instead of offering the button", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    await mockInvoke(page, {
      default_editor_status: defaultEditorStatus.appImage,
    });
    const panel = await openSettings(page);
    const row = panel
      .locator(".settings-row")
      .filter({ hasText: t.defaultEditorLabel });
    await expect(row.getByText(t.defaultEditorUnsupported)).toBeVisible();
    await expect(row.getByRole("button")).toHaveCount(0);
  });

  test("every page is as wide as the others, whichever category is chosen", async ({
    page,
  }) => {
    // Russian: its longest name ("Editor & Appearance") sets the nav's
    // width, and that one turning bold once narrowed the page beside it.
    await openApp(page, { settings: { language: "ru" } });
    await openSettings(page);
    const panel = page.locator(".settings-panel");
    const items = panel.locator(".settings-nav-item");
    await expect(items).toHaveCount(5);
    const widths = new Set<number>();
    for (const item of await items.all()) {
      await item.click();
      widths.add(
        await panel
          .locator(".settings-content")
          .evaluate((el) => el.getBoundingClientRect().width),
      );
    }
    expect(widths.size).toBe(1);
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

  test("no PDF page numbers, default editor row or updates: iOS has none of them", async ({
    page,
  }) => {
    await openPhone(page);
    await mockInvoke(page, {
      default_editor_status: defaultEditorStatus.mac,
    });
    const panel = await openSettings(page);
    // No default editor row: iOS has no default app to set.
    await expect(panel.getByText(t.aboutTextus)).toBeVisible();
    await expect(panel.getByText(t.defaultEditorLabel)).toHaveCount(0);

    // No PDF page number switch, with no PDF export.
    await panel.getByRole("button", { name: t.navEditor }).tap();
    await expect(panel.getByText(t.menuViewSource)).toBeVisible();
    await expect(panel.getByText(t.pdfPageNumbersLabel)).toHaveCount(0);

    // No update button or channel: the App Store updates the app.
    await panel.getByRole("button", { name: t.navGeneral }).tap();
    await panel.getByRole("button", { name: t.aboutTextus }).tap();
    await expect(panel.getByText(t.aboutMadeBy)).toBeVisible();
    await expect(panel.getByText(t.updateCheckButton)).toHaveCount(0);
    await expect(panel.getByText(t.updateChannel)).toHaveCount(0);
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
