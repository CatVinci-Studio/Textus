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
  imageFolderSubfolder: "Subfolder",
  imageFolderSameFolder: "Same folder as the document",
  imageFolderNameLabel: "Subfolder name",
  imageFolderInvalid: "Use a folder inside the document's folder, such as img.",
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

/** Picks `choice` in the Folder dropdown. */
async function chooseFolder(panel: Locator, choice: string) {
  const folder = panel.getByRole("combobox", { name: t.imageFolderLabel });
  // In view first: the list closes when the page scrolls under it.
  await folder.scrollIntoViewIfNeeded();
  await folder.click();
  await panel.page().getByRole("option", { name: choice }).click();
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
  { choice: t.imageFolderSubfolder, folder: "assets", src: "assets/photo.png" },
  { choice: t.imageFolderSameFolder, folder: "./", src: "photo.png" },
]) {
  test(`a paste goes to the folder chosen as ${choice}`, async ({ page }) => {
    const panel = await openImageSettings(page);
    await chooseFolder(panel, choice);
    // The row shows the link it writes.
    await expect(panel.locator(".image-folder-example")).toHaveText(
      `![](${src})`,
    );
    // Only a subfolder has a name to give.
    await expect(
      panel.getByRole("textbox", { name: t.imageFolderNameLabel }),
    ).toHaveCount(folder === "./" ? 0 : 1);
    await panel.getByRole("button", { name: t.windowClose }).click();

    await mockInvoke(page, { save_pasted_image: { src } });
    await pasteScreenshot(page);
    await expect.poll(() => imageSrcs(page)).toEqual([src]);
    const [call] = await calls(page, "save_pasted_image");
    expect(call.folder).toBe(folder);
  });
}

test("a subfolder's name shows its link as it is typed, and a refused one is never used", async ({
  page,
}) => {
  const panel = await openImageSettings(page);
  const field = panel.getByRole("textbox", { name: t.imageFolderNameLabel });
  await expect(field).toHaveValue("assets");
  await field.fill("img");
  await expect(panel.locator(".image-folder-example")).toHaveText(
    "![](img/photo.png)",
  );

  // Out of the document's folder, or an absolute folder that would write
  // this computer's paths into the document: refused.
  for (const refused of ["../images", "/tmp/images"]) {
    await field.fill(refused);
    await expect(panel.getByText(t.imageFolderInvalid)).toBeVisible();
    await expect(panel.locator(".image-folder-example")).toHaveCount(0);
  }
  await panel.getByRole("button", { name: t.windowClose }).click();

  // The last name the backend would take is the one used.
  await mockInvoke(page, { save_pasted_image: { src: "img/photo.png" } });
  await pasteScreenshot(page);
  await expect.poll(() => imageSrcs(page)).toEqual(["img/photo.png"]);
  expect((await calls(page, "save_pasted_image"))[0].folder).toBe("img");
});

// Which stored folder becomes which choice (Typora's ${filename}.assets,
// a folder outside the document's) is loadSettings's, unit-tested in
// settings/SettingsContext.test.ts; here, that Settings shows the result.
test("an image folder from before shows as the subfolder it names", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", imageFolder: "pictures" },
  });
  const panel = await openImageSettings(page);
  await expect(
    panel.getByRole("combobox", { name: t.imageFolderLabel }),
  ).toHaveText(t.imageFolderSubfolder);
  await expect(
    panel.getByRole("textbox", { name: t.imageFolderNameLabel }),
  ).toHaveValue("pictures");
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
