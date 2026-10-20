import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// A Word document opened in Textus becomes a new, unsaved Markdown
// document (document/word-import.ts). The conversion is the backend's
// (commands/word_import.rs, tested there), so it is canned here; what is
// checked is the flow around it: which commands run, the tab it makes, the
// notice, and where Save suggests writing.

const editor = '[data-active-tab="true"] .ProseMirror';

const MARKDOWN = "# Report\n\nPrice: \\$5 \\*each\\*\n\n1. First\n2. Second";

function emit(page: Page, name: string, payload?: unknown) {
  return page.evaluate(
    ([n, p]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent(n as string, p),
    [name, payload],
  );
}

type Call = { cmd: string; [arg: string]: unknown };
function calls(page: Page, cmd: string): Promise<Call[]> {
  return page.evaluate(
    (c) =>
      (
        (window as unknown as { __devInvokeCalls?: Call[] }).__devInvokeCalls ??
        []
      ).filter((call) => call.cmd === c),
    cmd,
  );
}

async function open(page: Page, newDocumentMode: "window" | "tab") {
  await openApp(page, { settings: { language: "en", newDocumentMode } });
  await mockInvoke(page, {
    open_file_dialog: "/home/me/Reports/Report.docx",
    open_word_document: { markdown: MARKDOWN },
    read_text_file: "never read",
    write_text_file: null,
    save_file_dialog: null,
  });
}

test("File > Open of a Word document opens a new Markdown document", async ({
  page,
}) => {
  await open(page, "window");
  await emit(page, "menu-open-file");
  await expect(page.locator(`${editor} h1`)).toContainText("Report");
  await expect(page.locator(editor)).toContainText("Price: $5 *each*");
  await expect(page.locator(`${editor} ol li`)).toHaveCount(2);
  // In place of the empty Untitled the window started with, named after
  // the Word file.
  await expect(page.locator(".window-bar-title-text")).toHaveText("Report");
  await expect(page.getByRole("status")).toContainText(
    "Opened Report.docx as a new Markdown document",
  );

  expect(await calls(page, "open_word_document")).toEqual([
    { cmd: "open_word_document", path: "/home/me/Reports/Report.docx" },
  ]);
  // The .docx is converted, never read as text or written.
  expect(await calls(page, "read_text_file")).toEqual([]);

  // Save asks where, starting with a .md beside the Word file.
  await emit(page, "menu-save-file");
  await expect
    .poll(() => calls(page, "save_file_dialog"))
    .toEqual([
      {
        cmd: "save_file_dialog",
        defaultName: "Report.md",
        defaultDir: "/home/me/Reports",
      },
    ]);
  expect(await calls(page, "write_text_file")).toEqual([]);
});

test("opening the same Word document again shows the tab it opened", async ({
  page,
}) => {
  await open(page, "tab");
  await emit(page, "menu-open-file");
  await expect(page.locator(".tab-pill-active .tab-pill-title")).toHaveText(
    "Report",
  );
  await page.locator(".tab-pill").first().click();
  await emit(page, "menu-open-file");
  await expect(page.locator(".tab-pill-active .tab-pill-title")).toHaveText(
    "Report",
  );
  await expect(page.locator(".tab-pill")).toHaveCount(2);
  expect(await calls(page, "open_word_document")).toHaveLength(1);
});

test("a Word document dropped on the window opens the same way", async ({
  page,
}) => {
  await open(page, "window");
  await emit(page, "tauri://drag-drop", {
    paths: ["C:\\Users\\me\\Notes.docx"],
    position: { x: 0, y: 0 },
  });
  await expect(page.locator(`${editor} h1`)).toContainText("Report");
  expect(await calls(page, "open_word_document")).toEqual([
    { cmd: "open_word_document", path: "C:\\Users\\me\\Notes.docx" },
  ]);
});

test("a Word document that can't be converted says why", async ({ page }) => {
  await open(page, "window");
  await mockInvoke(page, {
    open_file_dialog: "/home/me/Broken.docx",
    open_word_document: { __reject: "This .docx is not a readable Word file." },
  });
  await emit(page, "menu-open-file");
  await expect(page.getByText("Broken.docx couldn't be opened.")).toBeVisible();
  await expect(
    page.getByText("This .docx is not a readable Word file."),
  ).toBeVisible();
});
