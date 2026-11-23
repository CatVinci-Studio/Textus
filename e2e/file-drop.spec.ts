import { expect, test, type Page } from "@playwright/test";
import { emit, MAC, mockInvoke, openApp, settled, sourceOf } from "./helpers";

/*
 * Files dragged into a document: from the sidebar (the app's own pointer
 * drag) and from a file manager (Tauri's drag events, emitted here as Rust
 * sends them). Pictures and other files go in between blocks where they
 * are let go; a note, Shift, an edge or a tab row opens them.
 */

const DOC = "# Trip\n\nFirst day.\n\nSecond day.\n";
const LONG = "Rain. ".repeat(120).trim();

async function openFolder(page: Page) {
  await page.addInitScript((doc) => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/trip/log.md": doc,
      "/trip/plan.md": "# Plan\n",
      "/trip/assets/boat.png": "",
      "/trip/report.pdf": "",
      "/downloads/tickets.pdf": "%PDF",
      "/downloads/boat 1.png": "",
      "/downloads/notes.md": "# Notes\n\nFrom the desktop.\n",
      "/downloads/todo.md": "# Todo\n",
    };
    w.__devPickFolder = "/trip";
    w.__devPictureSizes = {
      "/trip/assets/boat.png": { width: 40, height: 20 },
    };
  }, DOC);
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-folder");
  await page.locator(".tree-row", { hasText: "assets" }).click();
  await page.locator(".tree-row", { hasText: "log.md" }).dblclick();
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("Second day.");
}

const paragraph = (page: Page, text: string) =>
  page.locator('[data-active-tab="true"] .ProseMirror p', { hasText: text });

/** Between "First day." and "Second day.", across the middle of the
 *  document: well off its edges, which split. */
async function betweenDays(page: Page) {
  const island = (await page.locator("section.island").boundingBox())!;
  const first = (await paragraph(page, "First day.").boundingBox())!;
  const second = (await paragraph(page, "Second day.").boundingBox())!;
  return {
    x: island.x + island.width / 2,
    y: (first.y + first.height + second.y) / 2,
  };
}

/** Presses on a sidebar row and moves to `to`, held there; `release` lets
 *  go. */
