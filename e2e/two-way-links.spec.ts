import { expect, test, type Page } from "@playwright/test";
import { selectionRead } from "./helpers";
import {
  hasPlugin,
  openPath,
  openSidebarList,
  openWithPlugins,
} from "./plugin-helpers";

/**
 * Two-way Links on the core's link APIs: [[ completion in the / panel
 * (metadata.linkTo, files.blockId), embeds drawn read-only
 * (views.registerEmbed) and the backlinks list.
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const panel = ".completion-list:not([hidden])";
const PLUGIN = "catvinci.backlinks";

test.skip(!hasPlugin(PLUGIN), "needs the textus-plugins checkout");

/** The plugins ask for the Textus this change ships in; the dev build is
 *  the one before it. */
async function acceptNextEngine(page: Page) {
  await page.route(/\/dev-plugins\/.*\.json$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /"textus":\s*">=1\.3\.9"/g,
      '"textus": ">=1.3.0"',
    );
    await route.fulfill({ response, body });
  });
}

const disk = (page: Page, path: string) =>
  page.evaluate(
    (p) =>
      (window as unknown as { __devFs: Record<string, string> }).__devFs[p],
    path,
  );

async function open(page: Page, folder: Record<string, string>, path: string) {
  await acceptNextEngine(page);
  await openWithPlugins(page, {
    plugins: {
      [PLUGIN]: ["editor.read", "editor.write", "files.read", "files.write"],
    },
    folder,
  });
  await openPath(page, path);
}

test("[[ lists notes, headings and blocks, and a block picked gets an id", async ({
  page,
}) => {
  await open(
    page,
    {
      "/notes/Doc.md": "Start\n",
      "/notes/Ideas.md":
        "# Ideas\n\n## Plan\n\nFirst point.\n\nSecond point.\n",
    },
    "/notes/Doc.md",
  );
  await expect(page.locator(editor)).toContainText("Start");
  await page.locator(`${editor} p`).first().click();
  await selectionRead(page);
  await page.keyboard.press("End");

  await page.keyboard.type(" [[Ide");
  await expect(
    page.locator(panel).locator(".completion-item").first(),
  ).toContainText("Ideas");
  await page.keyboard.press("Enter");
  await expect(page.locator(`${editor} .wikilink`)).toHaveText("[[Ideas]]");

  await page.keyboard.type(" [[Ideas#Pl");
  await expect(page.locator(panel)).toContainText("Plan");
  await page.keyboard.press("Enter");
  await expect(page.locator(`${editor} .wikilink`).nth(1)).toHaveText(
    "[[Ideas#Plan]]",
  );

  await page.keyboard.type(" [[Ideas#^Sec");
  await expect(
    page.locator(panel).locator(".completion-item").first(),
  ).toContainText("Second point.");
  await page.keyboard.press("Enter");
  // The block had no id: one is written into its note, and the link names it.
  await expect
    .poll(() => disk(page, "/notes/Ideas.md"))
    .toMatch(
      /^# Ideas\n\n## Plan\n\nFirst point\.\n\nSecond point\. \^[0-9a-f]{6}\n$/,
    );
  const id = /\^([0-9a-f]{6})/.exec((await disk(page, "/notes/Ideas.md"))!)![1];
  await expect(page.locator(`${editor} .wikilink`).nth(2)).toHaveText(
    `[[Ideas#^${id}]]`,
  );
});

