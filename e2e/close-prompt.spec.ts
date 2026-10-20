import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// A window's close request - its own close button, Alt+F4, ⌘W, or the
// window manager's close (niri's close-window, a taskbar's Close) - reaches
// the page as tauri://close-requested (app/close-flow.ts). With unsaved
// changes the window stays open behind the unsaved-changes prompt, so that
// prompt must be the one thing in front: on a first launch it used to sit
// under the language welcome, and the close looked ignored.

function emit(page: Page, event: string, payload?: unknown) {
  return page.evaluate(
    ([name, value]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload: unknown) => void;
        }
      ).__devEmitTauriEvent(name as string, value),
    [event, payload] as const,
  );
}

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
  await emit(page, "menu-open-settings");
  await expect(page.locator(".settings-panel")).toBeVisible();
  await emit(page, "tauri://close-requested", null);
  await expect(page.locator(".close-prompt")).toBeVisible();
  expect(await onTop(page, ".close-prompt-primary")).toBe(true);
});