async function dragRow(page: Page, name: string, to: { x: number; y: number }) {
  const row = (await page
    .locator(".tree-row", { hasText: name })
    .boundingBox())!;
  await page.mouse.move(row.x + 20, row.y + row.height / 2);
  await page.mouse.down();
  // Up from below: a room opening on the way pushes nothing down past the
  // place aimed at.
  await page.mouse.move(to.x, to.y + 200, { steps: 12 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
}

test("a picture from the sidebar goes in where it is let go, in one undo step", async ({
  page,
}) => {
  await openFolder(page);
  await dragRow(page, "boat.png", await betweenDays(page));
  // Room opens there, saying what letting go does.
  const room = page.locator(".file-drop-room-image");
  await expect(room).toBeVisible();
  await expect(room).toContainText("Insert image · ⇧ Open");
  await page.mouse.up();
  await expect(room).toHaveCount(0);
  const picture = page.locator(
    '[data-active-tab="true"] .ProseMirror p.image-paragraph',
  );
  await expect(picture).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(picture).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(picture).toHaveCount(1);
  expect(await sourceOf(page)).toBe(
    "# Trip\n\nFirst day.\n\n![](assets/boat.png)\n\nSecond day.",
  );
});

test("a PDF from the sidebar goes in as a link; a note opens; Shift opens", async ({
  page,
}) => {
  await openFolder(page);
  await dragRow(page, "report.pdf", await betweenDays(page));
  await expect(page.locator(".file-drop-room-link")).toContainText(
    "Insert link · ⇧ Open",
  );
  await page.mouse.up();
  await expect(paragraph(page, "report.pdf")).toBeVisible();

  // A note opens in a tab of its own: no room for it.
  await dragRow(page, "plan.md", await betweenDays(page));
  await expect(page.locator(".file-drop-room")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('[role="tab"]', { hasText: "plan" })).toBeVisible();

  // Shift, pressed with the pointer still: the room goes, and the PDF
  // opens instead of going in.
  await page.locator('[role="tab"]', { hasText: "log" }).click();
  await dragRow(page, "report.pdf", await betweenDays(page));
  await expect(page.locator(".file-drop-room")).toHaveCount(1);
  await page.keyboard.down("Shift");
  await expect(page.locator(".file-drop-room")).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  expect(await sourceOf(page)).toBe(
    "# Trip\n\nFirst day.\n\n[report.pdf](report.pdf)\n\nSecond day.",
  );
});

test("a file from the sidebar let go on a document's edge opens beside it", async ({
  page,
}) => {
  await openFolder(page);
  const island = (await page.locator("section.island").boundingBox())!;
  await dragRow(page, "plan.md", {
    x: island.x + island.width - 12,
    y: island.y + island.height / 2,
  });
  await expect(page.locator(".file-drop-room")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator("section.island")).toHaveCount(2);
});

test("a file splits off only close by a document's side, never at its foot", async ({
  page,
}) => {
  await openFolder(page);
  const island = (await page.locator("section.island").boundingBox())!;
  // Past a file's band (80 px at most), well inside a tab's (a fifth).
  await dragRow(page, "plan.md", {
    x: island.x + island.width - 90,
    y: island.y + island.height / 2,
  });
  await page.mouse.up();
  await expect(page.locator('[role="tab"]', { hasText: "plan" })).toBeVisible();
  await expect(page.locator("section.island")).toHaveCount(1);
  // Near the foot, where a tab would stack one below.
  await emit(page, "tauri://drag-enter", {
    paths: ["/downloads/todo.md"],
    position: {
      x: island.x + island.width / 2,
      y: island.y + island.height - 20,
    },
  });
  await emit(page, "tauri://drag-drop", {
    paths: ["/downloads/todo.md"],
    position: {
      x: island.x + island.width / 2,
      y: island.y + island.height - 20,
    },
  });
  await expect(page.locator('[role="tab"]', { hasText: "todo" })).toBeVisible();
  await expect(page.locator("section.island")).toHaveCount(1);
});

test("a file from a file manager is copied beside the document and linked; Shift opens", async ({
  page,
}) => {
  await openFolder(page);
  const at = await betweenDays(page);
  await emit(page, "tauri://drag-enter", {
    paths: ["/downloads/tickets.pdf"],
    position: at,
  });
  await emit(page, "tauri://drag-over", { position: at });
  await expect(page.locator(".file-drop-room-link")).toBeVisible();
  await emit(page, "tauri://drag-drop", {
    paths: ["/downloads/tickets.pdf"],
    position: at,
  });
  await expect(paragraph(page, "tickets.pdf")).toBeVisible();
  const copied = await page.evaluate(() =>
    Object.keys(
      (window as unknown as { __devFs: Record<string, string> }).__devFs,
    ).filter((p) => p.endsWith("/tickets.pdf")),
  );
  expect(copied.some((p) => p.startsWith("/trip/"))).toBe(true);
  expect(await sourceOf(page)).toMatch(
    /First day\.\n\n\[tickets\.pdf\]\([^)]*tickets\.pdf\)\n\nSecond day\./,
  );

  // With Shift held (asked of the system): no room, and it opens instead.
  const before = await sourceOf(page);
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__devDragShift = true;
  });
  await emit(page, "tauri://drag-enter", {
    paths: ["/downloads/tickets.pdf"],
    position: at,
  });
  await emit(page, "tauri://drag-over", { position: at });
  await settled(page);
  await expect(page.locator(".file-drop-room")).toHaveCount(0);
  await emit(page, "tauri://drag-drop", {
    paths: ["/downloads/tickets.pdf"],
    position: at,
  });
  await settled(page);
  expect(await sourceOf(page)).toBe(before);
});

test("a file from a file manager let go on a document's edge opens beside it", async ({
  page,
}) => {
  await openFolder(page);
  const island = (await page.locator("section.island").boundingBox())!;
  const edge = {
    x: island.x + island.width - 12,
    y: island.y + island.height / 2,
  };
  await emit(page, "tauri://drag-enter", {
    paths: ["/trip/plan.md"],
    position: edge,
  });
  await emit(page, "tauri://drag-drop", {
    paths: ["/trip/plan.md"],
    position: edge,
  });
  await expect(page.locator("section.island")).toHaveCount(2);
});

