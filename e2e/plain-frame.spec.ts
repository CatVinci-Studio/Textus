import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

// Appearance › "Window background matches the page": the frame - the
// app shell, rail and sidebar - takes the document's background.

const frameAndPage = (page: Page) =>
  page.evaluate(() => {
    const shell = document.querySelector(".app-shell")!;
    const probe = document.createElement("div");
    probe.style.background = "var(--doc-bg)";
    document.body.append(probe);
    const paper = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { frame: getComputedStyle(shell).backgroundColor, paper };
  });

for (const scheme of ["light", "dark"] as const) {
  test(`the frame takes the page's colour when asked (${scheme})`, async ({
    page,
  }) => {
    await openApp(page, { colorScheme: scheme });
    const before = await frameAndPage(page);
    expect(before.frame).not.toBe(before.paper);

    await page.evaluate(() =>
      document.documentElement.setAttribute("data-plain-frame", ""),
    );
    const after = await frameAndPage(page);
    expect(after.frame).toBe(after.paper);
  });
}

test("the setting puts it on from the first frame", async ({ page }) => {
  await openApp(page, { settings: { plainFrame: true } });
  await expect(page.locator("html")).toHaveAttribute("data-plain-frame", "");
});
