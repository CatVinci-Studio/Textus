import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// A 2×1 PNG: what the tree's pictures are served as.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnxEIGAEAJ+YD/2jvfVUAAAAASUVORK5CYII=",
  "base64",
);
const ROOT = "/p/novel";

test("a picture in the files sidebar opens on its own, and steps through its folder", async ({
  page,
}) => {
  await page.route("**/__dev-assets/**", (route) =>
    route.fulfill({ body: PNG, contentType: "image/png" }),
  );
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus.openedFolder": ROOT },
  });
  await page.evaluate((root) => {
    const runtime = (window as any).__TAURI_INTERNALS__;
    const original = runtime.invoke;
    runtime.invoke = async (command: string, args: any) => {
      if (command === "list_dir")
        return args.path === root
          ? [
              { name: "assets", path: `${root}/assets`, is_dir: true },
              { name: "draft.md", path: `${root}/draft.md`, is_dir: false },
            ]
          : ["lake.png", "notes.txt", "rain.png"].map((name) => ({
              name,
              path: `${root}/assets/${name}`,
              is_dir: false,
            }));
      return original(command, args);
    };
  }, ROOT);
  await page.locator(".window-bar-sidebar").click();
  await page.locator(".tree-row", { hasText: "assets" }).click();
  // Pictures show as themselves in the tree.
  await expect(page.locator(".tree-thumb")).toHaveCount(2);
  await page.locator(".tree-row", { hasText: "rain.png" }).click();
  const viewer = page.getByRole("dialog", { name: "rain.png" });
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText("2 × 1");
  await expect(viewer).toContainText("2 / 2");
  // ←/→ through the folder's pictures only (not notes.txt).
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "lake.png" })).toBeVisible();
  // Into the document at the cursor, relative to nothing for an untitled one.
  await page
    .getByRole("dialog", { name: "lake.png" })
    .getByRole("button", { name: "Insert into document" })
    .click();
  await expect(page.locator(".image-viewer")).toHaveCount(0);
  await expect(
    page
      .locator('[data-active-tab="true"] .ProseMirror')
      .getByRole("img", { name: "lake" }),
  ).toBeVisible();
});

test("Agent hides the files sidebar, and Write brings it back", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator(".window-bar-sidebar").click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.getByRole("button", { name: /^(Write|写作) ·/ }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
});
