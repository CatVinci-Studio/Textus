import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";
import { streamRevise } from "./revise-mock";

/**
 * A translation - every sentence different from its original - streaming
 * in: each paragraph lands in its own place once it is written whole. With
 * nothing in common, the stream's last run was taken as one change, and
 * landed a paragraph at a time it covered the title and every paragraph
 * after it, drawn inside the title in its type (1.2.1).
 */

const editor = '[data-active-tab="true"] .ProseMirror';

const ZH = [
  "# 无人签收",
  "月球邮局准备关门那天，林禾收到一封退信。",
  "信封是纸做的，边角起毛，邮票上印着早已拆除的地球发射塔。收件人一栏写着母亲的名字，寄件日期却是明天。",
  "她摸了摸笔迹。那个“禾”字最后一捺，总要拖得很长，是她自己的习惯。",
  "窗外，运货车正把邮局招牌装进车厢。最后一班返航船将在六小时后起飞。",
  "林禾拆开信，里面只有一句话：",
  "林禾申请过返乡。公司说，关站前不能缺人。",
  "她站了一会儿，拨通地球。",
];
const EN = [
  "# Unclaimed",
  "On the day the lunar post office was closing, Lin He received a returned letter.",
  "The envelope was paper, its corners frayed. The stamp showed an Earth launch tower long since torn down. The recipient line bore her mother's name, but the sending date was tomorrow.",
  "She touched the handwriting. The last stroke of the character for He always trailed long, a habit of her own.",
  "Outside the window, a freight truck was loading the post office sign. The last ship home would leave in six hours.",
  "Lin He opened the letter. There was only one line inside:",
  "Lin He had applied to go home. The company said no one could be spared before the station closed.",
  "She stood a while, then called Earth.",
];

test("a translation streaming in lands paragraph by paragraph, each in its own place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "final" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const doc = ZH.join("\n\n");
  await pasteMarkdown(page, doc);
  const args = { action: "replace", anchor: doc, text: EN.join("\n\n") };
  const json = JSON.stringify(args);
  // Held while the second-last paragraph is being written.
  const hold = Math.ceil((json.indexOf("Lin He had applied") + 10) / 6);
  await streamRevise(page, [{ id: "t1", args }], { hold });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Translate it into English");
  await composer.press("Enter");
  // The paragraphs written so far are a change each - the title one too -
  // not one change over all of them, drawn inside the title in its type.
  await expect(page.locator(".review-bar-pos")).toHaveText("6 changes", {
    timeout: 15_000,
  });
  await expect(page.locator(`${editor} h1`)).toHaveText(
    /^\s*无人签收\s*Unclaimed\s*$/,
  );
  const fresh = page.locator(`${editor} p .pending-sentence-new`);
  await expect(fresh).toHaveCount(5);
  await expect(fresh.first()).toHaveText(
    "On the day the lunar post office was closing, Lin He received a returned letter.",
  );
  // The paragraph being written is marked where it stands.
  await expect(page.locator(`${editor} .pending-reading`)).toHaveText(
    "林禾申请过返乡。公司说，关站前不能缺人。",
  );
});
