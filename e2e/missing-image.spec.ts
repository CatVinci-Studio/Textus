import { expect, test, type Page } from "@playwright/test";
import { PHONE, openApp, openPhone, pasteMarkdown } from "./helpers";

/**
 * A picture that won't load shows a card in its place
 * (editor/images/missing-image.ts): its name, the reason - asked of the
 * backend, not guessed from the load error - and Choose image… / Show in
 * folder. The document is opened the way a dropped file is, so relative
 * srcs have a folder to resolve against.
 */

const editor = '[data-active-tab="true"] .ProseMirror';
const DOC_PATH = "/home/me/notes/trip.md";
const PICKED = "/home/me/Pictures/new cat.png";

// A 1x1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

interface Disk {
  /** Paths the backend says exist (file_mtime_ms). */
  existing?: string[];
  /** Paths the asset protocol serves a picture for. */
  loadable?: string[];
  /** The vault's files, by the link that finds them (resolve_vault_image). */
  vault?: Record<string, string>;
}

/** Opens `markdown` as DOC_PATH, with a stand-in disk. */
async function openDoc(page: Page, markdown: string, disk: Disk = {}) {
  const loadable = new Set(disk.loadable ?? []);
  await page.route("http://asset.localhost/**", (route) => {
    const path = decodeURIComponent(
      new URL(route.request().url()).pathname.slice(1),
    );
    return loadable.has(path)
      ? route.fulfill({
          contentType: "image/png",
          body: Buffer.from(PNG, "base64"),
        })
      : route.fulfill({ status: 404, body: "" });
  });
  // Nothing leaves the machine: a web image's host can't be reached.
  await page.route("https://img.example.com/**", (route) => route.abort());
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(
    ({ markdown, docPath, existing, vault, picked, png }) => {
      const w = window as unknown as Record<string, unknown> & {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
        };
      };
      const calls: { cmd: string; args: Record<string, unknown> }[] = [];
      w.__diskCalls = calls;
      const there = new Set([docPath, ...existing]);
      const original = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = (cmd, args = {}) => {
        switch (cmd) {
          case "read_text_file":
            return Promise.resolve(markdown);
          case "file_mtime_ms":
            return Promise.resolve(there.has(String(args.path)) ? 1 : null);
          case "resolve_vault_image":
            return Promise.resolve(vault[String(args.link)] ?? null);
          case "open_image_file_dialog":
          case "read_binary_file_base64":
          case "save_pasted_image":
          case "reveal_in_dir":
            calls.push({ cmd, args });
            return Promise.resolve(
              {
                open_image_file_dialog: picked,
                read_binary_file_base64: png,
                save_pasted_image: { src: "assets/image-1.png" },
                reveal_in_dir: null,
              }[cmd],
            );
        }
        return original(cmd, args);
      };
      (w.__devEmitTauriEvent as (name: string, payload: unknown) => void)(
        "tauri://drag-drop",
        {
          paths: [docPath],
          position: { x: 0, y: 0 },
        },
      );
    },
    {
      markdown,
      docPath: DOC_PATH,
      existing: disk.existing ?? [],
      vault: disk.vault ?? {},
      picked: PICKED,
      png: PNG,
    },
  );
  const doc = page.locator(editor);
  await expect(
    doc.locator(":is(.image-view, .obsidian-embed-rendered)").first(),
  ).toBeAttached();
  return doc;
}

const calls = (page: Page, cmd: string) =>
  page.evaluate(
    (cmd) =>
      (
        (window as unknown as { __diskCalls: { cmd: string; args: object }[] })
          .__diskCalls ?? []
      ).filter((call) => call.cmd === cmd),
    cmd,
  );

async function emit(page: Page, name: string) {
  await page.evaluate(
    (n) =>
      (
        window as unknown as { __devEmitTauriEvent: (n: string) => void }
      ).__devEmitTauriEvent(n),
    name,
  );
}

async function sourceOf(page: Page): Promise<string> {
  await emit(page, "menu-toggle-source-mode");
  const textarea = page.locator(
    '[data-active-tab="true"] textarea.source-view',
  );
  await expect(textarea).toBeAttached();
  const value = await textarea.inputValue();
  await emit(page, "menu-toggle-source-mode");
  await expect(textarea).toHaveCount(0);
  return value.trim();
}

test("a local image that isn't on disk names the file and where it was looked for", async ({
  page,
}) => {
  const doc = await openDoc(page, "![A sleeping cat](../img/cat%201.png)\n");
  const card = doc.locator(".missing-image-card");
  await expect(card.locator(".missing-image-title")).toHaveText(
    "Image not found: cat 1.png",
  );
  await expect(card.locator(".missing-image-alt")).toHaveText("A sleeping cat");
  await expect(card.locator(".missing-image-reason")).toHaveText(
    "There's no file at this path.",
  );
  // The relative path, resolved: where the user can go and look.
  await expect(card).toHaveAttribute("title", "/home/me/img/cat 1.png");
  await expect(doc.locator(".image-view img")).toBeHidden();
  await expect(card.getByRole("button")).toHaveText([
    "Choose image…",
    "Show in folder",
  ]);
});

test("Show in folder opens the nearest folder that exists", async ({
  page,
}) => {
  const doc = await openDoc(page, "![](assets/gone/cat.png)\n", {
    existing: ["/home/me/notes"],
  });
  await doc.getByRole("button", { name: "Show in folder" }).click();
  await expect
    .poll(() => calls(page, "reveal_in_dir"))
    .toEqual([{ cmd: "reveal_in_dir", args: { path: "/home/me/notes" } }]);
});

