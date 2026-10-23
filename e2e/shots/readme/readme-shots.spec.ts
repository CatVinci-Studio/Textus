/**
 * The README screenshots, one set per README language, in that language's
 * UI with a document written in it. Not a test - nothing is compared; run
 * `npm run screenshots:readme` after a visible UI change and commit the
 * images in docs/images/readme/.
 */
import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "../../helpers";

interface Sample {
  doc: string;
  continuation: string;
  ask: string;
  anchor: string;
  edited: string;
  reason: string;
  commentAnchor: string;
  comment: string;
  reply: string;
}

const SAMPLES: Record<"en" | "zh" | "ja", Sample> = {
  en: {
    doc: `# Old Streets, New Plans

## Why we asked

Cities are always changing. When the town announced a plan to rebuild the old quarter, we wanted to hear first from the people who would have to live beside the works for years.

## How we asked

The study went on over the course of two months and took place in three different neighbourhoods. We sat down one-on-one with residents, for about an hour each. In the end we spoke to forty-six residents in total, and the conversations ended up covering a great many different topics.

| Neighbourhood | Households | Interviewed |
|---|---|---|
| East Gate | 312 | 18 |
| Salt Lane | 205 | 15 |
| Old Pier | 168 | 13 |

## What we heard

> "Nobody minds new pipes. What scares us is not knowing where we'll sleep while they're laid."

Almost no one opposed renewal itself. The worries were practical: **temporary housing**, rents afterwards, and whether the neighbours would come back.

## What we recommend

- Ask residents before the plans are drawn
- Publish where people will live during the works
`,
    continuation: " Most of them, it turned out, had never been asked.",
    ask: "Make the method paragraph more concise",
    anchor:
      "The study went on over the course of two months and took place in three different neighbourhoods. We sat down one-on-one with residents, for about an hour each. In the end we spoke to forty-six residents in total, and the conversations ended up covering a great many different topics.",
    edited:
      "The study ran for two months in three neighbourhoods. We sat down one-on-one with residents, for about an hour each. We spoke to forty-six residents.",
    reason:
      "Merged when and where into one sentence and cut the filler at the end; the numbers stay.",
    commentAnchor: "Cities are always changing.",
    comment:
      "A very general opening - the second sentence is where the piece really starts.",
    reply:
      "Tightened the method paragraph and left one comment on the opening.",
  },
  zh: {
    doc: `# 老街与新规划

## 我们为什么去问

城市总在变化。听说老城区要整体改造，我们想先听听那些要在工地旁生活好几年的居民怎么说。

## 我们怎么问

这项调查前后一共持续了两个月的时间，地点分布在三个不同的街区。我们和居民一对一坐下来聊，每人大约一个小时。最终一共访谈了四十六位居民，聊到的话题涉及方方面面。

| 街区 | 户数 | 受访人数 |
|---|---|---|
| 东门 | 312 | 18 |
| 盐巷 | 205 | 15 |
| 老码头 | 168 | 13 |

## 我们听到了什么

> “换水管谁都没意见，怕的是不知道施工那几个月住哪儿。”

几乎没有人反对改造本身。大家担心的都很具体：**临时安置**、改造后的房租，以及老邻居还会不会回来。

## 我们的建议

- 先问居民，再定方案
- 公开施工期间的安置去向
`,
    continuation: "结果发现，大多数人从来没有被问过。",
    ask: "把“我们怎么问”那段改得更简洁",
    anchor:
      "这项调查前后一共持续了两个月的时间，地点分布在三个不同的街区。我们和居民一对一坐下来聊，每人大约一个小时。最终一共访谈了四十六位居民，聊到的话题涉及方方面面。",
    edited:
      "调查历时两个月，覆盖三个街区。我们和居民一对一坐下来聊，每人大约一个小时。共访谈四十六位居民。",
    reason: "把时间和地点并成一句，删掉结尾的空话，数字都保留。",
    commentAnchor: "城市总在变化。",
    comment: "开头太泛，第二句才是这篇文章真正的起点。",
    reply: "已精简调查方法那段，并在开头留了一条批注。",
  },
  ja: {
    doc: `# 古い通りと新しい計画

## なぜ話を聞いたのか

街はいつも変わり続けている。旧市街を全面的に改修すると聞いて、工事のそばで何年も暮らすことになる住民の声を、まず聞きたいと思った。

## どう聞いたのか

調査は二か月という期間にわたって、三つの異なる街区で行った。住民一人ひとりと向き合い、それぞれ一時間ほど話を聞いた。最終的には合計で四十六人の住民から話を聞き、話題は実にさまざまな方面に及んだ。

| 街区 | 世帯数 | 聞き取り |
|---|---|---|
| 東門 | 312 | 18 |
| 塩小路 | 205 | 15 |
| 旧桟橋 | 168 | 13 |

## 聞こえてきたこと

> 「水道管を替えるのは構わない。怖いのは、工事のあいだどこに住めばいいのかわからないことだ。」

再開発そのものに反対する人はほとんどいなかった。心配は具体的だった。**仮住まい**、改修後の家賃、そして隣人が戻ってくるかどうか。

## 提案

- 計画を決める前に住民に聞く
- 工事中の住まいを公表する
`,
    continuation:
      "わかったのは、ほとんどの人が一度も意見を聞かれていなかったということだ。",
    ask: "「どう聞いたのか」の段落をもっと簡潔にして",
    anchor:
      "調査は二か月という期間にわたって、三つの異なる街区で行った。住民一人ひとりと向き合い、それぞれ一時間ほど話を聞いた。最終的には合計で四十六人の住民から話を聞き、話題は実にさまざまな方面に及んだ。",
    edited:
      "調査は二か月間、三つの街区で行った。住民一人ひとりと向き合い、それぞれ一時間ほど話を聞いた。聞き取りは四十六人。",
    reason:
      "期間と場所を一文にまとめ、最後の決まり文句を削りました。数字は残しています。",
    commentAnchor: "街はいつも変わり続けている。",
    comment: "書き出しが一般的すぎます。二文目が本当の始まりです。",
    reply: "調査方法の段落を簡潔にし、書き出しにコメントを一つ残しました。",
  },
};

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });

