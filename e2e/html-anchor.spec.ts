import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// A hand-made table of contents links to `<a name>` and `<a id>` anchors,
// in a heading or before a paragraph; Ctrl/Cmd+click scrolls there.

const editor = '[data-active-tab="true"] .ProseMirror';
const filler = Array.from({ length: 80 }, (_, i) => `Filler ${i}.`).join(
  "\n\n",
);
const DOC = [
  "## Contents",
  "- [Seven](#seven)\n- [Custom](#custom-anchor)",
  filler,
  '## <a name="seven"></a>Seven',
  "Under seven.",
  '<a id="custom-anchor"></a>\nAfter the anchor.',
  filler,
].join("\n\n");

async function open(page: Page) {
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate((doc) => {
    const w = window as unknown as {
      __devFiles: Record<string, string>;
      __devEmitTauriEvent: (n: string, p: unknown) => void;
    };
    w.__devFiles = { "/home/me/a.md": doc };
    w.__devEmitTauriEvent("tauri://drag-drop", {
      paths: ["/home/me/a.md"],
      position: { x: 0, y: 0 },
    });
  }, DOC);
  await expect(page.locator(`${editor} a`).first()).toBeVisible();
}

test("a link to an HTML anchor scrolls to it, by name or by id", async ({
  page,
}) => {
  await open(page);
  for (const [link, target] of [
    ["Seven", "Under seven."],
    ["Custom", "After the anchor."],
  ]) {
    await page
      .locator(`${editor} a`, { hasText: link })
      .scrollIntoViewIfNeeded();
    await expect(page.getByText(target)).not.toBeInViewport();
    await page
      .locator(`${editor} a`, { hasText: link })
      .click({ modifiers: ["ControlOrMeta"] });
    await expect(page.getByText(target)).toBeInViewport();
  }
});