test("a file that is there but can't be shown says so", async ({ page }) => {
  const doc = await openDoc(page, "![](photo.heic)\n", {
    existing: ["/home/me/notes/photo.heic"],
  });
  const card = doc.locator(".missing-image-card");
  await expect(card.locator(".missing-image-title")).toHaveText(
    "Can't show image: photo.heic",
  );
  await expect(card.locator(".missing-image-reason")).toHaveText(
    "The file is there, but it isn't an image format Textus can show.",
  );
});

test("a web image that fails names its host and offers no folder", async ({
  page,
}) => {
  const doc = await openDoc(
    page,
    "![Logo](https://img.example.com/brand/logo.png)\n",
  );
  const card = doc.locator(".missing-image-card");
  await expect(card.locator(".missing-image-title")).toHaveText(
    "Image not found: logo.png",
  );
  await expect(card.locator(".missing-image-alt")).toHaveText("Logo");
  await expect(card.locator(".missing-image-reason")).toHaveText(
    "Couldn't load it from img.example.com.",
  );
  await expect(card).toHaveAttribute(
    "title",
    "https://img.example.com/brand/logo.png",
  );
  await expect(card.getByRole("button")).toHaveText(["Choose image…"]);
});

test("an image that loads shows no card", async ({ page }) => {
  const doc = await openDoc(page, "![](assets/cat.png)\n", {
    loadable: ["/home/me/notes/assets/cat.png"],
  });
  await expect(doc.locator(".image-view img")).toBeVisible();
  await expect(doc.locator(".missing-image-card")).toHaveCount(0);
});

test("Choose image… points the image at the chosen file, as one undo step", async ({
  page,
}) => {
  const doc = await openDoc(page, "Before\n\n![A sleeping cat](cat.png)\n", {
    loadable: ["/home/me/notes/assets/image-1.png"],
  });
  await doc.getByRole("button", { name: "Choose image…" }).click();
  const img = doc.locator(".image-view img");
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute("data-doc-src", "assets/image-1.png");
  await expect(doc.locator(".missing-image-card")).toHaveCount(0);

  // One undo takes the whole change back, and one redo brings it again.
  await doc.getByText("Before").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(doc.locator(".missing-image-card")).toBeVisible();
  await expect(img).toHaveAttribute("data-doc-src", "cat.png");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute("data-doc-src", "assets/image-1.png");

  // Stored the way a dropped image is: read, then saved into the image
  // folder, which gives the src relative to the document.
  const [picker] = await calls(page, "open_image_file_dialog");
  expect(picker.args).toMatchObject({ filterName: "Images" });
  expect((await calls(page, "read_binary_file_base64"))[0].args).toEqual({
    path: PICKED,
  });
  expect((await calls(page, "save_pasted_image"))[0].args).toMatchObject({
    docPath: DOC_PATH,
    ext: "png",
    folder: "assets",
  });
  expect(await sourceOf(page)).toBe(
    "Before\n\n![A sleeping cat](assets/image-1.png)",
  );
});

test("an embed whose file isn't in the vault gets the card, and keeps its syntax when replaced", async ({
  page,
}) => {
  const doc = await openDoc(
    page,
    "# Trip\n\n![[attachments/cat.png|Our cat|120]]\n\nThe end.\n",
    {
      vault: { "assets/image-1.png": "/home/me/notes/assets/image-1.png" },
      loadable: ["/home/me/notes/assets/image-1.png"],
    },
  );
  const card = doc.locator(".missing-image-card");
  await expect(card.locator(".missing-image-title")).toHaveText(
    "Image not found: cat.png",
  );
  await expect(card.locator(".missing-image-alt")).toHaveText("Our cat");
  await expect(card.locator(".missing-image-reason")).toHaveText(
    "There's no file by this name in the vault.",
  );
  await expect(card).toHaveAttribute(
    "title",
    "/home/me/notes/attachments/cat.png",
  );
  await expect(doc).not.toContainText("![[", { useInnerText: true });

  // A button press is the card's, not a click into the embed's source.
  await card.getByRole("button", { name: "Choose image…" }).click();
  await expect(doc.locator(".obsidian-embed-rendered img")).toBeVisible();
  // Copied into the image folder whatever the storage mode: an embed
  // names a file in the vault.
  expect((await calls(page, "save_pasted_image"))[0].args).toMatchObject({
    docPath: DOC_PATH,
    folder: "assets",
  });
  expect(await sourceOf(page)).toBe(
    "# Trip\n\n![[assets/image-1.png|Our cat|120]]\n\nThe end.",
  );
});

test.describe("on an iPhone", () => {
  test.use(PHONE);

  test("the card fits the screen and offers no picker or folder", async ({
    page,
  }) => {
    await page.route("http://asset.localhost/**", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await openPhone(page);
    await pasteMarkdown(
      page,
      "![A sleeping cat](/var/mobile/Photos/a-rather-long-file-name-for-a-phone.png)",
    );
    const card = page.locator(`${editor} .missing-image-card`);
    await expect(card.locator(".missing-image-title")).toHaveText(
      "Image not found: a-rather-long-file-name-for-a-phone.png",
    );
    await expect(card.getByRole("button")).toHaveCount(0);
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.viewport.width);
  });
});
