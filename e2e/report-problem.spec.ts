import { expect, test } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

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
  await dialog
    .getByRole("textbox", { name: "发生了什么" })
    .fill("拖文件进来没有反应");
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

test("a report is sent from the app, labelled by what it is, and says which issue it became", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await mockInvoke(page, {
    send_problem_report: {
      url: "https://github.com/CatVinci-Studio/Textus/issues/7",
      number: 7,
    },
  });
  await page.evaluate(() =>
    (
      window as unknown as { __devEmitTauriEvent: (n: string) => void }
    ).__devEmitTauriEvent("menu-help-report"),
  );
  const dialog = page.getByRole("dialog", { name: "Report a Problem" });
  const send = dialog.getByRole("button", { name: "Send", exact: true });
  // Nothing to send until something is written.
  await expect(send).toBeDisabled();
  await expect(dialog.getByRole("combobox", { name: "How bad" })).toBeVisible();
  await dialog.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "A suggestion" }).click();
  // A severity is a bug's only.
  await expect(dialog.getByRole("combobox", { name: "How bad" })).toHaveCount(
    0,
  );
  await dialog
    .getByRole("textbox", { name: "What happened" })
    .fill("Let tabs be pinned");
  await dialog.getByRole("textbox", { name: /Email or WeChat/ }).fill("me@x");
  await send.click();
  await expect(dialog).toContainText("Sent as #7");
  const sent = await page.evaluate(
    () =>
      (
        window as unknown as {
          __devInvokeCalls: { cmd: string; report?: Record<string, unknown> }[];
        }
      ).__devInvokeCalls.find((c) => c.cmd === "send_problem_report")!.report,
  );
  expect(sent).toMatchObject({
    kind: "idea",
    area: "editor",
    severity: null,
    description: "Let tabs be pinned",
    contact: "me@x",
  });
});
