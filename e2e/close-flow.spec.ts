import { expect, test, type Page } from "@playwright/test";
import { emit, mockInvoke, openApp, pasteMarkdown, settled } from "./helpers";

// Closing: a tab or the window with unsaved changes asks first, Keep
// unsaved changes closes without asking, closed tabs come back, and the
// tab menu's closes leave a changed tab open.

/** Whether the element is the one drawn at its own centre, not covered. */
function onTop(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return !!hit && el.contains(hit);
  }, selector);
}

test("closing a window with unsaved changes on the first launch shows the prompt over the language welcome", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en", languageChosen: false } });
  await expect(page.locator(".language-welcome")).toBeVisible();
  await pasteMarkdown(page, "unsaved words");
  await emit(page, "tauri://close-requested", null);

  const prompt = page.getByRole("dialog", {
    name: "This document has unsaved changes.",
  });
  await expect(prompt).toBeVisible();
  expect(await onTop(page, ".close-prompt-primary")).toBe(true);
  await expect(prompt.locator(".close-prompt-primary")).toBeFocused();

  // Cancel keeps the window, and the welcome is still there to finish.
  await prompt.getByRole("button", { name: "Cancel" }).click();
  await expect(prompt).toHaveCount(0);
  expect(await onTop(page, ".language-welcome-continue")).toBe(true);
});

test("the unsaved-changes prompt stays in front of Settings", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "unsaved words");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", level: 2 }),
  ).toBeVisible();
  await emit(page, "tauri://close-requested", null);
  await expect(page.locator(".close-prompt")).toBeVisible();
  expect(await onTop(page, ".close-prompt-primary")).toBe(true);
});

test("File › Close Window in the app-drawn menu closes this window (#345)", async ({
  page,
}) => {
  // Windows: the app draws its own menu bar there.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    Object.defineProperty(navigator, "userAgent", {
      get: () => "Mozilla/5.0 (Win32) AppleWebKit/537.36 Chrome/157.0",
    });
  });
  await openApp(page, { settings: { language: "en", menuBarShown: true } });
  await mockInvoke(page, {
    "plugin:window|close": null,
    trigger_menu_item: null,
  });
  await page.getByRole("menuitem", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Close Window" }).click();
  const asked = await page.evaluate(() =>
    (
      (window as unknown as { __devInvokeCalls?: { cmd: string }[] })
        .__devInvokeCalls ?? []
    ).map((c) => c.cmd),
  );
  // This window closes itself, as its close button does - not through the
  // backend, which may find no window focused (Windows, Linux).
  expect(asked).toContain("plugin:window|close");
  expect(asked).not.toContain("trigger_menu_item");
});

test("with Keep unsaved changes on, closing keeps them as a draft and asks nothing", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", keepUnsavedOnClose: true },
  });
  await pasteMarkdown(page, "kept words");
  await mockInvoke(page, { save_draft_snapshot: null });
  await emit(page, "tauri://close-requested", null);

  const saved = () =>
    page.evaluate(() =>
      (
        (
          window as unknown as {
            __devInvokeCalls?: { cmd: string; content?: string }[];
          }
        ).__devInvokeCalls ?? []
      )
        .filter((c) => c.cmd === "save_draft_snapshot")
        .map((c) => c.content ?? ""),
    );
  await expect.poll(saved).toEqual([expect.stringContaining("kept words")]);
  await expect(page.locator(".close-prompt")).toHaveCount(0);
});

const titles = '[role="tab"] .tab-pill-title';

async function openFiles(page: Page, names: string[]) {
  for (const name of names) {
    await page.evaluate((path) => {
      const w = window as unknown as Record<string, unknown> & {
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      };
      w.__devFiles = {
        ...(w.__devFiles as Record<string, string> | undefined),
        [path]: `# ${path}`,
      };
      w.__devEmitTauriEvent("tauri://drag-drop", {
        paths: [path],
        position: { x: 0, y: 0 },
      });
    }, `/notes/${name}`);
    await expect(
      page.locator('[data-active-tab="true"] .ProseMirror'),
    ).toContainText(`/notes/${name}`);
  }
}

