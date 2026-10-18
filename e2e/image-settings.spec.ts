import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// Settings > Images (#147): where a pasted image goes, chosen in Settings
// and handed to the backend with the paste. The backend is the dev shim, so
// the commands answer with canned srcs; where the file lands and the link
// it gets are fs.rs's and image_host.rs's own tests.

// The English labels, as in src/i18n/locales/en.ts.
const t = {
  settingsTitle: "Settings",
  windowClose: "Close",
  navEditor: "Editor & Appearance",
  imageStorageLabel: "Save pasted images",
  imageStorageRemote: "Upload to an image host",
  imageFolderLabel: "Folder",
  imageFolderNextToDocument: "Next to the document",
  imageFolderDocumentName: "<document>.assets/",
  imageFolderCustom: "Custom folder",
  imageFolderInvalid:
    "Use a folder relative to the document, such as img or ../images.",
  imageHostLabel: "Service",
  imagePicgoEndpointLabel: "Server address",
  imageSmmsTokenLabel: "API token",
  imagePasteFailedMessage: "Couldn't save the pasted image.",
};

const editor = '[data-active-tab="true"] .ProseMirror';

// A 1x1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function openImageSettings(page: Page): Promise<Locator> {
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (name: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const panel = page.getByRole("dialog", { name: t.settingsTitle });
  await panel.getByRole("button", { name: t.navEditor }).click();
  return panel;
}

/** Pastes a screenshot, as WebKitGTK hands a bitmap to the page. */
async function pasteScreenshot(page: Page) {
  await page.locator(editor).click();
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    const target = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    const transfer = new DataTransfer();
    transfer.setData("text/html", `<img src="${url}">`);
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, PNG);
}

/** What the page asked of `cmd`, in order (the shim's record). */
function calls(page: Page, cmd: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (c) =>
      (
        (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
          .__devInvokeCalls ?? []
      ).filter((call) => call.cmd === c),
    cmd,
  );
}

/** A folder choice's radio: named by its label, then the example link. */
function radioName(label: string): RegExp {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

function imageSrcs(page: Page): Promise<string[]> {
  return page
    .locator(`${editor} .image-view img`)
    .evaluateAll((imgs) => imgs.map((img) => img.dataset.docSrc ?? ""));
}

test.beforeEach(async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator(editor).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
});

for (const { choice, folder, src } of [
  { choice: "assets/", folder: "assets", src: "assets/photo.png" },
  { choice: t.imageFolderNextToDocument, folder: "./", src: "photo.png" },
  {
    choice: t.imageFolderDocumentName,
    folder: "${filename}.assets",
    src: "notes.assets/photo.png",
  },
]) {
  test(`a paste goes to the folder chosen as ${choice}`, async ({ page }) => {
    const panel = await openImageSettings(page);
    const option = page.getByRole("radio", { name: radioName(choice) });
    await option.check();
    // Each choice shows the link it writes.
    await expect(
      panel.locator(".image-folder-option").filter({ has: option }),
    ).toContainText(`![](${src})`);
    await panel.getByRole("button", { name: t.windowClose }).click();

    await mockInvoke(page, { save_pasted_image: { src } });
    await pasteScreenshot(page);
    await expect.poll(() => imageSrcs(page)).toEqual([src]);
    const [call] = await calls(page, "save_pasted_image");
    expect(call.folder).toBe(folder);
  });
}

test("a custom folder shows its link as it is typed", async ({ page }) => {
  const panel = await openImageSettings(page);
  const radio = page.getByRole("radio", {
    name: radioName(t.imageFolderCustom),
  });
  await radio.check();
  const field = panel.getByRole("textbox", { name: t.imageFolderCustom });
  await field.fill("../images");
  const custom = panel.locator(".image-folder-option").filter({ has: radio });
  await expect(custom).toContainText("![](../images/photo.png)");

  // An absolute folder would write this computer's paths into the document.
  await field.fill("/tmp/images");
  await expect(panel.getByText(t.imageFolderInvalid)).toBeVisible();
  await field.fill("img");
  await expect(panel.getByText(t.imageFolderInvalid)).toHaveCount(0);
  await panel.getByRole("button", { name: t.windowClose }).click();

  await mockInvoke(page, { save_pasted_image: { src: "img/photo.png" } });
  await pasteScreenshot(page);
  await expect.poll(() => imageSrcs(page)).toEqual(["img/photo.png"]);
  expect((await calls(page, "save_pasted_image"))[0].folder).toBe("img");
});

test("an upload shows only the chosen service's settings and goes to it", async ({
  page,
}) => {
  const panel = await openImageSettings(page);
  const storage = panel.getByRole("combobox", { name: t.imageStorageLabel });
  // In view first: the list closes when the page scrolls under it.
  await storage.scrollIntoViewIfNeeded();
  await storage.click();
  await page.getByRole("option", { name: t.imageStorageRemote }).click();
  await expect(panel.getByText(t.imageFolderLabel)).toHaveCount(0);

  // PicGo first: its local server's address, filled in.
  const service = panel.getByRole("combobox", { name: t.imageHostLabel });
  await expect(service).toHaveText("PicGo / PicList");
  await expect(
    panel.getByRole("textbox", { name: t.imagePicgoEndpointLabel }),
  ).toHaveValue("http://127.0.0.1:36677/upload");

  await service.click();
  await page.getByRole("option", { name: "SM.MS" }).click();
  await expect(panel.getByText(t.imagePicgoEndpointLabel)).toHaveCount(0);
  await expect(
    panel.getByRole("textbox", { name: t.imageSmmsTokenLabel }),
  ).toBeVisible();
  await panel.getByRole("button", { name: t.windowClose }).click();

  const src = "https://s2.loli.net/photo.png";
  await mockInvoke(page, { upload_image: { src } });
  await pasteScreenshot(page);
  await expect.poll(() => imageSrcs(page)).toEqual([src]);
  const [call] = await calls(page, "upload_image");
  expect(call.host).toBe("smms");
});

test("a failed upload says why", async ({ page }) => {
  // Uploading to PicGo, the default host.
  await openApp(page, {
    settings: { language: "en", imageStorageMode: "image-host" },
  });
  await mockInvoke(page, {
    upload_image: {
      __reject: "PicGo isn't running, or its server is turned off",
    },
  });
  await pasteScreenshot(page);
  const dialog = page.locator(".app-dialog");
  await expect(dialog).toContainText(t.imagePasteFailedMessage);
  await expect(dialog).toContainText("PicGo isn't running");
});
