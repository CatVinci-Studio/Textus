import { describe, expect, it } from "vitest";
import { keepPastedLines } from "./paste-lines";

describe("keepPastedLines", () => {
  it("keeps the line breaks inside a pasted paragraph", () => {
    expect(keepPastedLines("Best,\nYouzhe")).toBe("Best,  \nYouzhe");
    expect(keepPastedLines("One.\n\nTwo.")).toBe("One.\n\nTwo.");
  });

  it("breaks a line ending in a web address without taking the address", () => {
    expect(keepPastedLines("See https://example.com/a\nThanks")).toBe(
      "See https://example.com/a  \nThanks",
    );
  });

  it("leaves Markdown's blocks as they are", () => {
    const md =
      "# Title\nText\n- a\n- b\n\n```\nx\ny\n```\n| a | b |\n| - | - |";
    expect(keepPastedLines(md)).toBe(md);
  });

  it("makes a quote drawn with bars a Markdown quote", () => {
    const pasted =
      "▎ Hi Denisse,\n▎\n▎ I went through\n▎ your grading.\n▎\n▎ - T1: brief";
    expect(keepPastedLines(pasted)).toBe(
      "> Hi Denisse,\n>\n> I went through  \n> your grading.\n>\n> - T1: brief",
    );
  });

  it("leaves a table's pipes alone", () => {
    expect(keepPastedLines("| a | b |\n| 1 | 2 |")).toBe(
      "| a | b |\n| 1 | 2 |",
    );
  });

  it("rejoins a paragraph a PDF or a terminal wrapped at its width", () => {
    const pdf = [
      "The results show that the proposed method significantly",
      "outperforms the baseline on all three benchmarks. In par-",
      "ticular, the effect is strongest for long documents, where",
      "the corpus is large.",
      "",
      "Early work relied on hand-",
      "written rules.",
    ].join("\n");
    expect(keepPastedLines(pdf)).toBe(
      "The results show that the proposed method significantly outperforms the baseline on all three benchmarks. In par-ticular, the effect is strongest for long documents, where the corpus is large.\n\nEarly work relied on hand-written rules.",
    );
  });

  it("joins wrapped CJK without a space, and a PDF's radicals and ligatures read as letters", () => {
    expect(
      keepPastedLines(
        "本文提出了一种基于块标识的文档编辑方法，该方\n法能够在用户编辑的同时保留模型的修改建议。",
      ),
    ).toBe(
      "本文提出了一种基于块标识的文档编辑方法，该方法能够在用户编辑的同时保留模型的修改建议。",
    );
    expect(keepPastedLines("比基线⾼出　第 ⼀ 章 引 ⾔")).toContain("高");
    expect(keepPastedLines("ﬁles")).toBe("files");
    expect(keepPastedLines("第 ⼀ 章 　 引 ⾔")).toBe("第一章引言");
  });

  it("keeps a chat's lines apart, a long one with a link in it too", () => {
    expect(
      keepPastedLines(
        "明天的安排：\n地址：https://map.example.com/?q=三楼会议室\n有问题随时找我[OK]",
      ),
    ).toBe(
      "明天的安排：  \n地址：https://map.example.com/?q=三楼会议室  \n有问题随时找我[OK]",
    );
    expect(keepPastedLines("「李雷：开会」\n- - - - - - -\n收到")).toBe(
      "「李雷：开会」\n- - - - - - -\n收到",
    );
  });

  it("keeps an email's short lines its own", () => {
    expect(keepPastedLines("Hi Chen,\nThanks for the notes\nSee you")).toBe(
      "Hi Chen,  \nThanks for the notes  \nSee you",
    );
  });

  it("makes a PDF's bullets a list", () => {
    expect(keepPastedLines("Results:\n• Faster\n• Smaller")).toBe(
      "Results:\n- Faster\n- Smaller",
    );
  });

  it("pastes fenced code as it is, in a paragraph's width or not", () => {
    const code = [
      "```js",
      ...Array.from({ length: 8 }, (_, i) =>
        i % 2 ? `  // 第 ${i} 行，中文注释 mixed` : `call(${i}); // line`,
      ),
      "• not a bullet ⼀ ﬁ",
      "```",
    ].join("\n");
    expect(keepPastedLines(code)).toBe(code);
    const around = "这是一段很长的中文说明文字，用来撑开宽度。\n\n" + code;
    expect(keepPastedLines(around)).toBe(around);
  });

  it("makes a terminal's output a code block, its spacing kept", () => {
    const df =
      "Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p2  468G  301G  144G  68% /\ntmpfs            16G  1.2M   16G   1% /tmp";
    expect(keepPastedLines(df)).toBe("```text\n" + df + "\n```");
    const session = "$ echo $HOME\n/home/chen\n$ ls *.md\nideas.md";
    expect(keepPastedLines(session)).toBe("```text\n" + session + "\n```");
  });
});
