import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// Ctrl/Cmd+click on a link to a local file that isn't Markdown asks first,
// then opens it in the system's app for it; cancelled, nothing opens.

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
    read_text_file: "See [the paper](<./papers/a b.pdf>).",
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
  await expect(page.locator(`${editor} a`)).toHaveCount(1);
});

test("Ctrl/Cmd+click on a local file asks, then opens it in its app", async ({
  page,
}) => {
  await page.locator(`${editor} a`).click({ modifiers: ["ControlOrMeta"] });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("a b.pdf");
  await dialog.getByRole("button", { name: "Open" }).click();
  await expect.poll(() => calls(page, "open_linked_file")).toHaveLength(1);
  expect(JSON.stringify(await calls(page, "open_linked_file"))).toContain(
    "/home/me/papers/a b.pdf",
  );
});

test("cancelled, the file isn't opened", async ({ page }) => {
  await page.locator(`${editor} a`).click({ modifiers: ["ControlOrMeta"] });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await page.waitForTimeout(200);
  expect(await calls(page, "open_linked_file")).toEqual([]);
});
