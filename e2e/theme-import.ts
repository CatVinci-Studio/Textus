import { expect, type Page } from "@playwright/test";

// Importing a Typora theme through Settings, against an in-memory theme
// store: shared by the specs that check how imported themes apply.

/** Answers the theme commands from memory: the "file" Import CSS… picks,
 *  the theme store, the export dialog and the file it writes. `latency`
 *  slows every one of them, as the native file picker is. */
export async function installThemeBackend(
  page: Page,
  files: Record<string, string>,
  latency = 0,
) {
  await page.evaluate(
    ({ files, latency }) => {
      const w = window as unknown as Record<string, unknown> & {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
        };
      };
      const saved: Record<string, string> = {};
      const written: Record<string, string> = {};
      w.__themeStore = { saved, written };
      w.__themeLatency = latency;
      const original = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
        const delay = Number(w.__themeLatency) || 0;
        if (delay) await new Promise((r) => setTimeout(r, delay));
        switch (cmd) {
          case "open_css_file_dialog":
            return (w.__nextPick as string | undefined) ?? null;
          case "read_text_file":
            if (String(args.path) in files) return files[String(args.path)];
            if (String(args.path) in written) return written[String(args.path)];
            break;
          case "save_theme_css":
            saved[`${args.id}:${args.variant}`] = String(args.css);
            return null;
          case "load_theme_css":
            return saved[`${args.id}:${args.variant}`] ?? null;
          case "delete_theme":
            return null;
          case "export_save_dialog":
            return "/exports/textus-theme.css";
          case "write_text_file":
            written[String(args.path)] = String(args.contents);
            return null;
        }
        return original(cmd, args);
      };
    },
    { files, latency },
  );
}

export async function openSettings(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await dialog
    .locator(".settings-nav-item", { hasText: "Editor & Appearance" })
    .click();
  return dialog;
}

export async function importTheme(page: Page, path: string) {
  await page.evaluate((p) => {
    (window as unknown as { __nextPick: string }).__nextPick = p;
  }, path);
  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: "Get more themes" }).click();
  // Behind the Themes tab's "⋯".
  await dialog.getByRole("button", { name: "More", exact: true }).click();
  await dialog.getByRole("menuitem", { name: "Import CSS…" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-user-theme", "");
  await expect(page.locator("#textus-imported-chrome")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

/** The computed `prop` of the first match of each selector in the
 *  active editor (`::before` after a selector reads that pseudo). */
export async function computed(page: Page, selector: string, prop: string) {
  return page.evaluate(
    ([selector, prop]) => {
      const [base, pseudo] = selector.split("::");
      const el = document.querySelector(`[data-active-tab="true"] ${base}`);
      if (!el) return null;
      return getComputedStyle(el, pseudo ? `::${pseudo}` : null)
        .getPropertyValue(prop)
        .trim();
    },
    [selector, prop],
  );
}
