import { expect, test } from "@playwright/test";
import { selectionRead } from "./helpers";
import { hasPlugin, openPath, openWithPlugins } from "./plugin-helpers";

// The Link Cards plugin: a link made a card from its page's Open Graph
// data, kept in a ```card block; a video plays in place.

const ID = "catvinci.link-cards";
test.skip(!hasPlugin(ID), `${ID} is not in this checkout`);

const PAGE = `<html><head>
  <meta property="og:title" content="A good read">
  <meta property="og:description" content="Why plain text lasts.">
  <meta property="og:site_name" content="Example"></head></html>`;

test("/card makes a card of a link from what its page says", async ({
  page,
}) => {
  await page.addInitScript((html) => {
    (window as unknown as Record<string, unknown>).__devHttp = {
      "https://example.com/read": { body: html },
    };
  }, PAGE);
  await openWithPlugins(page, {
    plugins: { [ID]: ["editor.read", "editor.write", "network:*"] },
    folder: { "/work/a.md": "Reading list\n" },
  });
  await openPath(page, "/work/a.md");
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor).toContainText("Reading list");
  await editor.locator("p").click();
  await selectionRead(page);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/card");
  await page
    .locator(".completion-list")
    .getByText("Insert Link Card…", { exact: true })
    .click();
  const dialog = page.locator(".app-dialog");
  await dialog.getByRole("textbox").fill("https://example.com/read");
  await dialog.getByRole("textbox").press("Enter");
  const card = page
    .frameLocator('[data-active-tab="true"] .plugin-code-block iframe')
    .first();
  await expect(card.locator(".title")).toHaveText("A good read");
  await expect(card.locator(".description")).toHaveText(
    "Why plain text lasts.",
  );
  await expect(card.locator(".site")).toHaveText("Example · example.com");
  const doc = await page.evaluate(
    () =>
      (
        window as unknown as {
          __pmView: { state: { doc: { textContent: string } } };
        }
      ).__pmView.state.doc.textContent,
  );
  expect(doc).toContain("url: https://example.com/read");
});

test("a video's card is its player", async ({ page }) => {
  await openWithPlugins(page, {
    plugins: { [ID]: ["editor.read", "editor.write", "network:*"] },
    folder: {
      "/work/v.md":
        "```card\nurl: https://www.youtube.com/watch?v=abc123\n```\n",
    },
  });
  await openPath(page, "/work/v.md");
  const card = page
    .frameLocator('[data-active-tab="true"] .plugin-code-block iframe')
    .first();
  await expect(card.locator(".video iframe")).toHaveAttribute(
    "src",
    "https://www.youtube.com/embed/abc123",
  );
});
