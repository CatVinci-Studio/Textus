import { expect, test, type Page } from "@playwright/test";
import { emit, mockInvoke, openApp, openPhone, PHONE } from "./helpers";

// The Settings panel.

// Keep in step with the English locale; e2e can't import it.
const AI_NAME = "Textus AI";
const t = {
  navAbout: "About",
  imageGenerationGroupLabel: "Pictures",
  settingsTitle: "Settings",
  windowClose: "Close",
  navGeneral: "General",
  navEditor: "Editor & Appearance",
  navAi: AI_NAME,
  navExtensions: "Extensions",
  navShortcuts: "Shortcuts",
  navPrivacy: "Privacy",
  generalBasicsLabel: "Basics",
  settingsFilesGroup: "Files",
  settingsFileLabel: "Settings file",
  generalSystemLabel: "Application",
  settingsHelpGroup: "Help",
  autosaveLabel: "Save automatically",
  autoSuggestFilenameLabel: "Suggest a filename when saving a new file",
  navTheme: "Theme",
  frostedTitleBarLabel: "Frosted title bar",
  settingsViewGroup: "View",
  navMarkdown: "Markdown",
  imageStorageGroupLabel: "Images",
  menuExport: "Export",
  contentWidthLabel: "Text width",
  shortcutEditorGroupLabel: "Editor & Navigation",
  shortcutAiGroupLabel: "AI & Writing",
  shortcutHeadingsGroupLabel: "Headings",
  shortcutFixedGroupLabel: "Fixed Shortcuts",
  menuTextusAi: AI_NAME,
  textusAiToggleLabel: `Enable ${AI_NAME}`,
  textusAiOffHint: "Off: nothing is sent to any AI service.",
  aiAccountLabel: "Connection",
  writingFeaturesLabel: "Writing Assistance",
  writingModelLabel: "Assist model",
  aiAskLabel: `${AI_NAME} Chat`,
  aiAskToggleLabel: `Enable ${AI_NAME} chat`,
  agentModelLabel: "Chat model",
  webSearchLabel: "Web search",
  diagramEngineLabel: "Diagram engine",
  diagramEngineHint:
    "Pele is faster, but lays diagrams out differently from GitHub and Mermaid and skips a few features, such as HTML in labels; Mermaid draws whatever Pele can't.",
  infoTipLabel: "More about {label}",
  agentPersonalizationGroupLabel: "Writing Instructions & Skills",
  agentAdvancedGroupLabel: "Advanced",
  menuViewSource: "Source Mode",
  customCssLabel: "Custom CSS",
  themeGetMore: "Get more themes",
  privacyClearButton: "Clear",
  privacyClearDrafts: "Delete Recovery Drafts",
  pdfPageNumbersLabel: "Show page numbers in exports",
  aboutTextus: "About Textus",
  aboutMadeBy: "Made by CatVinci Studio",
  updateCheckButton: "Check for Updates",
  updateLatest: "You're on the latest version.",
  updateChannel: "Update channel",
  updateChannelStable: "Stable",
  updateChannelBeta: "Beta",
  defaultEditorLabel: "Default Markdown editor",
  defaultEditorIsDefault: "Textus is the default",
  defaultEditorNotDefault: "Textus is not the default",
  defaultEditorButton: "Set as Default",
  defaultEditorChooseHint: "In Default apps, choose Textus for .md files.",
  defaultEditorUnsupported:
    "Only an installed package (.deb, .rpm or AUR) can be the default, not the AppImage.",
};

/** A row's "?" button, by the row it explains. */
const more = (label: string) => t.infoTipLabel.replace("{label}", label);

/** What default_editor_status reports: macOS and Linux set the default
 *  themselves, Windows has the user choose it, an AppImage can't. */
const defaultEditorStatus = {
  mac: { supported: true, isDefault: false, chooseInSettings: false },
  windows: { supported: true, isDefault: false, chooseInSettings: true },
  appImage: { supported: false, isDefault: false, chooseInSettings: false },
};

