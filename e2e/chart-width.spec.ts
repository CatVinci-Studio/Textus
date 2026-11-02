import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// A chart is laid out for the column's width; when the column narrows or
// widens - a window resized, a panel opened - it is drawn again to fit.

const CHART = {
  type: "bar",
  title: "得票率",
  labels: ["中山", "大同", "萬華"],
  series: [
    { name: "2018年勝選者（柯文哲／丁守中）", data: [41.5, 45.3, 41.6] },
    { name: "2022年勝選者（蔣萬安／陳時中）", data: [42.6, 40.3, 40.1] },
  ],
};

test("a chart is drawn again for a column that narrows or widens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    "Intro.\n\n```chart\n" + JSON.stringify(CHART) + "\n```\n\nEnd.",
  );
  const svg = page.locator(".mermaid-preview svg").first();
  await expect(svg).toBeVisible();
  const wide = Number(await svg.getAttribute("width"));
  await page.setViewportSize({ width: 520, height: 900 });
  await expect
    .poll(async () => Number(await svg.getAttribute("width")))
    .toBeLessThan(wide - 50);
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect
    .poll(async () => Number(await svg.getAttribute("width")))
    .toBe(wide);
});
