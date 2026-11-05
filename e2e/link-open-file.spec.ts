import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// Ctrl/Cmd+click on a link to a local file: what Textus opens itself (a
// Word file) opens in a tab; anything else asks first, then opens in the
// system's app for it; cancelled, nothing opens.

const editor = '[data-active-tab="true"] .ProseMirror';

const calls = (page: Page, cmd: string) =>
  page.evaluate(
    (cmd) =>
      (
        ((window as unknown as { __devInvokeCalls?: { cmd: string }[] })
          .__devInvokeCalls ?? []) as { cmd: string; args?: unknown }[]
      ).filter((c) => c.cmd === cmd),
    cmd,
  );

test.beforeEach(async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, {
    read_text_file:
      "See [the paper](<./papers/a b.zip>) and [the report](./Report.docx).",
    open_word_document: { markdown: "# Report\n\nQuarterly numbers." },
    file_mtime_ms: 1,
    open_linked_file: null,
  });
  await page.evaluate(() =>
    (
      window as unknown as {
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      }
    ).__devEmitTauriEvent("tauri://drag-drop", {
      paths: ["/home/me/index.md"],
      position: { x: 0, y: 0 },
    }),
  );
  await expect(page.locator(`${editor} a`)).toHaveCount(2);
});

test("Ctrl/Cmd+click on a local file asks, then opens it in its app", async ({
  page,
}) => {
  await page
    .locator(`${editor} a`, { hasText: "the paper" })
    .click({ modifiers: ["ControlOrMeta"] });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("a b.zip");
  await dialog.getByRole("button", { name: "Open" }).click();
  await expect.poll(() => calls(page, "open_linked_file")).toHaveLength(1);
  expect(JSON.stringify(await calls(page, "open_linked_file"))).toContain(
    "/home/me/papers/a b.zip",
  );
});

test("cancelled, the file isn't opened", async ({ page }) => {
  await page
    .locator(`${editor} a`, { hasText: "the paper" })
    .click({ modifiers: ["ControlOrMeta"] });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await page.waitForTimeout(200);
  expect(await calls(page, "open_linked_file")).toEqual([]);
});

test("Ctrl/Cmd+click on a Word file opens it in a tab, without asking", async ({
  page,
}) => {
  await page
    .locator(`${editor} a`, { hasText: "the report" })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".tab-pill-active .tab-pill-title")).toHaveText(
    /Report/,
  );
  await expect(page.locator(editor)).toContainText("Quarterly numbers.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await calls(page, "open_linked_file")).toEqual([]);
});