const tab = (page: Page, name: string) =>
  page.locator('[role="tab"]', { hasText: name });

async function fromMenu(page: Page, name: string, item: string) {
  await tab(page, name).click({ button: "right" });
  await page
    .locator(".context-menu-item")
    .getByText(item, { exact: true })
    .click();
}

test("a middle click closes a tab, and the tab menu closes those to its right, left, or all others", async ({
  page,
}) => {
  await openApp(page, {
    // No ghost text: the dev shim's suggestion turned up after the caret
    // between the two reads on a slow runner, and read as a paste.
    settings: {
      language: "en",
      newDocumentMode: "tab",
      enableCompletion: false,
    },
  });
  await openFiles(page, ["a.md", "b.md", "c.md", "d.md", "e.md"]);
  // Text selected in a field, then the caret at e.md's end: Linux pastes
  // the last selection where the caret is on a middle click anywhere.
  await page.evaluate(() => {
    const field = document.body.appendChild(document.createElement("textarea"));
    field.id = "seed";
    field.value = "seeded";
  });
  await page.locator("#seed").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.locator("#seed").evaluate((field) => field.remove());
  const front = page.locator('[data-active-tab="true"] .ProseMirror');
  await front.click();
  await page.keyboard.press("ControlOrMeta+End");
  await settled(page);
  const was = await front.innerText();
  await tab(page, "d.md").click({ button: "middle" });
  // The window's untouched first tab gave way to a.md.
  await expect(page.locator(titles)).toHaveText([
    "a.md",
    "b.md",
    "c.md",
    "e.md",
  ]);
  // It closed d.md and pasted nothing into e.md.
  await settled(page);
  expect(await front.innerText()).toBe(was);
  await fromMenu(page, "c.md", "Close Tabs to the Right");
  await expect(page.locator(titles)).toHaveText(["a.md", "b.md", "c.md"]);
  await fromMenu(page, "b.md", "Close Tabs to the Left");
  await expect(page.locator(titles)).toHaveText(["b.md", "c.md"]);
  await fromMenu(page, "c.md", "Close Others");
  await expect(page.locator(titles)).toHaveText(["c.md"]);
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("/notes/c.md");
});

test("a pinned tab goes first, shows no ×, and stays through ⌘W, a middle click and Close Others", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", newDocumentMode: "tab" },
  });
  await openFiles(page, ["a.md", "b.md", "c.md"]);
  await fromMenu(page, "c.md", "Pin Tab");
  await expect(page.locator(titles)).toHaveText(["c.md", "a.md", "b.md"]);
  await expect(tab(page, "c.md").locator(".tab-pill-close")).toHaveCount(0);
  await expect(tab(page, "c.md").locator(".tab-pill-pin")).toHaveCount(1);
  // ⌘W in front of it, and a middle click: still there.
  await tab(page, "c.md").locator(".tab-pill-title").click();
  await emit(page, "menu-close-tab");
  await page.keyboard.press("ControlOrMeta+w");
  await tab(page, "c.md").click({ button: "middle" });
  // Its own menu offers no Close Tab while it is pinned.
  await tab(page, "c.md").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Close Tab", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator(titles)).toHaveText(["c.md", "a.md", "b.md"]);
  await fromMenu(page, "a.md", "Close Others");
  await expect(page.locator(titles)).toHaveText(["c.md", "a.md"]);
  await fromMenu(page, "c.md", "Unpin Tab");
  await expect(tab(page, "c.md").locator(".tab-pill-close")).toHaveCount(1);
  await fromMenu(page, "a.md", "Close Others");
  await expect(page.locator(titles)).toHaveText(["a.md"]);
});

