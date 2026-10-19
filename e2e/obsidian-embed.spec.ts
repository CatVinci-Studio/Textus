import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

/**
 * Obsidian image embeds (editor/images/obsidian-embed*.ts, issue #135): in
 * a saved document, `![[file]]` shows the picture the backend finds in the
 * vault, and the caret on it brings the source back to edit.
 */

const DOC = "# Trip\n\n![[attachments/cat.png|120]]\n\nThe end.\n";

// A 1x1 PNG, served for every asset URL.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function openVaultDoc(page: Page, resolved: string | null) {
  await page.route("http://asset.localhost/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL }),
  );
  await page.addInitScript(
    (r) => {
      (window as unknown as { __devInvokeResults: object }).__devInvokeResults =
        r;
    },
    {
      take_pending_open_path: "/vault/notes/trip.md",
      read_text_file: DOC,
      file_mtime_ms: 1_760_000_000_000,
      resolve_vault_image: resolved,
    },
  );
  await openApp(page, { settings: { language: "en" } });
  return page.locator('[data-active-tab="true"] .ProseMirror');
}

test("an image embed shows the vault's picture and its source under the caret", async ({
  page,
}) => {
  const file = "/vault/notes/attachments/cat.png";
  const editor = await openVaultDoc(page, file);
  const img = editor.locator(".obsidian-embed-rendered img");
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute(
    "src",
    `http://asset.localhost/${encodeURIComponent(file)}`,
  );
  // An HTML export writes it beside the document, as an ordinary image.
  await expect(img).toHaveAttribute("data-doc-src", "attachments/cat.png");
  await expect(img).toHaveCSS("width", "120px");
  await expect(editor).not.toContainText("![[", { useInnerText: true });

  // A click on the picture puts the caret in the source.
  await img.click();
  await expect(editor).toContainText("![[attachments/cat.png|120]]", {
    useInnerText: true,
  });
  await expect(img).toHaveCount(0);

  // Away again, the picture is back.
  await editor.getByText("The end.").click();
  await expect(editor.locator(".obsidian-embed-rendered img")).toBeVisible();
});

test("an embed whose file isn't in the vault shows its name", async ({
  page,
}) => {
  const editor = await openVaultDoc(page, null);
  // The missing image's card (missing-image.spec.ts has the rest).
  await expect(editor.locator(".missing-image-title")).toHaveText(
    "Image not found: cat.png",
  );
});