const shot = (page: Page, lang: string, name: string) =>
  page.screenshot({ path: `docs/images/readme/${lang}/${name}.png` });

for (const [lang, s] of Object.entries(SAMPLES)) {
  test(`README screenshots (${lang})`, async ({ page }) => {
    // The AI panel, with a reasoned edit opened to its sentence picker and
    // a comment.
    await openApp(page, {
      settings: { language: lang, enableCompletion: false },
      storage: { "textus-agent-panel-open": "1" },
    });
    await pasteMarkdown(page, s.doc);
    await mockInvoke(page, {
      ai_agent_message: [
        { kind: "User", text: s.ask },
        {
          kind: "ToolCall",
          call_id: "e1",
          name: "propose_edit",
          arguments: JSON.stringify({
            action: "replace",
            anchor: s.anchor,
            text: s.edited,
            reason: s.reason,
          }),
        },
        { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
        {
          kind: "ToolCall",
          call_id: "c1",
          name: "add_comment",
          arguments: JSON.stringify({
            anchor: s.commentAnchor,
            comment: s.comment,
          }),
        },
        { kind: "ToolResult", call_id: "c1", output: "Comment added" },
        { kind: "Assistant", text: s.reply },
      ],
    });
    const composer = page.locator(".agent-panel-view textarea");
    await composer.fill(s.ask);
    await composer.press("Enter");
    await expect(page.locator(".agent-comment")).toBeVisible();
    await page.locator(".agent-proposal-picker-toggle").click();
    await expect(page.locator(".agent-proposal-picker-list li")).toHaveCount(2);
    // The insert preview types itself out; wait for its last words.
    await expect(page.locator(".milkdown")).toContainText(s.edited.slice(-12));
    await page.locator(".agent-panel-view textarea").blur();
    await shot(page, lang, "agent");
  });

  test(`README screenshots, editor (${lang})`, async ({ page }) => {
    await openApp(page, { settings: { language: lang } });
    await pasteMarkdown(page, s.doc);

    await mockInvoke(page, { ai_complete: s.continuation });
    // End only reaches the end of the visual line; the paragraph wraps.
    await page.locator(".milkdown p").first().click();
    await page.evaluate(() => {
      const p = document.querySelector('[data-active-tab="true"] .milkdown p')!;
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    await page.waitForTimeout(100);
    // Mid-document, continuations come on request (Ctrl+Shift+Space).
    await page.keyboard.press("Control+Shift+Space");
    await expect(page.locator(".ghost-text")).toHaveAttribute(
      "data-suggestion",
      s.continuation,
    );
    await shot(page, lang, "completion");
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+Shift+E");
    await expect(page.locator(".split-view")).toBeVisible();
    await shot(page, lang, "split");
    await page.keyboard.press("Control+Shift+E");
    await expect(page.locator(".split-view")).toHaveCount(0);
  });
  test(`README screenshots, zen (${lang})`, async ({ page }) => {
    // No as-you-type continuation: zen shows the page, not a suggestion.
    await openApp(page, {
      settings: { language: lang, enableCompletion: false },
    });
    await pasteMarkdown(page, s.doc);
    await page.waitForTimeout(500);
    // The method paragraph, in the middle of the page.
    await page
      .locator(".milkdown p", { hasText: s.anchor.slice(0, 12) })
      .click();
    // The editor takes up a click on the next selectionchange; a shortcut
    // in the same instant would still see the old caret.
    await page.waitForTimeout(200);
    await page.keyboard.press("Control+Shift+J");
    await expect(page.locator(".zen-current")).toHaveCount(1);
    // Its fade-out is frozen with the other animations; in use it goes.
    await page.addStyleTag({ content: ".zen-hint { display: none; }" });
    await shot(page, lang, "zen");
  });
}
