import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("with the + chosen to show the start page, New File there makes it the document", async ({
  page,
}) => {
  await openApp(page, { settings: { addTabShowsStartPage: true } });
  const tabs = page.locator(".tab-pill");
  await expect(tabs).toHaveCount(1);
  await page.locator(".tab-bar-add").first().click();
  await expect(tabs).toHaveCount(2);
  const start = page.locator(".start-page");
  await expect(start).toBeVisible();
  await start.getByRole("button", { name: /新建文件/ }).click();
  await expect(start).toHaveCount(0);
  await expect(tabs).toHaveCount(2);
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toBeVisible();
});

test("empty panels say what is so in the list's own text, with Open Folder where it helps", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", addTabShowsStartPage: true },
  });
  const rail = page.getByRole("navigation", { name: "Activity bar" });
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  // An untitled document in front: no headings yet, no folder to search.
  await rail.getByRole("button", { name: "Outline" }).click();
  await expect(sidebar).toContainText("This document has no headings yet.");
  await rail.getByRole("button", { name: "Search" }).click();
  await expect(sidebar).toContainText(
    "Open a folder to search all its documents.",
  );
  await expect(
    sidebar.getByRole("button", { name: "Open Folder" }),
  ).toBeVisible();
  // The start page in front: no document.
  await page.locator(".tab-bar-add").first().click();
  await expect(page.locator(".start-page")).toBeVisible();
  await rail.getByRole("button", { name: "Outline" }).click();
  await expect(sidebar).toContainText("No document is open.");
  // No folder: the tree says so, with Open Folder.
  await rail.getByRole("button", { name: "Files" }).click();
  await expect(sidebar).toContainText("No folder is open yet.");
  const note = sidebar.locator(".tx-pane-empty");
  // Open Folder alone: New and Open are the menu's.
  await expect(note.getByRole("button")).toHaveText(["Open Folder"]);
  // The list's text, not a footnote.
  const sizes = await note.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.fontSize = "var(--text-list)";
    el.append(probe);
    const list = getComputedStyle(probe).fontSize;
    probe.remove();
    return { note: getComputedStyle(el).fontSize, list };
  });
  expect(sizes.note).toBe(sizes.list);
});
