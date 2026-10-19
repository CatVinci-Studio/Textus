import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// The margin views of a revision ("original in the text, changes in the
// margin" and its mirror) need room right of the text. Without it they
// can't be picked, and say why; a chosen one waits, untouched in Settings,
// and applies again once there is room.

// As in src/i18n/locales/en.ts (the e2e project can't import it).
const t = {
  inline: "All in the text",
  original: "Original in the text, changes in the margin",
  changed: "Changes in the text, original in the margin",
  noRoom: "Not enough room - close the sidebar or the AI panel",
  settingsTitle: "Settings",
  navAi: "Textus AI",
  revisionDisplayLabel: "Show revisions",
};

const DOC = `# Field notes

The study ran in three districts. We spent two whole months talking with residents one by one. We interviewed forty-six residents about many things.

The second paragraph stays as it is.
`;

async function proposeRevision(page: Page, doc = DOC) {
  await pasteMarkdown(page, doc);
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Tighten it" },
      {
        kind: "ToolCall",
        call_id: "e1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor:
            "The study ran in three districts. We spent two whole months talking with residents one by one. We interviewed forty-six residents about many things.",
          text: "The study covered three districts. We spent two whole months talking with residents one by one. We interviewed forty-six residents.",
        }),
      },
      { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Tighten it");
  await composer.press("Enter");
  await expect(page.locator(".review-bar")).toBeVisible();
}

async function storedDisplay(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}")
        .revisionDisplay,
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
  const panel = page.getByRole("dialog", { name: t.settingsTitle });
  await panel.getByRole("button", { name: t.navAi, exact: true }).click();
  return panel;
}

const open = {
  "levis-agent-panel-open": "1",
  "textus-sidebar-open": "1",
};

test("with no room for the margin, its views can't be picked and the chosen one waits; with room, every view can be picked", async ({
  page,
}) => {
  // A laptop window with the sidebar and the AI panel open.
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "original" },
    storage: open,
  });
  await proposeRevision(page);
  // Everything in the text, and the bar says so.
  await expect(page.locator(".revision-note")).toHaveCount(0);
  await expect(page.locator(".milkdown .pending-pick:visible")).toHaveCount(2);
  await expect(page.locator(".review-bar-view-name")).toHaveText(t.inline);

  await page.locator(".review-bar-view-button").click();
  const item = (name: string) =>
    page.getByRole("menuitemradio", { name, exact: true });
  await expect(item(t.original)).toBeDisabled();
  await expect(item(t.changed)).toBeDisabled();
  await expect(item(t.inline)).toHaveAttribute("aria-checked", "true");
  await expect(item(t.original)).toHaveClass(/review-bar-menu-waiting/);
  await expect(page.locator(".review-bar-menu-note")).toHaveText(t.noRoom);
  await page.locator(".review-bar-view-button").click();
  expect(await storedDisplay(page)).toBe("original");

  // Settings: the same two views unpickable, with the same reason.
  const settings = await openSettings(page);
  const row = settings.locator(".settings-row", {
    hasText: t.revisionDisplayLabel,
  });
  await expect(row.locator(".settings-row-hint")).toHaveText(t.noRoom);
  await row.getByRole("combobox").click();
  await expect(
    page.getByRole("option", { name: t.original, exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    page.getByRole("option", { name: t.inline, exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);

  // Closing the AI panel makes room: the chosen view comes back by itself.
  await page.keyboard.press("Control+Shift+L");
  await expect(page.locator(".revision-note")).toHaveCount(2);
  await expect(page.locator(".milkdown .pending-pick:visible")).toHaveCount(0);
  await expect(page.locator(".review-bar-view-name")).toHaveCount(0);
  await page.locator(".review-bar-view-button").click();
  // With room, every view can be picked, in the bar and in Settings.
  for (const name of [t.inline, t.original, t.changed])
    await expect(item(name)).toBeEnabled();
  await expect(item(t.original)).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".review-bar-menu-note")).toHaveCount(0);
  await page.locator(".review-bar-view-button").click();
  await openSettings(page);
  await expect(row.locator(".settings-row-hint")).toHaveCount(0);
  await row.getByRole("combobox").click();
  await expect(
    page.getByRole("option", { name: t.original, exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  expect(await storedDisplay(page)).toBe("original");
});

test("the adaptive column leaves room for the margin views beside the AI panel at 1341 and 1920px (#211)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1341, height: 800 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "original" },
    storage: { "levis-agent-panel-open": "1", "textus-sidebar-open": "0" },
  });
  await proposeRevision(page);
  await expect(page.locator(".revision-note")).toHaveCount(2);
  await page.setViewportSize({ width: 1920, height: 900 });
  await expect(page.locator(".revision-note")).toHaveCount(2);
  // The sidebar too, on a large screen.
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload?: unknown) => void;
      }
    ).__devEmitTauriEvent("menu-toggle-sidebar"),
  );
  await expect(page.locator(".sidebar:not(.sidebar-collapsed)")).toBeVisible();
  await expect(page.locator(".revision-note")).toHaveCount(2);
  await expect(page.locator(".milkdown .pending-pick:visible")).toHaveCount(0);
});

test("the line being read stays put as revisions move between the text and the margin", async ({
  page,
}) => {
  // A fixed text width, so only the revisions reflow the page.
  await page.setViewportSize({ width: 1100, height: 500 });
  await openApp(page, {
    settings: { language: "en", contentWidth: "standard" },
    storage: { "levis-agent-panel-open": "1" },
  });
  // WebKit has no scroll anchoring: take Chromium's away too.
  await page.addStyleTag({
    content: "* { overflow-anchor: none !important; }",
  });
  const filler = Array.from(
    { length: 12 },
    (_, i) => `Paragraph ${i} keeps the page long enough to scroll.`,
  ).join("\n\n");
  await proposeRevision(page, `${DOC}\n${filler}\n`);
  await page.keyboard.press("Control+Shift+L");
  await expect(page.locator(".revision-note")).toHaveCount(2);

  const line = page.locator(".milkdown p", { hasText: "The second paragraph" });
  const at = async () => (await line.boundingBox())!.y;
  await page
    .locator('[data-active-tab="true"] .editor-scroll')
    .evaluate((s, by) => (s.scrollTop += by), (await at()) - 60);
  const before = await at();
  await page.setViewportSize({ width: 990, height: 500 });
  await expect(page.locator(".milkdown .pending-pick:visible")).toHaveCount(2);
  expect(Math.abs((await at()) - before)).toBeLessThan(2);
  await page.setViewportSize({ width: 1100, height: 500 });
  await expect(page.locator(".revision-note")).toHaveCount(2);
  expect(Math.abs((await at()) - before)).toBeLessThan(2);
});
