import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// Settings › General › Background against a canned background_status
// standing in for src-tauri/src/background/. The page's user agent is
// Windows Chrome's (playwright.config.ts), so the explanation behind the
// switch's "?" is Windows's.

// English labels, as in src/i18n/locales/en.ts.
const t = {
  group: "Background",
  toggle: "Keep running in the background",
  login: "Start in the background at login",
  more: "More about Keep running in the background",
  windowsHint:
    "Closing the last window leaves Textus running, with an icon in the notification area: click it for a quick note. To close Textus completely, choose Quit in the icon’s menu.",
  trayUnavailable:
    "This desktop has no tray: libayatana-appindicator isn’t installed. Textus still keeps running; open it from your launcher or with the Quick Note shortcut.",
};

async function openSettings(
  page: Page,
  settings: Record<string, unknown> = {},
) {
  await openApp(page, { settings: { language: "en", ...settings } });
  await mockInvoke(page, {
    quick_note_folder: { path: "/home/me/Documents/Textus/Quick Notes" },
    quick_note_cli_command: "/usr/bin/textus --quick-note",
    quick_note_shortcut_status: {
      state: "off",
      accelerator: "Super+Alt+N",
      reason: null,
    },
    background_status: { tray: "off", login: "off", loginError: null },
  });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const group = page
    .locator(".settings-group")
    .filter({ has: page.getByRole("heading", { name: t.group }) });
  await expect(group).toBeVisible();
  return group;
}

const stored = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}"),
  );

const emitStatus = (page: Page, status: unknown) =>
  page.evaluate(
    (s) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (n: string, p: unknown) => void;
        }
      ).__devEmitTauriEvent("background-status", s),
    status,
  );

test.describe("Settings › General › Background", () => {
  test("is off by default, and the login switch appears only once it is on", async ({
    page,
  }) => {
    const group = await openSettings(page);
    const toggle = group.getByLabel(t.toggle, { exact: true });
    await expect(toggle).not.toBeChecked();
    await expect(group.getByText(t.windowsHint)).toBeHidden();
    await expect(
      group.getByRole("button", { name: t.more }),
    ).toHaveAccessibleDescription(t.windowsHint);
    await expect(group.getByLabel(t.login)).toHaveCount(0);

    await toggle.check();
    expect((await stored(page)).runInBackground).toBe(true);
    const login = group.getByLabel(t.login);
    await expect(login).not.toBeChecked();
    await login.check();
    expect((await stored(page)).openAtLogin).toBe(true);

    // Off again: the login switch goes with it, and keeps its choice for
    // the next time.
    await toggle.uncheck();
    expect((await stored(page)).runInBackground).toBe(false);
    await expect(group.getByLabel(t.login)).toHaveCount(0);
    expect((await stored(page)).openAtLogin).toBe(true);
  });

  test("says when the desktop has no tray to show the icon in", async ({
    page,
  }) => {
    const group = await openSettings(page, { runInBackground: true });
    await expect(group.locator('[data-tray="unavailable"]')).toHaveCount(0);
    await emitStatus(page, {
      tray: "unavailable",
      login: "off",
      loginError: null,
    });
    await expect(group.locator('[data-tray="unavailable"]')).toHaveText(
      t.trayUnavailable,
    );
    await emitStatus(page, { tray: "on", login: "off", loginError: null });
    await expect(group.locator('[data-tray="unavailable"]')).toHaveCount(0);
  });

  test("shows why the login entry couldn't be written", async ({ page }) => {
    const group = await openSettings(page, {
      runInBackground: true,
      openAtLogin: true,
    });
    await emitStatus(page, {
      tray: "on",
      login: "failed",
      loginError: "Access is denied.",
    });
    await expect(group.getByRole("alert")).toHaveText(
      "Couldn’t change the login item: Access is denied.",
    );
  });
});