test("several files from the sidebar go in together in one undo step, a note among them opening", async ({
  page,
}) => {
  await openFolder(page);
  const row = (name: string) => page.locator(".tree-row", { hasText: name });
  // Picked by ⌘/Ctrl-click, which starts from the document open (log.md):
  // that one let go of again.
  for (const name of ["boat.png", "plan.md", "report.pdf", "log.md"])
    await row(name).click({ modifiers: [MAC ? "Meta" : "Control"] });
  await expect(page.locator(".tree-row-picked")).toHaveCount(3);
  await dragRow(page, "boat.png", await betweenDays(page));
  // A room each for what goes in, in order; none for the note.
  await expect(page.locator(".file-drop-room")).toHaveCount(2);
  await expect(page.locator(".file-drop-room").first()).toHaveClass(
    /file-drop-room-image/,
  );
  await page.mouse.up();
  await expect(page.locator('[role="tab"]', { hasText: "plan" })).toBeVisible();
  await page.locator('[role="tab"]', { hasText: "log" }).click();
  const picture = page.locator(
    '[data-active-tab="true"] .ProseMirror p.image-paragraph',
  );
  await expect(picture).toHaveCount(1);
  await expect(paragraph(page, "report.pdf")).toHaveCount(1);
  await paragraph(page, "Second day.").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(picture).toHaveCount(0);
  await expect(paragraph(page, "report.pdf")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(picture).toHaveCount(1);
  expect(await sourceOf(page)).toBe(
    "# Trip\n\nFirst day.\n\n![](assets/boat.png)\n\n[report.pdf](report.pdf)\n\nSecond day.",
  );
});

test("Shift pressed and let go with the pointer still: the room goes and comes back", async ({
  page,
}) => {
  await openFolder(page);
  await dragRow(page, "report.pdf", await betweenDays(page));
  const room = page.locator(".file-drop-room");
  await expect(room).toHaveCount(1);
  await page.keyboard.down("Shift");
  await expect(room).toHaveCount(0);
  await page.keyboard.up("Shift");
  await expect(room).toHaveCount(1);
  await page.mouse.up();
  await expect(paragraph(page, "report.pdf")).toBeVisible();
});

test("a picture let go on a tab row opens: a tab's room there, nothing put in", async ({
  page,
}) => {
  await openFolder(page);
  // Two tabs, so the row shows.
  await page.locator(".tree-row", { hasText: "plan.md" }).dblclick();
  await page.locator('[role="tab"]', { hasText: "log" }).click();
  const bar = (await page
    .locator(".main-pane .tab-bar")
    .first()
    .boundingBox())!;
  await dragRow(page, "boat.png", {
    x: bar.x + bar.width / 2,
    y: bar.y + bar.height / 2,
  });
  await expect(page.locator(".file-drop-room")).toHaveCount(0);
  // Its room in the row, as a tab from another window gets.
  await expect(
    page.locator(".tab-bar .tab-pill-title", { hasText: "boat.png" }),
  ).toBeVisible();
  await page.mouse.up();
  await page.locator('[role="tab"]', { hasText: "log" }).click();
  await expect(page.locator(".ProseMirror p.image-paragraph")).toHaveCount(0);
});

test("the room opens under the pointer below a long paragraph", async ({
  page,
}) => {
  await page.addInitScript((long) => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/trip/log.md": `# Trip\n\n${long}\n\nLast day.\n`,
      "/trip/report.pdf": "",
    };
    w.__devPickFolder = "/trip";
  }, LONG);
  await openApp(page, { settings: { language: "en" } });
  await emit(page, "menu-open-folder");
  await page.locator(".tree-row", { hasText: "log.md" }).dblclick();
  const long = (await paragraph(page, "Rain.").boundingBox())!;
  const last = (await paragraph(page, "Last day.").boundingBox())!;
  const island = (await page.locator("section.island").boundingBox())!;
  // Passing the document's left edge on the way, as every drag from the
  // sidebar does.
  await dragRow(page, "report.pdf", {
    x: island.x + island.width / 2,
    y: (long.y + long.height + last.y) / 2,
  });
  const room = page.locator(".file-drop-room");
  await expect(room).toHaveCount(1);
  const box = (await room.boundingBox())!;
  expect(box.y).toBeGreaterThan(long.y + long.height - 4);
  await page.mouse.up();
  expect(await sourceOf(page)).toBe(
    `# Trip\n\n${LONG}\n\n[report.pdf](report.pdf)\n\nLast day.`,
  );
});

