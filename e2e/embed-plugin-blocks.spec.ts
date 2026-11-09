import { expect, test } from "@playwright/test";
import { hasPlugin, openPath, openWithPlugins } from "./plugin-helpers";

// A plugin's block in an embedded note: one line with the plugin's name,
// drawn once clicked, the embed staying drawn.

test.skip(
  !hasPlugin("catvinci.database") || !hasPlugin("catvinci.backlinks"),
  "Wiki and Two-way Links are not in this checkout",
);

const BASE =
  "filters:\n  and:\n    - file.inFolder(this.file.folder)\n    - file.path != this.file.path\nviews:\n  - type: table\n    name: Table";

test("a database in an embedded note is a line until clicked", async ({
  page,
}) => {
  await openWithPlugins(page, {
    plugins: {
      "catvinci.database": [
        "files.read",
        "files.write",
        "editor.read",
        "editor.write",
        "ai.tools",
      ],
      "catvinci.backlinks": ["files.read", "editor.read"],
    },
    folder: {
      "/work/Home.md": "# Home\n\n![[Tasks]]\n",
      "/work/Tasks/Tasks.md": "# Tasks\n\n```base\n" + BASE + "\n```\n",
      "/work/Tasks/Week1.md": "---\nstatus: Doing\n---\n# Week1\n",
    },
  });
  await openPath(page, "/work/Home.md");
  const card = page.locator(".note-embed-block-open");
  await expect(card).toHaveText("Wiki · click to show");
  await card.click();
  const frame = page.locator(".note-embed-block-page iframe");
  await expect(frame).toBeVisible();
  // Still the embed, not its ![[...]] source.
  await expect(page.locator(".note-embed-body")).toBeVisible();
  await expect(
    page.frameLocator(".note-embed-block-page iframe").locator("#count"),
  ).toHaveText("1 pages");
});