test("Close Others leaves a tab with unsaved changes open", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", newDocumentMode: "tab", autosave: false },
  });
  await openFiles(page, ["a.md", "b.md", "c.md"]);
  // On the title: a narrow pill's centre can be its close button.
  await tab(page, "a.md").locator(".tab-pill-title").click();
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  await page.keyboard.type("changed", { delay: 20 });
  await expect(tab(page, "a.md").locator(".tab-pill-dirty-dot")).toHaveCount(1);
  await fromMenu(page, "c.md", "Close Others");
  await expect(page.locator(titles)).toHaveText(["a.md", "c.md"]);
});

const tabs = '.tab-bar [role="tab"]';

function drop(page: Page, path: string, text: string) {
  return page.evaluate(
    ({ path, text }) => {
      const w = window as unknown as Record<string, unknown> & {
        __devEmitTauriEvent: (name: string, payload: unknown) => void;
      };
      w.__devFiles = {
        ...(w.__devFiles as Record<string, string> | undefined),
        [path]: text,
      };
      w.__devEmitTauriEvent("tauri://drag-drop", {
        paths: [path],
        position: { x: 0, y: 0 },
      });
    },
    { path, text },
  );
}

test("closed tabs reopen, the latest first", async ({ page }) => {
  await openApp(page, {
    settings: { language: "en", newDocumentMode: "tab" },
  });
  await drop(page, "/notes/one.md", "# One");
  await drop(page, "/notes/two.md", "# Two");
  await drop(page, "/notes/three.md", "# Three");
  // The first in place of the blank document the window opened with.
  await expect(page.locator(tabs)).toHaveCount(3);
  await emit(page, "menu-close-tab");
  await page.locator(tabs, { hasText: "one.md" }).click();
  await emit(page, "menu-close-tab");
  await expect(page.locator(tabs)).toHaveCount(1);

  await emit(page, "menu-reopen-closed-tab");
  await expect(page.locator(tabs)).toHaveCount(2);
  await expect(page.locator(`${tabs}[aria-selected="true"]`)).toContainText(
    "one.md",
  );
  await emit(page, "menu-reopen-closed-tab");
  await expect(page.locator(`${tabs}[aria-selected="true"]`)).toContainText(
    "three.md",
  );
  // Nothing left closed: nothing happens.
  await emit(page, "menu-reopen-closed-tab");
  await expect(page.locator(tabs)).toHaveCount(3);
});

test("closing a tab with unsaved changes asks; Cancel keeps it, Don't Save drops them, Save writes them", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", newDocumentMode: "tab", autosave: false },
  });
  await openFiles(page, ["a.md", "b.md", "c.md"]);
  const disk = (path: string) =>
    page.evaluate(
      (p) =>
        (window as unknown as { __devFiles: Record<string, string> })
          .__devFiles[p],
      path,
    );
  const prompt = page.getByRole("dialog", { name: /unsaved changes/ });
  const edit = async (name: string, words: string) => {
    await tab(page, name).locator(".tab-pill-title").click();
    await page.locator('[data-active-tab="true"] .ProseMirror').click();
    await page.keyboard.press("End");
    await page.keyboard.type(words);
    await expect(tab(page, name).locator(".tab-pill-dirty-dot")).toHaveCount(1);
  };

  await edit("a.md", " cancelled");
  await emit(page, "menu-close-tab");
  await prompt.getByRole("button", { name: "Cancel" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(tab(page, "a.md")).toHaveCount(1);

  await emit(page, "menu-close-tab");
  await prompt.getByRole("button", { name: "Don't Save" }).click();
  await expect(tab(page, "a.md")).toHaveCount(0);
  expect(await disk("/notes/a.md")).toBe("# /notes/a.md");

  await edit("b.md", " saved");
  await emit(page, "menu-close-tab");
  await prompt.getByRole("button", { name: "Save", exact: true }).click();
  await expect(tab(page, "b.md")).toHaveCount(0);
  await expect.poll(() => disk("/notes/b.md")).toContain("saved");
});
