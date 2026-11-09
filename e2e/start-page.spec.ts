import { expect, test, type Page } from "@playwright/test";
import { emit, openApp, settled } from "./helpers";

// The start page: shown, when the user chose it, at launch with nothing to
// open and when the last document closes; anything opened takes its place.

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

const startPage = (page: Page) => page.getByRole("region", { name: "Start" });

test("closing the last document shows the start page; a new document or an opened file takes its place", async ({
  page,
}) => {
  await openApp(page, {
    settings: {
      language: "en",
      newDocumentMode: "tab",
      closeLastToStartPage: true,
    },
  });
  await drop(page, "/notes/one.md", "# One");
  await expect(page.locator(".ProseMirror")).toContainText("One");
  await emit(page, "menu-close-tab");
  await expect(startPage(page)).toBeVisible();
  await expect(
    startPage(page).getByRole("button", { name: /New File/ }),
  ).toBeVisible();

  await startPage(page)
    .getByRole("button", { name: /New File/ })
    .click();
  await expect(startPage(page)).toHaveCount(0);
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toBeVisible();
  await expect(page.locator('[role="tab"]')).toHaveCount(0);
  // Closed again, a file opened from the start page opens in its place.
  await emit(page, "menu-close-tab");
  await expect(startPage(page)).toBeVisible();
  await drop(page, "/notes/two.md", "# Two");
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("Two");
  await expect(startPage(page)).toHaveCount(0);
  await expect(page.locator('[role="tab"]')).toHaveCount(0);
});

test("with the default, closing the last document doesn't show the start page", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", newDocumentMode: "tab" },
  });
  await drop(page, "/notes/one.md", "# One");
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, ...rest: unknown[]) => unknown;
      };
      __closed?: boolean;
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, ...rest) => {
      if (cmd.includes("destroy")) w.__closed = true;
      return invoke(cmd, ...rest);
    };
  });
  await emit(page, "menu-close-tab");
  // The close has run: the window was closed, not turned into a start page.
  await expect
    .poll(() =>
      page.evaluate(() => (window as { __closed?: boolean }).__closed),
    )
    .toBe(true);
  await expect(startPage(page)).toHaveCount(0);
});

test("zooming on the start page leaves the documents' zoom as it was", async ({
  page,
}) => {
  await openApp(page, {
    settings: {
      language: "en",
      newDocumentMode: "tab",
      closeLastToStartPage: true,
    },
  });
  await drop(page, "/notes/one.md", "# One");
  await emit(page, "menu-close-tab");
  await expect(startPage(page)).toBeVisible();
  const zoom = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--content-zoom")
        .trim(),
    );
  const before = await zoom();
  await emit(page, "menu-zoom-in");
  await emit(page, "menu-zoom-in");
  await settled(page);
  expect(await zoom()).toBe(before);
});

test("the start page lists recent files and opens one, and asks for a project", async ({
  page,
}) => {
  await openApp(page, {
    settings: {
      language: "en",
      newDocumentMode: "tab",
      closeLastToStartPage: true,
    },
  });
  await drop(page, "/notes/deep/one.md", "# One");
  await emit(page, "menu-close-tab");
  const recent = startPage(page).getByRole("region", { name: "Recent Files" });
  await expect(recent.getByRole("button", { name: /^one\.md/ })).toBeVisible();
  await expect(recent).toContainText("/notes/deep");

  const asked: string[] = [];
  await page.exposeFunction("__asked", (cmd: string) => asked.push(cmd));
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, ...rest: unknown[]) => unknown;
      };
      __asked: (cmd: string) => void;
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, ...rest) => {
      if (cmd.startsWith("pick_")) w.__asked(cmd);
      return invoke(cmd, ...rest);
    };
  });
  await startPage(page)
    .getByRole("button", { name: /Open Folder/ })
    .click();
  await expect.poll(() => asked.length).toBeGreaterThan(0);

  await recent.getByRole("button", { name: /^one\.md/ }).click();
  await expect(startPage(page)).toHaveCount(0);
  await expect(
    page.locator('[data-active-tab="true"] .ProseMirror'),
  ).toContainText("One");
});

test("a launch with nothing to restore opens on the start page, when chosen", async ({
  page,
}) => {
  await openApp(page, {
    settings: {
      language: "en",
      newDocumentMode: "tab",
      startPageOnLaunch: true,
      restoreSessionOnStartup: false,
    },
    ready: ".start-page",
  });
  await expect(startPage(page)).toBeVisible();
  await expect(page.locator(".ProseMirror")).toHaveCount(0);
});