test("a picture from a file manager goes in where it is let go, stored as a pasted one", async ({
  page,
}) => {
  await openFolder(page);
  await mockInvoke(page, {
    read_binary_file_base64: "AAAA",
    save_pasted_image: {
      src: "assets/boat%201.png",
      embed: null,
      path: "/trip/assets/boat 1.png",
    },
  });
  const at = await betweenDays(page);
  const paths = ["/downloads/boat 1.png"];
  await emit(page, "tauri://drag-enter", { paths, position: at });
  await emit(page, "tauri://drag-over", { position: at });
  await expect(page.locator(".file-drop-room-image")).toBeVisible();
  await emit(page, "tauri://drag-drop", { paths, position: at });
  await expect(page.locator(".ProseMirror p.image-paragraph")).toHaveCount(1);
  // As a picture pasted or dropped before: the path the store gave.
  expect(await sourceOf(page)).toMatch(
    /^# Trip\n\nFirst day\.\n\n!\[\]\(<?assets\/boat(%20| )1\.png>?\)\n\nSecond day\.$/,
  );
});

test("a note from a file manager let go on another island opens there, the draft in front left be", async ({
  page,
}) => {
  await openFolder(page);
  const island = (await page.locator("section.island").boundingBox())!;
  await dragRow(page, "plan.md", {
    x: island.x + island.width - 12,
    y: island.y + island.height / 2,
  });
  await page.mouse.up();
  const islands = page.locator("section.island");
  await expect(islands).toHaveCount(2);
  // A fresh draft in front, in the island on the right.
  await emit(page, "menu-new-file");
  const rows = page.locator(".island-row");
  const draftSide = rows.nth(1).locator('[role="tab"]');
  await expect(draftSide).toHaveText([/plan/, /Untitled/]);
  const left = (await islands.nth(0).boundingBox())!;
  const at = { x: left.x + left.width / 2, y: left.y + left.height / 2 };
  const paths = ["/downloads/notes.md", "/downloads/todo.md"];
  await emit(page, "tauri://drag-enter", { paths, position: at });
  await emit(page, "tauri://drag-drop", { paths, position: at });
  // Both open where they were let go, in the order dropped.
  const tabs = rows.nth(0).locator('[role="tab"]');
  await expect(tabs).toHaveText([/log/, /notes/, /todo/]);
  // The draft is still there, untouched.
  await expect(draftSide).toHaveText([/plan/, /Untitled/]);
});

test("a note from a file manager let go on an untouched draft in another island takes its place", async ({
  page,
}) => {
  await openFolder(page);
  const island = (await page.locator("section.island").boundingBox())!;
  await dragRow(page, "plan.md", {
    x: island.x + island.width - 12,
    y: island.y + island.height / 2,
  });
  await page.mouse.up();
  const islands = page.locator("section.island");
  await expect(islands).toHaveCount(2);
  await emit(page, "menu-new-file");
  const rows = page.locator(".island-row");
  await expect(rows.nth(1).locator('[role="tab"]')).toHaveText([
    /plan/,
    /Untitled/,
  ]);
  // The other island in front now; the draft is let go on.
  await rows.nth(0).locator('[role="tab"]', { hasText: "log" }).click();
  const right = (await islands.nth(1).boundingBox())!;
  const at = { x: right.x + right.width / 2, y: right.y + right.height / 2 };
  const paths = ["/downloads/notes.md"];
  await emit(page, "tauri://drag-enter", { paths, position: at });
  await emit(page, "tauri://drag-drop", { paths, position: at });
  await expect(rows.nth(1).locator('[role="tab"]')).toHaveText([
    /plan/,
    /notes/,
  ]);
  await expect(rows.nth(0).locator('[role="tab"]')).toHaveText([/log/]);
});

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
