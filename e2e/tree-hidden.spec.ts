import { expect, test } from "@playwright/test";
import { openApp, openTreeFolder, treeRow, emit } from "./helpers";

const FILES = {
  "/v/a.md": "# A",
  "/v/.agents/skills/s.md": "# S",
  "/v/.git/config": "x",
};

test("dot names stay out of the tree until the setting is on, then draw muted", async ({
  page,
}) => {
  await openTreeFolder(page, "/v", FILES);
  await expect(treeRow(page, "a.md")).toBeVisible();
  await expect(treeRow(page, ".agents")).toHaveCount(0);
});

test("with the setting on, a dot folder lists, opens lazily and is muted", async ({
  page,
}) => {
  await page.addInitScript((files) => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = files;
    w.__devPickFolder = "/v";
  }, FILES);
  await openApp(page, {
    settings: { language: "en", showHiddenFiles: true },
  });
  await emit(page, "menu-open-folder");
  const agents = treeRow(page, ".agents");
  await expect(agents).toHaveClass(/tree-row-hidden/);
  await expect(treeRow(page, "a.md")).not.toHaveClass(/tree-row-hidden/);
  await expect(treeRow(page, "s.md")).toHaveCount(0);
  await agents.click();
  await treeRow(page, "skills").click();
  await expect(treeRow(page, "s.md")).toBeVisible();
});
