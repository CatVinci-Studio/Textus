import { expect, test } from "@playwright/test";
import { MAC, openApp } from "./helpers";
import { openPath } from "./plugin-helpers";

// One editor per island, as VS Code keeps one per group: a tab out of
// sight lets its editor go, and comes back at its text with its undo.

test("only the tab in front has an editor; back again, its edit and its undo are there", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/w/a.md": "# A\n\nalpha line\n",
      "/w/b.md": "# B\n\nbeta line\n",
    };
  });
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  await openPath(page, "/w/a.md");
  await openPath(page, "/w/b.md");
  const front = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(front.locator("h1")).toContainText("B");
  const tab = (name: string) =>
    page.locator(".tab-pill").filter({ hasText: name });
  await tab("a.md").click();
  await front.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" EDITED");
  await tab("b.md").click();
  await expect(front.locator("h1")).toContainText("B");
  await expect(page.locator(".ProseMirror")).toHaveCount(1);
  await tab("a.md").click();
  await expect(front.locator("p").first()).toContainText("EDITED");
  await front.focus();
  await page.keyboard.press(MAC ? "Meta+z" : "Control+z");
  await expect(front.locator("p").first()).toHaveText("alpha line");
});

test("a formula's preview belongs to its document: under the formula, gone with its tab", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__devFs = {
      "/w/m.md":
        "# M\n\n$$\n\\begin{aligned}D_{KL}(q_\\phi(z|x)\\|p_\\theta(z|x))&=\\mathbb{E}_q[\\ln q_\\phi(z|x)-\\ln p_\\theta(x|z)-\\ln p(z)+\\ln p_\\theta(x)]\\end{aligned}\n$$\n\nafter\n",
      "/w/b.md": "# B\n\nbeta line\n",
    };
  });
  await page.setViewportSize({ width: 1200, height: 760 });
  await openApp(page, { settings: { menuBarShown: false } });
  await openPath(page, "/w/b.md");
  await openPath(page, "/w/m.md");
  const front = page.locator('[data-active-tab="true"] .ProseMirror');
  await front.locator(".math-block-rendered").click();
  const preview = page.locator(".math-float-preview:visible");
  await expect(preview).toHaveCount(1);
  // In the document, under its formula: not a popup of the window.
  const box = await preview.boundingBox();
  const formula = await front.locator(".math-block-revealed").boundingBox();
  expect(box!.y).toBeGreaterThan(formula!.y + formula!.height - 1);
  // A wide formula fits inside it, and it doesn't pop in: on Windows an
  // animated layer was left on screen after the tab changed.
  const fits = await preview.evaluate((el) => ({
    spill: el.scrollWidth - el.clientWidth,
    room: el.parentElement!.clientWidth - el.getBoundingClientRect().width,
    animation: getComputedStyle(el).animationName,
  }));
  expect(fits.animation).toBe("none");
  expect(fits.spill <= 1 || fits.room < 2).toBe(true);
  await page.locator(".tab-pill").filter({ hasText: "b.md" }).click();
  await expect(front.locator("h1")).toContainText("B");
  await expect(page.locator(".math-float-preview:visible")).toHaveCount(0);
});
