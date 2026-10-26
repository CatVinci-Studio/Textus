import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

// Settings › General's background switch against a canned background_status.

// English labels.
const t = {
  group: "Application",
  toggle: "Keep running in the background",
  trayUnavailable:
    "This desktop has no tray: libayatana-appindicator isn’t installed. Textus still keeps running; open it again from your launcher.",
};

async function openSettings(
  page: Page,
  settings: Record<string, unknown> = {},
) {
  await openApp(page, { settings: { language: "en", ...settings } });
  await mockInvoke(page, { background_status: { tray: "off" } });
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

test.describe("Keep running in the background", () => {
  test("is one switch in the Application group, off by default", async ({
    page,
  }) => {
    const group = await openSettings(page);
    const toggle = group.getByLabel(t.toggle, { exact: true });
    await expect(toggle).not.toBeChecked();
    // The label says it all: no "?" beside it, and nothing else to set.
    await expect(
      group.getByRole("button", { name: /^More about/ }),
    ).toHaveCount(0);
    await expect(group.getByRole("checkbox")).toHaveCount(1);

    await toggle.check();
    expect((await stored(page)).runInBackground).toBe(true);
    await toggle.uncheck();
    expect((await stored(page)).runInBackground).toBe(false);
  });

  test("says when the desktop has no tray to show the icon in", async ({
    page,
  }) => {
    const group = await openSettings(page, { runInBackground: true });
    await expect(group.locator('[data-tray="unavailable"]')).toHaveCount(0);
    await emitStatus(page, { tray: "unavailable" });
    await expect(group.locator('[data-tray="unavailable"]')).toHaveText(
      t.trayUnavailable,
    );
    await emitStatus(page, { tray: "on" });
    await expect(group.locator('[data-tray="unavailable"]')).toHaveCount(0);
  });
});
