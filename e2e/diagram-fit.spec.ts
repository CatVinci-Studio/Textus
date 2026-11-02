import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// A diagram far wider than the column - a timeline of many periods - keeps a
// scale it can be read at and scrolls from its left edge; and diagrams are
// drawn while the text around them keeps changing, as a paper being written
// changes it several times a second.

const periods = Array.from(
  { length: 16 },
  (_, i) => `        Period ${i + 1} : What happened in period ${i + 1}`,
).join("\n");
const TIMELINE = `Before.\n\n\`\`\`mermaid\ntimeline\n    title A long history\n    section All of it\n${periods}\n\`\`\`\n\nAfter.`;
const FLOW =
  "Before.\n\n```mermaid\nflowchart LR\n  A[Start] --> B[Middle] --> C[Finish]\n```\n\nEnd.";
const preview = '[data-active-tab="true"] .ProseMirror .mermaid-preview';

test("a diagram wider than the column keeps a readable scale and scrolls", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, TIMELINE);
  await page.locator('[data-active-tab="true"] .ProseMirror p').last().click();
  const svg = page.locator(`${preview} > svg`);
  await expect(svg).toBeVisible();
  const fit = await svg.evaluate((el) => {
    const box = el.parentElement!;
    const drawn = el.getBoundingClientRect();
    return {
      scale: drawn.width / (el as SVGSVGElement).viewBox.baseVal.width,
      scrolls: box.scrollWidth > box.clientWidth,
      cutAtLeft: drawn.left < box.getBoundingClientRect().left,
    };
  });
  expect(fit.scale).toBeGreaterThanOrEqual(0.64);
  expect(fit.scrolls).toBe(true);
  expect(fit.cutAtLeft).toBe(false);
});

test("a diagram is drawn while the text after it keeps changing", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, FLOW);
  await page.locator('[data-active-tab="true"] .ProseMirror p').last().click();
  await page.keyboard.press("End");
  // A key every 200ms never leaves the editor the pause it used to wait for.
  const typing = (async () => {
    for (let i = 0; i < 25; i++) {
      await page.keyboard.type("x");
      await page.waitForTimeout(200);
    }
  })();
  await expect(page.locator(`${preview} > svg`)).toBeVisible({
    timeout: 4000,
  });
  await typing;
});
