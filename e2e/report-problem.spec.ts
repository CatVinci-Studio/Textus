import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// Help > Report a Problem: the user's words and what Textus fills in, sent
// to GitHub's bug form already filled, or copied.

test("a report opens GitHub's bug form filled with the words, the system and the version", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "zh" } });
  await page.evaluate(() =>
    Object.assign(window, {
      __devSystem: { os: "macOS 26.1", arch: "aarch64", webview: "622.1" },
    }),
  );
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-help-report"),
  );
  const dialog = page.getByRole("dialog", { name: "报告问题" });
  await expect(dialog.locator(".report-problem-details")).toContainText(
    "macOS 26.1 aarch64",
  );
  await expect(dialog.locator(".report-problem-details")).toContainText(
    "Plugins: none",
  );
  await dialog.getByRole("textbox").fill("拖文件进来没有反应");
  await dialog.getByRole("button", { name: "在 GitHub 提交" }).click();
  await expect(dialog).toHaveCount(0);
  // The dev shim keeps the links the app opens in the browser.
  const opened = await page.evaluate(
    () =>
      (window as unknown as { __devLinks: { url: string }[] }).__devLinks[0]
        .url,
  );
  const url = new URL(opened);
  expect(url.pathname).toBe("/CatVinci-Studio/Textus/issues/new");
  expect(url.searchParams.get("template")).toBe("2-bug-report-zh.yml");
  expect(url.searchParams.get("platform")).toBe("macOS");
  expect(url.searchParams.get("os-version")).toBe("macOS 26.1");
  expect(url.searchParams.get("description")).toContain("拖文件进来没有反应");
  expect(url.searchParams.get("description")).toContain("WebView 622.1");
});

test("Settings' Help group opens the report too, closing Settings", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-open-settings"),
  );
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Report a Problem…" }).click();
  await expect(settings).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Report a Problem" }),
  ).toBeVisible();
});