async function openSettings(page: Page) {
  await emit(page, "menu-open-settings");
  return page.getByRole("dialog", { name: t.settingsTitle });
}

test.describe("desktop", () => {
  test("the AI page connects first, then lists each feature with its model; the chat off hides the two groups below it", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    // Six categories, plugins among them.
    await expect(panel.locator(".settings-nav-item")).toHaveText([
      t.navGeneral,
      t.navEditor,
      t.navAi,
      t.navExtensions,
      t.navShortcuts,
      t.navPrivacy,
    ]);
    await panel.getByRole("button", { name: t.navAi, exact: true }).click();

    await expect(panel.locator(".settings-group-title")).toHaveText([
      t.menuTextusAi,
      t.aiAccountLabel,
      t.writingFeaturesLabel,
      t.aiAskLabel,
      t.imageGenerationGroupLabel,
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
    // Web search's label says enough: no "?" beside it.
    await expect(
      group(t.aiAskLabel).getByRole("button", { name: more(t.webSearchLabel) }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("checkbox", { name: t.webSearchLabel, exact: true }),
    ).not.toBeChecked();
    // The UI never says "Agent".
    await expect(panel).not.toContainText(/\bAgent\b/);

    // Turning the chat off hides the groups below it.
    const chat = panel.getByRole("checkbox", { name: t.aiAskToggleLabel });
    await expect(chat).toBeChecked();
    await chat.click();

    await expect(chat).not.toBeChecked();
    await expect(panel.locator(".settings-group-title")).toHaveText([
      t.menuTextusAi,
      t.aiAccountLabel,
      t.writingFeaturesLabel,
      t.aiAskLabel,
    ]);
    // What isn't the chat's stays under Advanced: the proxy, the model list.
    await expect(panel.locator(".settings-advanced")).toHaveCount(1);
    // The chat's own rows go with it; writing assistance stays.
    await expect(panel.getByText(t.agentModelLabel)).toHaveCount(0);
    await expect(panel.getByText(t.writingModelLabel)).toBeVisible();

    await chat.click();
    await expect(panel.locator(".settings-group-title")).toHaveCount(6);

    // Textus AI itself off: only its own switch is left.
    const textusAi = panel.getByRole("checkbox", {
      name: t.textusAiToggleLabel,
      exact: true,
    });
    await textusAi.click();
    await expect(panel.locator(".settings-group-title")).toHaveText([
      t.menuTextusAi,
    ]);
    await expect(panel.getByText(t.textusAiOffHint)).toBeVisible();
    await textusAi.click();
    await expect(panel.locator(".settings-group-title")).toHaveCount(6);
    await expect(chat).toBeChecked();
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

  test("Source Mode, picked from split view, ends in plain source mode", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    await emit(page, "menu-toggle-split-view");
    await expect(page.locator(".split-view")).toBeVisible();
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.navEditor }).click();
    const view = panel.getByRole("combobox", { name: "Editing view" });
    await expect(view).toHaveText("Source and Preview");
    await view.click();
    await page.getByRole("option", { name: t.menuViewSource }).click();

    await expect(view).toHaveText(t.menuViewSource);
    await expect(page.locator(".split-view")).toHaveCount(0);
    await expect(
      page.locator('[data-active-tab="true"] .source-view .cm-content'),
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

  test("the title bar can frost what scrolls under it, and turn opaque again", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.navEditor }).click();
    const toggle = panel.getByRole("checkbox", {
      name: t.frostedTitleBarLabel,
    });
    const bar = page.locator(".window-bar");
    await expect(toggle).not.toBeChecked();
    await expect(bar).toHaveCSS("backdrop-filter", "none");

    await toggle.click();
    await expect(toggle).toBeChecked();
    // Glass in three layers behind the bar, blurring more toward the top;
    // the bar itself only tints, so they see the page.
    await expect(bar).toHaveCSS("backdrop-filter", "none");
    const layers = page.locator(".window-bar-glass > i");
    await expect(layers).toHaveCount(3);
    expect(
      await layers.evaluateAll((all) =>
        all.map((el) => getComputedStyle(el).backdropFilter),
      ),
    ).toEqual(["blur(4px)", "blur(10px)", "saturate(1.8) blur(20px)"]);
    await expect(page.locator(".window-bar-glass")).toHaveCSS(
      "pointer-events",
      "none",
    );

    await toggle.click();
    await expect(page.locator(".window-bar-glass")).toBeHidden();
  });

  test("Custom CSS keeps the focus while it is emptied", async ({ page }) => {
    await openApp(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.navEditor }).click();
    await panel.getByRole("button", { name: t.themeGetMore }).click();
    await panel.locator(".extensions-advanced summary").click();
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
    // which stays a field after the first character.
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
      name: `${t.privacyClearButton}: ${t.privacyClearDrafts}`,
    });
    await clear.click();
    // The confirm dialog's own Clear, over Settings.
    await page.locator(".close-prompt-primary").click();
    await expect(clear).toBeEnabled();
    await expect(clear).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });
  test("Check for Updates… opens About and checks at once", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    await emit(page, "menu-check-updates");
    const panel = page.getByRole("dialog", { name: "Settings" });
    // The check ran without a click: its answer is there.
    await expect(panel.getByRole("status")).toHaveText(t.updateLatest);
    await expect(panel.locator(".settings-about")).toBeVisible();
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
    // Stable and Beta say what they are: no "?".
    await expect(
      panel.getByRole("button", { name: more(t.updateChannel) }),
    ).toHaveCount(0);

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

  test("every page is as wide as the others, whichever category is chosen", async ({
    page,
  }) => {
    // Russian: its longest name sets the nav's width, and turning bold
    // must not narrow the page beside it.
    await openApp(page, { settings: { language: "ru" } });
    await openSettings(page);
    const panel = page.locator(".settings-panel");
    const items = panel.locator(".settings-nav-item");
    await expect(items).toHaveCount(6);
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

  test("an explanation is behind a ? that hover, Tab and Escape drive, and Escape closes it before Settings", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.navEditor }).click();
    // The diagram engine is among the rarely changed, under Advanced.
    await panel.locator(".settings-advanced > summary").click();
    // Not on the page as grey text under the row.
    await expect(panel.getByText(t.diagramEngineHint)).toBeHidden();
    const help = panel.getByRole("button", {
      name: more(t.diagramEngineLabel),
    });
    await expect(help).toHaveAccessibleDescription(t.diagramEngineHint);

    // A resting mouse opens it; moving away closes it.
    await help.hover();
    const tip = page.getByRole("tooltip");
    await expect(tip).toHaveText(t.diagramEngineHint);
    await page.mouse.move(5, 5);
    await expect(tip).toHaveCount(0);

    // Tab to it: the card shows, Escape closes it, a second closes Settings.
    await help.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(help).toBeFocused();
    await expect(tip).toHaveText(t.diagramEngineHint);
    await page.keyboard.press("Escape");
    await expect(tip).toHaveCount(0);
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("each page's groups go from the most used to the links out", async ({
    page,
  }) => {
    await openApp(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    const titles = panel.locator(".settings-group-title");
    const open = (name: string) =>
      panel.getByRole("button", { name, exact: true }).click();

    // Help is links out, not settings: last.
    await expect(titles).toHaveText([
      t.generalBasicsLabel,
      t.settingsFilesGroup,
      t.generalSystemLabel,
      t.settingsHelpGroup,
    ]);
    // Saving, used daily, is a group of its own under the basics.
    const files = panel.locator(".settings-group", {
      has: page.locator(".settings-group-title", {
        hasText: t.settingsFilesGroup,
      }),
    });
    await expect(files.locator(".settings-row-label")).toHaveText([
      t.autosaveLabel,
      t.autoSuggestFilenameLabel,
    ]);
    // The settings file can carry the AI history away: it sits with privacy.
    await open(t.navPrivacy);
    await expect(titles.last()).toHaveText(t.settingsFileLabel);

    await open(t.navEditor);
    await expect(titles).toHaveText([
      t.navTheme,
      "Text & Layout",
      t.settingsViewGroup,
      "This Document",
      t.navMarkdown,
      t.imageStorageGroupLabel,
      t.menuExport,
    ]);
    // The text's width and the interface's size are layout, not theme.
    const view = panel.locator(".settings-group", {
      has: page.locator(".settings-group-title", {
        hasText: "Text & Layout",
      }),
    });
    await expect(view.locator(".settings-row-label").first()).toHaveText(
      t.contentWidthLabel,
    );

    await open(t.navShortcuts);
    await expect(titles).toHaveText([
      t.shortcutEditorGroupLabel,
      t.settingsViewGroup,
      t.shortcutAiGroupLabel,
      t.shortcutHeadingsGroupLabel,
      t.shortcutFixedGroupLabel,
    ]);
    // Finding - commands, in the document, among the folder's files - first.
    await expect(
      panel.locator(".settings-group").first().locator(".settings-row-label"),
    ).toHaveText([
      "Command Palette",
      "Find & Replace",
      "Search file names",
      "Next tab",
      "Previous tab",
    ]);
  });

  test("in a short window Settings fits under the window bar and its page scrolls to the last setting (#260)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 460 });
    await openApp(page, { settings: { language: "en", uiTextScale: 1.25 } });
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.navEditor }).click();

    // The whole card is on screen, below the 28px window bar: its title
    // and Close at the top, the categories beside the page.
    const box = (await panel.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(28);
    expect(box.y + box.height).toBeLessThanOrEqual(460);
    await expect(panel.locator(".settings-header")).toBeInViewport({
      ratio: 1,
    });
    await expect(
      panel.getByRole("button", { name: t.windowClose }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      panel.getByRole("button", { name: t.navGeneral }),
    ).toBeInViewport({ ratio: 1 });

    // The page is taller than the card and scrolls inside it.
    const content = panel.locator(".settings-content");
    // The page's foot: the Advanced fold, closed.
    const last = content.locator(".settings-advanced > summary").last();
    await expect(last).not.toBeInViewport();
    await content.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect(
      panel.getByRole("button", { name: t.windowClose }),
    ).toBeInViewport({ ratio: 1 });

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });
});

