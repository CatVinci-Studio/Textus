import { expect, test } from "@playwright/test";
import { blockIds, openApp, pasteMarkdown } from "./helpers";
import { streamRevise } from "./revise-mock";

// The standard flow's translation, as the real window showed it (1.2.1):
// a story under its title rewritten whole. While it streamed in, Result
// only drew the new paragraphs in the title's type.

const editor = '[data-active-tab="true"] .ProseMirror';
const DOC =
  "# 十三秒\n\n父亲留给他的怀表总是慢十三秒。林迟换过游丝，也拆过表盘。\n\n父亲生前负责地月通信，七年前死在一次舱外检修中。\n\n塔内没有灯。他沿着扶手摸下去。";
const NEW =
  "The pocket watch his father had left him was always thirteen seconds slow. Lin Chi had replaced the hairspring and removed the dial.\n\nHis father had worked in Earth-Moon communications. Seven years earlier, he had died during a repair outside the station.\n\nThere was no light in the tower. He felt his way down the handrail.";

test("a rewrite under a title streams in in its paragraphs' type, not the title's", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    settings: { language: "en" },
    storage: { "textus-agent-panel-open": "1" },
    animations: true,
  });
  await pasteMarkdown(page, DOC);
  const ids = await blockIds(page, DOC);
  const paragraphSize = await page
    .locator(`${editor} p`)
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await page.evaluate(() => {
    const w = window as unknown as { __sizes: string[]; __on: boolean };
    w.__sizes = [];
    w.__on = true;
    const tick = () => {
      if (!w.__on) return;
      for (const el of document.querySelectorAll(
        '[data-active-tab="true"] .ProseMirror :is(.pending-insert, .pending-sentence-new)',
      )) {
        const text = el.textContent ?? "";
        if (!/pocket watch|Earth-Moon|no light/.test(text)) continue;
        w.__sizes.push(
          `${parseFloat(getComputedStyle(el).fontSize)}:${el.closest("h1") ? "h1" : "-"}:${text.slice(0, 24)}:${el.className}`,
        );
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await streamRevise(
    page,
    [
      {
        id: "t1",
        args: {
          action: "replace",
          block: ids[0],
          last_block: ids[3],
          text: NEW,
        },
      },
    ],
    { chunk: 12, every: 15 },
  );
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("翻译成英文");
  await composer.press("Enter");
  await expect(page.locator(".review-bar")).toBeVisible();
  await expect(page.locator(".agent-panel-view")).toContainText("Tightened.", {
    timeout: 20_000,
  });
  await page.waitForTimeout(500);
  const sizes = await page.evaluate(() => {
    const w = window as unknown as { __sizes: string[]; __on: boolean };
    w.__on = false;
    return [...new Set(w.__sizes)];
  });
  console.log("SIZES", paragraphSize, sizes);
  const wrong = sizes.filter(
    (s) => s.split(":")[1] === "h1" || parseFloat(s) > paragraphSize + 1,
  );
  expect(wrong).toEqual([]);
});