test("an embed shows its note read-only and follows its changes", async ({
  page,
}) => {
  await open(
    page,
    {
      "/notes/Doc.md":
        "Above\n\n![[Ideas#Plan]]\n\nSee [[Ideas]], not [[Gone]].\n",
      "/notes/Ideas.md": "# Ideas\n\n## Plan\n\nFirst point.\n",
    },
    "/notes/Doc.md",
  );
  const embed = page.locator(`${editor} .note-embed`);
  await expect(embed.locator(".note-embed-title")).toHaveText("Ideas › Plan");
  await expect(embed.locator(".note-embed-body")).toContainText("First point.");
  await expect(embed).toHaveAttribute("contenteditable", "false");
  await expect(page.locator(`${editor} .obsidian-embed-source`)).toBeHidden();
  // A link to a note not written yet is dimmed; one that exists is not.
  const dimmed = page.locator(`${editor} .wikilink`, {
    has: page.locator(".wikilink-missing"),
  });
  await expect(dimmed).toHaveText("[[Gone]]");

  // Its note changes - here, a plugin writes it - and the embed follows.
  await page.evaluate(() => {
    const w = window as unknown as { __devFs: Record<string, string> };
    w.__devFs["/notes/Ideas.md"] = "# Ideas\n\n## Plan\n\nA new point.\n";
    window.dispatchEvent(
      new CustomEvent("textus:file-written", { detail: "/notes/Ideas.md" }),
    );
  });
  await expect(embed.locator(".note-embed-body")).toContainText("A new point.");

  // A click on it puts the caret on its source, which shows.
  await embed.locator(".note-embed-body").click();
  await expect(page.locator(`${editor} .obsidian-embed-source`)).toHaveText(
    "![[Ideas#Plan]]",
  );
  await expect(embed).toHaveCount(0);
});

test("an embed folds under its title and stays folded when drawn again", async ({
  page,
}) => {
  await open(
    page,
    {
      "/notes/Doc.md": "Above\n\n![[Ideas#Plan]]\n",
      "/notes/Ideas.md": "# Ideas\n\n## Plan\n\nFirst point.\n",
    },
    "/notes/Doc.md",
  );
  const embed = page.locator(`${editor} .note-embed`);
  const body = embed.locator(".note-embed-body");
  await expect(body).toBeVisible();
  await embed.getByRole("button", { name: "Collapse" }).click();
  await expect(body).toBeHidden();
  // Folding opens nothing and leaves the source hidden.
  await expect(page.locator(`${editor} .obsidian-embed-source`)).toBeHidden();
  await expect(embed.locator(".note-embed-title")).toHaveText("Ideas › Plan");

  // Its note changes and it is drawn again: still folded.
  await page.evaluate(() => {
    const w = window as unknown as { __devFs: Record<string, string> };
    w.__devFs["/notes/Ideas.md"] = "# Ideas\n\n## Plan\n\nA new point.\n";
    window.dispatchEvent(
      new CustomEvent("textus:file-written", { detail: "/notes/Ideas.md" }),
    );
  });
  await expect(embed.getByRole("button", { name: "Expand" })).toBeVisible();
  await expect(body).toBeHidden();
  await embed.getByRole("button", { name: "Expand" }).press("Enter");
  await expect(body).toContainText("A new point.");
});

test("a section that embeds itself is drawn once", async ({ page }) => {
  await open(
    page,
    { "/notes/Loop.md": "Top\n\n![[#Part]]\n\n## Part\n\nInside ![[#Part]]\n" },
    "/notes/Loop.md",
  );
  // The inner embed, already on the way down, shows as its name.
  const loop = page.locator(`${editor} .note-embed`).first();
  await expect(loop.locator(".note-embed-body").first()).toContainText(
    "Inside",
  );
  await expect(loop.locator(".note-embed-chip").first()).toHaveText(
    "Loop › Part",
  );
});

test("backlinks list a link written with [[ completion", async ({ page }) => {
  await open(
    page,
    {
      "/notes/Doc.md": "See [[Ideas]] for more.\n",
      "/notes/Ideas.md": "# Ideas\n",
    },
    "/notes/Ideas.md",
  );
  await expect(page.locator(editor)).toContainText("Ideas");
  const list = await openSidebarList(page, "Two-way Links");
  await expect(list.locator(".plugin-list-group").first()).toHaveText(
    "Linked mentions · 1",
  );
  await expect(list.locator(".plugin-list-row").first()).toContainText(
    "See [[Ideas]] for more.",
  );
});
