import { expect, test, type Page } from "@playwright/test";
import { emit, openApp, sourceOf } from "./helpers";

/*
 * Files and folders dragged from a file manager onto the sidebar's file
 * tree (Tauri's drag events, emitted here as Rust sends them): with a
 * folder open, the folder under the pointer lights up and, after asking,
 * they are copied into it; with none, they open as before.
 */

const DOC = "# Trip\n\nFirst day.\n";

async function openFolder(page: Page) {
  await page.addInitScript((doc) => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/trip/log.md": doc,
      "/trip/assets/boat.png": "",
      "/downloads/tickets.pdf": "%PDF",
      "/downloads/notes.md": "# Notes\n",
      "/downloads/todo.md": "# Todo\n",
    };
    w.__devPickFolder = "/trip";
  }, DOC);
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-folder");
  await page.locator(".tree-row", { hasText: "log.md" }).dblclick();
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("First day.");
}

/** Files from a file manager dragged over the point (x, y) and let go
 *  there, as Tauri sends them. */
async function systemDrop(
  page: Page,
  paths: string[],
  at: { x: number; y: number },
) {
  await emit(page, "tauri://drag-enter", { paths, position: at });
  await emit(page, "tauri://drag-over", { position: at });
  await emit(page, "tauri://drag-drop", { paths, position: at });
}

const centre = async (page: Page, name: string) => {
  const box = (await page
    .locator(".tree-row", { hasText: name })
    .first()
    .boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const devFiles = (page: Page) =>
  page.evaluate(() =>
    Object.keys(
      (window as unknown as { __devFs: Record<string, string> }).__devFs,
    ),
  );

test("files from a file manager let go on a folder of the tree are copied in, after asking", async ({
  page,
}) => {
  await openFolder(page);
  const assets = await centre(page, "assets");
  const paths = ["/downloads/tickets.pdf", "/downloads/notes.md"];
  await emit(page, "tauri://drag-enter", { paths, position: assets });
  await emit(page, "tauri://drag-over", { position: assets });
  // The folder under the pointer lit, as for a row dragged onto it.
  await expect(
    page.locator(".tree-row.tx-drop-into", { hasText: "assets" }),
  ).toBeVisible();
  await expect(page.locator(".file-drop-room")).toHaveCount(0);
  await emit(page, "tauri://drag-drop", { paths, position: assets });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Copy 2 items to “assets”?");
  await expect(dialog).toContainText("tickets.pdf");
  await expect(dialog).toContainText("notes.md");
  await expect(page.locator(".tree-row.tx-drop-into")).toHaveCount(0);
  // Cancelled: nothing copied, nothing opened.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await devFiles(page)).filter((p) => p.startsWith("/trip/assets/")),
  ).toEqual(["/trip/assets/boat.png"]);
  await expect(page.locator('[role="tab"]', { hasText: "notes" })).toHaveCount(
    0,
  );

  await systemDrop(page, paths, assets);
  await dialog.getByRole("button", { name: "Copy" }).click();
  await expect(
    page.locator(".tree-row", { hasText: "tickets.pdf" }),
  ).toBeVisible();
  await expect(
    page.locator(".tree-row", { hasText: "notes.md" }),
  ).toBeVisible();
  const files = await devFiles(page);
  expect(files).toContain("/trip/assets/tickets.pdf");
  expect(files).toContain("/trip/assets/notes.md");
  // Copied, not moved; and the first copy is the row in hand.
  expect(files).toContain("/downloads/tickets.pdf");
  await expect(
    page.locator(".tree-row-picked", { hasText: "tickets.pdf" }),
  ).toBeVisible();
  // Opened nothing, put nothing into the document.
  await expect(page.locator('[role="tab"]', { hasText: "notes" })).toHaveCount(
    0,
  );
  expect(await sourceOf(page)).toBe(DOC.trimEnd());
});

test("let go on a file's row the tree copies into its folder; Don't Ask Again stops the question", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/trip/log.md": "# Trip\n",
      "/trip/plan.md": "# Plan\n",
      "/downloads/todo.md": "# Todo\n",
      "/downloads/photos/cover.png": "",
      "/downloads/photos/day 1/boat.png": "",
    };
    w.__devPickFolder = "/trip";
  });
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-folder");
  const plan = await centre(page, "plan.md");
  await emit(page, "tauri://drag-enter", {
    paths: ["/downloads/todo.md"],
    position: plan,
  });
  await emit(page, "tauri://drag-over", { position: plan });
  // A file's row: its folder, here the open folder itself, is lit.
  await expect(page.locator(".tree-body.tx-drop-into")).toHaveCount(1);
  await emit(page, "tauri://drag-drop", {
    paths: ["/downloads/todo.md"],
    position: plan,
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Copy 1 item to “trip”?");
  await dialog.getByRole("checkbox", { name: "Don't ask again" }).check();
  await dialog.getByRole("button", { name: "Copy" }).click();
  await expect(page.locator(".tree-row", { hasText: "todo.md" })).toBeVisible();

  // Asked no more: the same name again is numbered, a folder comes whole.
  await systemDrop(page, ["/downloads/todo.md", "/downloads/photos"], plan);
  await expect(
    page.locator(".tree-row", { hasText: "todo 2.md" }),
  ).toBeVisible();
  await expect(page.locator(".tree-row", { hasText: "photos" })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  const files = await devFiles(page);
  expect(files).toContain("/trip/todo.md");
  expect(files).toContain("/trip/todo 2.md");
  expect(files).toContain("/trip/photos/day 1/boat.png");
  // Settings › General turns asking back on.
  await emit(page, "menu-settings");
  const ask = page.getByRole("switch", {
    name: "Ask before copying files dropped onto the file tree",
  });
  await expect(ask).not.toBeChecked();
  await ask.click();
  await expect(ask).toBeChecked();
  // Asked again.
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await systemDrop(page, ["/downloads/todo.md"], await centre(page, "plan.md"));
  await expect(dialog).toContainText("Copy 1 item to “trip”?");
});

test("with no folder open, a file let go on the sidebar opens, as before", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = { "/downloads/todo.md": "# Todo\n" };
  });
  await openApp(page, { settings: { language: "en" } });
  const side = (await page
    .getByRole("complementary", { name: "Sidebar" })
    .boundingBox())!;
  await systemDrop(page, ["/downloads/todo.md"], {
    x: side.x + side.width / 2,
    y: side.y + side.height / 2,
  });
  await expect(page.locator('[role="tab"]', { hasText: "todo" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("what can't be copied is said by name, and the rest still copy", async ({
  page,
}) => {
  await openFolder(page);
  await page.locator(".tree-row", { hasText: "assets" }).click();
  const assets = await centre(page, "assets");
  // A folder into itself is refused; the note beside it goes in.
  await systemDrop(page, ["/trip/assets", "/downloads/todo.md"], assets);
  await page.getByRole("dialog").getByRole("button", { name: "Copy" }).click();
  const message = page.getByRole("alertdialog");
  await expect(message).toContainText("Couldn't copy assets");
  await expect(message).toContainText("A folder can't be copied into itself.");
  expect(await devFiles(page)).toContain("/trip/assets/todo.md");
  await message.getByRole("button", { name: "OK" }).click();
  await expect(
    page.locator(".tree-row-picked", { hasText: "todo.md" }),
  ).toBeVisible();
});
