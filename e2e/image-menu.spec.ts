import { expect, test, type Page } from "@playwright/test";
import { calls, openDoc } from "./image-disk";

/**
 * A picture's right-click menu offers its file next to the width items: Show
 * in folder for a local one, and Copy image path (the full path, or a web
 * image's address).
 */

const menuItems = (page: Page) => page.locator(".context-menu-item");

test("a local image's menu shows its file in the folder and copies its full path", async ({
  page,
}) => {
  const doc = await openDoc(page, "![A cat](assets/cat.png)\n", {
    existing: ["/home/me/notes/assets/cat.png"],
    loadable: ["/home/me/notes/assets/cat.png"],
  });
  const img = doc.locator(".image-view img");
  await expect(img).toBeVisible();

  await img.click({ button: "right" });
  await expect(menuItems(page)).toContainText([
    "Image width: 100%",
    "Show in folder",
    "Copy image path",
    "Cut",
  ]);
  await menuItems(page).filter({ hasText: "Show in folder" }).click();
  await expect
    .poll(() => calls(page, "reveal_in_dir"))
    .toEqual([
      { cmd: "reveal_in_dir", args: { path: "/home/me/notes/assets/cat.png" } },
    ]);

  await img.click({ button: "right" });
  await menuItems(page).filter({ hasText: "Copy image path" }).click();
  await expect
    .poll(() => calls(page, "clipboard"))
    .toEqual([
      { cmd: "clipboard", args: { text: "/home/me/notes/assets/cat.png" } },
    ]);
});

test("a web image's menu copies its address and has no folder to show", async ({
  page,
}) => {
  const url = "https://img.example.com/brand/logo.png";
  const doc = await openDoc(page, `![Logo](${url})\n`, { web: [url] });
  const img = doc.locator(".image-view img");
  await expect(img).toBeVisible();

  await img.click({ button: "right" });
  await expect(menuItems(page).first()).toBeVisible();
  await expect(
    menuItems(page).filter({ hasText: "Show in folder" }),
  ).toHaveCount(0);
  await menuItems(page).filter({ hasText: "Copy image path" }).click();
  await expect
    .poll(() => calls(page, "clipboard"))
    .toEqual([{ cmd: "clipboard", args: { text: url } }]);
});

test("an Obsidian embed's menu uses the file found in the vault", async ({
  page,
}) => {
  const file = "/home/me/notes/attachments/cat.png";
  const doc = await openDoc(page, "Trip\n\n![[cat.png|Our cat]]\n", {
    vault: { "cat.png": file },
    existing: [file],
    loadable: [file],
  });
  const img = doc.locator(".obsidian-embed-rendered img");
  await expect(img).toBeVisible();

  // The right-click leaves the picture up: no caret into its source.
  await img.click({ button: "right" });
  await expect(menuItems(page).first()).toHaveText("Show in folder");
  await menuItems(page).filter({ hasText: "Show in folder" }).click();
  await expect
    .poll(() => calls(page, "reveal_in_dir"))
    .toEqual([{ cmd: "reveal_in_dir", args: { path: file } }]);

  await img.click({ button: "right" });
  await menuItems(page).filter({ hasText: "Copy image path" }).click();
  await expect
    .poll(() => calls(page, "clipboard"))
    .toEqual([{ cmd: "clipboard", args: { text: file } }]);
});

test("a picture opens in the viewer from its corner button or a double click", async ({
  page,
}) => {
  const doc = await openDoc(page, "![A cat](assets/cat.png)\n", {
    existing: ["/home/me/notes/assets/cat.png"],
    loadable: ["/home/me/notes/assets/cat.png"],
  });
  const img = doc.locator(".image-view img");
  await expect(img).toBeVisible();
  const viewer = page.getByRole("dialog", { name: "Picture" });

  await img.hover();
  await doc.getByRole("button", { name: "Enlarge picture" }).click();
  await expect(viewer.locator("img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  await img.dblclick();
  await expect(viewer.locator("img")).toBeVisible();
  await viewer.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toHaveCount(0);
  // Only looked at: the document is as it was.
  await expect(doc.locator(".image-view")).toHaveCount(1);
});

for (const how of ["Copy", "ControlOrMeta+c"])
  test(`${how} on a right-clicked picture puts the picture alone on the clipboard, so chat apps paste it`, async ({
    page,
  }) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    const doc = await openDoc(page, "Before.\n\n![A cat](assets/cat.png)\n", {
      existing: ["/home/me/notes/assets/cat.png"],
      loadable: ["/home/me/notes/assets/cat.png"],
    });
    const img = doc.locator(".image-view img");
    await expect(img).toBeVisible();
    await img.click({ button: "right" });
    if (how === "Copy")
      await menuItems(page)
        .filter({ hasText: /^Copy$/ })
        .click();
    else {
      await page.keyboard.press("Escape");
      await page.keyboard.press(how);
    }
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const [item] = await navigator.clipboard.read();
          return item ? [...item.types].sort() : [];
        }),
      )
      .toEqual(["image/png"]);
  });