test.describe("phone", () => {
  test.use(PHONE);

  test("Settings opens on a list of its pages, each pushed in with a way back", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openPhone(page);
    const panel = await openSettings(page);
    const items = panel.locator(".settings-nav-item");
    await expect(items).toHaveText([
      t.navGeneral,
      t.navEditor,
      t.navAi,
      t.navExtensions,
      t.navPrivacy,
    ]);
    // A list, not a page: none is current, and no page shows beside it.
    await expect(panel.locator("[aria-current]")).toHaveCount(0);
    await expect(panel.locator(".settings-content")).toHaveCount(0);
    // Rows the width of the card, one above the other.
    const boxes = await items.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()),
    );
    for (const [a, b] of boxes.slice(1).map((box, i) => [boxes[i], box]))
      expect(b.top).toBeGreaterThanOrEqual(a.bottom - 1);
    // The card inside the panel, itself inset from the screen.
    expect(boxes[0].width).toBeGreaterThan(375 - 60);

    // In: the bar names the page and offers the way back; the list is gone.
    await items.filter({ hasText: t.navEditor }).tap();
    const header = panel.locator(".settings-header");
    await expect(header).toContainText(t.navEditor);
    await expect(panel.locator(".settings-nav")).toHaveCount(0);
    await expect(panel.locator(".settings-search")).toHaveCount(0);
    await expect(
      panel.getByRole("combobox", { name: "Editing view" }),
    ).toBeVisible();

    // Back: the list again, under the search box.
    await header.getByRole("button", { name: t.settingsTitle }).tap();
    await expect(items).toHaveCount(5);
    await expect(panel.locator(".settings-search")).toBeVisible();

    // A page inside a page goes back to the one that held it.
    await items.filter({ hasText: t.navGeneral }).tap();
    await panel.getByRole("button", { name: t.aboutTextus }).tap();
    await expect(header).toContainText(t.navAbout);
    await header.getByRole("button", { name: t.navGeneral }).tap();
    await expect(header).toContainText(t.navGeneral);
    await expect(
      header.getByRole("button", { name: t.settingsTitle }),
    ).toBeVisible();
  });

  test("a search result on the phone opens its page, with the way back to the list", async ({
    page,
  }) => {
    await openPhone(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    // Found by the ? text of the row whose choice it is.
    await panel.locator(".settings-search input").fill("source mode");
    // The results stand in for the list.
    await expect(panel.locator(".settings-nav")).toHaveCount(0);
    // Right under the search box, not below half a screen of empty list.
    const group = panel.locator(".settings-group").first();
    await expect(group).toBeVisible();
    const box = await panel.locator(".settings-search").boundingBox();
    const first = await group.boundingBox();
    expect(first!.y - (box!.y + box!.height)).toBeLessThan(40);
    await panel.getByRole("option").first().tap();
    await expect(
      panel.getByRole("combobox", { name: "Editing view" }),
    ).toBeVisible();
    await panel
      .locator(".settings-header")
      .getByRole("button", { name: t.settingsTitle })
      .tap();
    await expect(panel.locator(".settings-nav-item")).toHaveCount(5);
  });

  test("a tap on a ? opens its explanation, a tap outside closes it", async ({
    page,
  }) => {
    await openPhone(page, { settings: { language: "en" } });
    const panel = await openSettings(page);
    await panel.getByRole("button", { name: t.navEditor, exact: true }).tap();
    const advanced = panel.locator(".settings-advanced > summary");
    await advanced.scrollIntoViewIfNeeded();
    await advanced.tap();
    const help = panel.getByRole("button", {
      name: more(t.diagramEngineLabel),
    });
    await help.scrollIntoViewIfNeeded();
    await help.tap();
    await expect(page.getByRole("tooltip")).toHaveText(t.diagramEngineHint);
    await panel.locator(".settings-group-title").first().tap();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });

  test("no PDF page numbers, default editor row or updates: iOS has none of them", async ({
    page,
  }) => {
    await openPhone(page);
    await mockInvoke(page, {
      default_editor_status: defaultEditorStatus.mac,
    });
    const panel = await openSettings(page);
    const back = panel
      .locator(".settings-header")
      .getByRole("button", { name: t.settingsTitle });
    // No default editor row: iOS has no default app to set.
    await panel.getByRole("button", { name: t.navGeneral }).tap();
    await expect(panel.getByText(t.aboutTextus)).toBeVisible();
    await expect(panel.getByText(t.defaultEditorLabel)).toHaveCount(0);

    // No PDF page number switch, with no PDF export.
    await back.tap();
    await panel.getByRole("button", { name: t.navEditor }).tap();
    await expect(panel.getByText(t.contentWidthLabel)).toBeVisible();
    await expect(panel.getByText(t.pdfPageNumbersLabel)).toHaveCount(0);

    // No update button or channel: the App Store updates the app.
    await back.tap();
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
    await panel.getByRole("button", { name: "Close" }).tap();
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

test("Settings' This Document switches match the View menu's: Track My Changes and Read Only", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  const panel = await openSettings(page);
  await panel.getByRole("button", { name: "Editor & Appearance" }).click();
  const readOnly = panel.getByRole("checkbox", { name: "Read Only" });
  const tracking = panel.getByRole("checkbox", { name: "Track My Changes" });
  await expect(readOnly).not.toBeChecked();
  await expect(tracking).not.toBeChecked();
  await readOnly.click({ force: true });
  await expect(readOnly).toBeChecked();
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toHaveAttribute("contenteditable", "false");
  await readOnly.click({ force: true });
  await tracking.click({ force: true });
  await expect(tracking).toBeChecked();
  await expect(readOnly).not.toBeChecked();
});
