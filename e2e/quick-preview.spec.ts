import { expect, test, type Page } from "@playwright/test";
import { mockInvoke } from "./helpers";
import { openPath, openWithPlugins } from "./plugin-helpers";

/**
 * Quick Preview (catvinci.quick-preview): the pointer resting on a link to
 * another document shows its opening, or the section the link names, in
 * a card beside it - the app's card, filled by the plugin's hover
 * provider. Pin keeps it.
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const card = (page: Page) => page.locator(".hover-card");

const NOTES = {
  "/notes/one.md":
    "# One\n\nSee [the harbour](two.md#the-harbour) and [[two]] for more.\n",
  "/notes/two.md":
    "---\ntags: [boats]\n---\n# Two\n\nThe opening of two.\n\n## The harbour\n\nBoats came in at dusk.\n\n## Later\n\nNothing else.\n",
};

async function open(page: Page) {
  await openWithPlugins(page, {
    plugins: { "catvinci.quick-preview": ["editor.read", "files.read"] },
    folder: NOTES,
  });
  await openPath(page, "/notes/one.md");
  await expect(page.locator(`${editor} h1`)).toContainText("One");
}

/** Rests the pointer on `target` until a card comes (the plugin may still
 *  be starting the first time). */
async function restOn(page: Page, target: ReturnType<Page["locator"]>) {
  await expect(async () => {
    await page.mouse.move(0, 0);
    await target.hover();
    await expect(card(page)).toBeVisible({ timeout: 1500 });
  }).toPass();
}

test("a link to a section shows that section of the document in a card", async ({
  page,
}) => {
  await open(page);
  await restOn(page, page.locator(`${editor} a`, { hasText: "the harbour" }));
  await expect(card(page).locator(".hover-card-title")).toHaveText(
    "two › The harbour",
  );
  await expect(card(page)).toContainText("Boats came in at dusk.");
  await expect(card(page)).not.toContainText("Nothing else.");
  // Away from the link and the card, it goes.
  await page.mouse.move(5, 400);
  await expect(card(page)).toHaveCount(0);
});

test("a wikilink shows the note's opening, without its front matter", async ({
  page,
}) => {
  await open(page);
  await mockInvoke(page, { resolve_vault_note: "/notes/two.md" });
  await restOn(page, page.locator(`${editor} [data-type="wikilink"]`));
  await expect(card(page).locator(".hover-card-title")).toHaveText("two");
  await expect(card(page)).toContainText("The opening of two.");
  await expect(card(page)).not.toContainText("tags:");
});

test("Open on a card goes to the document, at the section linked to", async ({
  page,
}) => {
  await open(page);
  await restOn(page, page.locator(`${editor} a`, { hasText: "the harbour" }));
  await card(page).getByRole("button", { name: "Open" }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(`${editor} h1`)).toContainText("Two");
});

test("a pinned card stays while the pointer goes, and closes by its button", async ({
  page,
}) => {
  await open(page);
  await restOn(page, page.locator(`${editor} a`, { hasText: "the harbour" }));
  await card(page).getByRole("button", { name: "Pin" }).click();
  await page.mouse.move(5, 400);
  await page.waitForTimeout(500);
  await expect(card(page)).toBeVisible();
  // Typing goes on in the document meanwhile.
  await page.locator(`${editor} p`).click();
  await page.keyboard.type(" Typed.");
  await expect(card(page)).toBeVisible();
  await card(page).getByRole("button", { name: "Close" }).click();
  await expect(card(page)).toHaveCount(0);
});

test("without a plugin that previews, resting on a link shows nothing", async ({
  page,
}) => {
  await openWithPlugins(page, { plugins: {}, folder: NOTES });
  await openPath(page, "/notes/one.md");
  await page.locator(`${editor} a`, { hasText: "the harbour" }).hover();
  await page.waitForTimeout(900);
  await expect(card(page)).toHaveCount(0);
});

test("a citation shows what it cites, from Zotero", async ({ page }) => {
  const items = [
    {
      key: "ABCD1234",
      data: {
        title: "On the Origin of Species",
        creators: [{ creatorType: "author", lastName: "Darwin" }],
        date: "1859",
        publisher: "John Murray",
        abstractNote: "Natural selection, explained.",
        citationKey: "darwin1859",
      },
    },
  ];
  await openWithPlugins(page, {
    plugins: {
      "catvinci.zotero": [
        "network:localhost:23119",
        "editor.write",
        "editor.read",
      ],
    },
    folder: {
      "/notes/essay.md": "# Essay\n\nAs shown [@darwin1859], species change.\n",
    },
  });
  await openPath(page, "/notes/essay.md");
  await mockInvoke(page, {
    plugin_http: {
      status: 200,
      headers: {},
      body: Buffer.from(JSON.stringify(items)).toString("base64"),
    },
  });
  const paragraph = page.locator(`${editor} p`);
  await expect(paragraph).toContainText("[@darwin1859]");
  // The pointer on the key, a little into the citation.
  const box = (await paragraph.boundingBox())!;
  const at = await paragraph.evaluate((p) => {
    const text = p.firstChild!;
    const range = document.createRange();
    const i = text.textContent!.indexOf("@darwin");
    range.setStart(text, i + 2);
    range.setEnd(text, i + 3);
    const r = range.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  expect(at.y).toBeGreaterThan(box.y);
  await expect(async () => {
    await page.mouse.move(0, 0);
    await page.mouse.move(at.x, at.y);
    await expect(card(page)).toBeVisible({ timeout: 1500 });
  }).toPass();
  await expect(card(page).locator(".hover-card-title")).toHaveText(
    "On the Origin of Species",
  );
  await expect(card(page)).toContainText("Darwin · 1859");
  await expect(card(page)).toContainText("John Murray");
  await expect(card(page)).toContainText("Natural selection, explained.");
});
