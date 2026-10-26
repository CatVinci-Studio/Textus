import { expect, test } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";
import { streamRevise } from "./revise-mock";

/**
 * A translation streaming in, with nothing in common with the original:
 * each paragraph lands in its own place, not as one change over the title.
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

const ZH_TALK = [
  "雨声从收音机里传来。林遥屏住了呼吸。",
  "“你那里为什么不下雨？”孩子问。",
  "“我住得有点远。”",
  "又过了很久，收音机里传来钥匙碰门的声音。孩子喊了声妈妈，跑远了。雨渐渐停下，那滴水落在铜环底部，再没浮起来。",
  "林遥错过了飞船。",
];
const EN_TALK = [
  "The sound of rain came through the radio. Lin Yao held her breath.",
  "“Why isn't it raining where you are?” the child asked.",
  "“I live a little far away.”",
  "Much later, she heard keys against a door through the radio. The child called out “Mom!” and ran off. The rain slowly stopped. The droplet fell to the bottom of the copper ring and never rose again.",
  "Lin Yao had missed the ship.",
];

test("short lines landed together stand as the paragraphs they will be, and the one being written is marked", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "final" },
    storage: { "textus-agent-panel-open": "1" },
  });
  const doc = ZH_TALK.join("\n\n");
  await pasteMarkdown(page, doc);
  const args = { action: "replace", anchor: doc, text: EN_TALK.join("\n\n") };
  const json = JSON.stringify(args);
  const hold = Math.ceil((json.indexOf("The child called") + 10) / 6);
  await streamRevise(page, [{ id: "t2", args }], { hold });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Translate it into English");
  await composer.press("Enter");
  await expect(
    page.locator(`${editor} .pending-sentence-new`, {
      hasText: "I live a little far away.",
    }),
  ).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  // The two short lines stand as two paragraphs do, a paragraph apart -
  // not with a blank line between them in one run of text.
  const tops = await page.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const top = (needle: string) => {
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const at = n.textContent?.indexOf(needle) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + needle.length);
        return range.getBoundingClientRect().top;
      }
      return NaN;
    };
    return [top("Why isn't it raining"), top("I live a little")];
  }, editor);
  const paragraph = await page
    .locator(`${editor} p`)
    .last()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return parseFloat(s.lineHeight) + parseFloat(s.marginBottom);
    });
  console.log("TOPS", tops.join(","), "PARAGRAPH", paragraph);
  expect(tops[1] - tops[0]).toBeLessThan(paragraph + 4);
  // The paragraph being written is marked, where it shows.
  const reading = page.locator(`${editor} .pending-reading`);
  await expect(reading).toContainText("又过了很久");
  expect((await reading.boundingBox())!.height).toBeGreaterThan(10);
});

const LONG_ZH =
  "她在控制台前坐了很久。窗外的月面一片灰白。远处的天线还在转。耳机里只有电流声。她想起父亲的手。那双手修过无数台收音机。她把旧照片放回抽屉。屏幕上的时间跳到零点。她深吸一口气。然后按下了发送键。";
const LONG_EN =
  "She sat at the console for a long time. Outside, the lunar surface was a pale grey. The distant antenna was still turning. There was only static in her earphones. She thought of her father's hands. Those hands had mended countless radios. She put the old photograph back in the drawer. The clock on the screen jumped to midnight. She took a deep breath. Then she pressed send.";

test("a long paragraph lands in batches of whole sentences while it is still written", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page, {
    settings: { language: "en", revisionDisplay: "final" },
    storage: { "textus-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, LONG_ZH);
  // Slow enough that the paragraph is held past HOLD_MS.
  await streamRevise(
    page,
    [{ id: "b1", args: { action: "replace", anchor: LONG_ZH, text: LONG_EN } }],
    { chunk: 4, every: 90 },
  );
  await page.evaluate(() => {
    const w = window as unknown as { __n: number[]; __on: boolean };
    w.__n = [];
    w.__on = true;
    const tick = () => {
      if (!w.__on) return;
      w.__n.push(
        document.querySelector(".review-bar-working")
          ? [...document.querySelectorAll(".milkdown .pending-sentence-new")]
              .map((el) => el.textContent ?? "")
              .join(" ")
              .split(/[.!?](?:\s|$)/)
              .filter((s) => s.trim()).length
          : -1,
      );
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Translate it into English");
  await composer.press("Enter");
  await expect(page.locator(".review-bar-accept")).toBeEnabled({
    timeout: 40_000,
  });
  const counts = await page.evaluate(() => {
    const w = window as unknown as { __n: number[]; __on: boolean };
    w.__on = false;
    return w.__n;
  });
  const writing = counts.filter((n) => n >= 0);
  const steps = [...new Set(writing)];
  console.log("BATCHES", steps.join(" "));
  // Some of it landed while the rest was still being written...
  expect(Math.max(...writing)).toBeGreaterThan(0);
  // ...several sentences at a time, not one by one, and not all of it.
  const jumps = steps.slice(1).map((n, i) => n - steps[i]);
  expect(Math.max(...jumps)).toBeGreaterThan(1);
  expect(writing.some((n) => n > 1 && n < 10)).toBe(true);
  // Never half a sentence on screen.
  await expect(page.locator(".milkdown .pending-partial")).toHaveCount(0);
});
